import type { OracleCheck, OracleFinding } from './helpers/workspace-layout-oracle'

/**
 * Findings the layout oracle still reports on main, each tied to its cause. A rework PR that fixes
 * one removes its entry; any finding not listed here fails the scenario.
 */
type KnownOnMain = {
  /** A scenario id; a trailing '*' matches every id with that prefix. */
  scenario: string
  check: OracleCheck
  /** Prefix of the step label. */
  step?: string
  /** Only breaches seen while a step settled, not the settled layout. */
  transient?: true
  /** Rules only: the rule name each detail line starts with. */
  rule?: string
  /** Pattern the detail line must match. */
  detail?: RegExp
  /** Only on this OS: the one every run that reproduced it ran on. Absent: reproduced on both. */
  platform?: 'darwin' | 'linux'
  cause: string
}

const TRANSIENT = /\(transient\)$/

export const LAYOUT_ORACLE_KNOWN_ON_MAIN: readonly KnownOnMain[] = [
  // Three copies of tab order: a reorder moves the tab bar, not the saved rows.
  {
    scenario: 'client-reorder-tabs',
    check: 'rules',
    rule: 'tab_order_disagrees',
    cause: 'one tab order'
  },
  // After a cold relaunch the paired-client tab list stays empty while the window shows the tabs.
  {
    scenario: 'cold-daemon-restart',
    check: 'client',
    step: 'after cold relaunch',
    cause: 'client tab list empty after cold relaunch'
  },
  // After a cold relaunch main holds the tab rows but no tab bar for the worktree until the window
  // saves again, so its group is minted again under a new id (Linux CI).
  ...(['rules', 'view'] as const).map((check) => ({
    scenario: 'cold-daemon-restart',
    check,
    step: 'after cold relaunch',
    platform: 'linux' as const,
    cause: 'tab bar not saved after relaunch'
  })),
  {
    scenario: 'cold-daemon-restart',
    check: 'restart',
    step: 'cold relaunch',
    // One group, same tabs in the same order, only its id changed; a reorder or lost tab still fails.
    detail: /: groups \[\["[^"]+",(\[[^\]]*\])\]\] vs after restart \[\["[^"]+",\1\]\]$/,
    platform: 'linux',
    cause: 'tab bar not saved after relaunch'
  },
  // STA-9417: first activation of a host-created setup split mints a second tab for the setup
  // terminal (one terminal in two panes) or leaves that terminal with no pane.
  ...(['view', 'client'] as const).map((check) => ({
    scenario: 'setup-split-first-activation',
    check,
    cause: 'STA-9417'
  })),
  ...(['rules', 'expected'] as const).map((check) => ({
    scenario: 'setup-split-first-activation',
    check,
    platform: 'darwin' as const,
    cause: 'STA-9417'
  })),
  // The in-app daemon restart drops the worktree's tabs from main while the window keeps them.
  ...(['view', 'expected', 'restart', 'marker'] as const).map((check) => ({
    scenario: 'live-daemon-restart',
    check,
    cause: 'daemon restart empties the runtime layout'
  })),
  // The relaunch after it has no tab bar for the worktree, so its group is minted again (Linux CI).
  ...(['rules', 'client'] as const).map((check) => ({
    scenario: 'live-daemon-restart',
    check,
    step: 'after relaunch',
    platform: 'linux' as const,
    cause: 'daemon restart empties the runtime layout'
  })),
  // A worktree woken after relaunch has no tab bar in main until the window next saves it, so the
  // runtime's group is minted again with a new id.
  ...(['rules', 'view', 'client'] as const).map((check) => ({
    scenario: 'sleep-quit-resume',
    check,
    step: 'after relaunch',
    cause: 'tab bar not saved after wake'
  })),
  {
    scenario: 'sleep-quit-resume',
    check: 'restart',
    step: 'relaunch',
    cause: 'tab bar not saved after wake'
  },
  // A headless host lists a worktree with no saved tab bar (and, after a restart, every worktree)
  // under a synthesized `headless-terminals:` group, while the layout stream names the same group
  // by its saved or minted id: same tabs and order, two group ids. One projection in PR 6.
  {
    scenario: 'headless-*',
    check: 'client',
    detail: /^group id differs: runtime \S+, client headless-terminals:\S+ \(tabs /,
    cause: 'two group ids'
  },
  // A renamed terminal's title lists as null in terminal.list after a serve restart (session tabs
  // keep it): orcad everywhere, Electron serve on Linux.
  {
    scenario: 'headless-orcad-rename-terminal',
    check: 'expected',
    step: 'rename after restart',
    cause: 'title after restart'
  },
  {
    scenario: 'headless-electron-rename-terminal',
    check: 'expected',
    step: 'rename after restart',
    platform: 'linux',
    cause: 'title after restart'
  },
  // A headless reorder saves rows through the session merge door, which keeps the stored row order,
  // so rows and the group disagree. Fixed in PR 6, where rows follow the group's tab order.
  ...(['orcad', 'electron'] as const).map((kind) => ({
    scenario: `headless-${kind}-move-tab-between-groups`,
    check: 'rules' as const,
    rule: 'tab_order_disagrees',
    cause: 'one tab order'
  })),
  // After a headless move into an existing group, paired clients still see that group's previous
  // tab selected, not the moved one. A split into a new group selects the moved tab.
  ...(['orcad', 'electron'] as const).map((kind) => ({
    scenario: `headless-${kind}-move-tab-between-groups`,
    check: 'expected' as const,
    step: 'move',
    detail: /^group \S+ selects /,
    cause: 'headless move-to-group keeps the target group selection'
  }))
]

function covers(
  known: KnownOnMain,
  scenario: string,
  finding: OracleFinding,
  detail: string
): boolean {
  const scenarioMatches = known.scenario.endsWith('*')
    ? scenario.startsWith(known.scenario.slice(0, -1))
    : known.scenario === scenario
  if (!scenarioMatches || (known.platform && known.platform !== process.platform)) {
    return false
  }
  if (known.check !== finding.check) {
    return false
  }
  if (known.transient && !TRANSIENT.test(finding.step)) {
    return false
  }
  if (known.step !== undefined && !finding.step.startsWith(known.step)) {
    return false
  }
  if (known.detail !== undefined && !known.detail.test(detail)) {
    return false
  }
  return known.rule === undefined || detail.startsWith(`${known.rule}:`)
}

/** The findings, reduced to the detail lines no known-on-main entry covers. */
export function unexpectedFindings(
  scenario: string,
  findings: readonly OracleFinding[]
): OracleFinding[] {
  return findings.flatMap((finding) => {
    const details = finding.details.filter(
      (detail) =>
        !LAYOUT_ORACLE_KNOWN_ON_MAIN.some((known) => covers(known, scenario, finding, detail))
    )
    return details.length > 0 ? [{ check: finding.check, step: finding.step, details }] : []
  })
}
