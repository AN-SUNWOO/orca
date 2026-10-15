// Window parity: for each stored profile, the window's startup hydration of the session as stored
// and of the shared Loader's rewrite of it (load then save) must show the same thing. Where they
// differ today, the difference is listed below with the Loader rule that causes it: as work to
// do, or as accepted with the reason it is not a bug.

import { describe, expect, it, vi } from 'vitest'
import type * as AgentStatusModule from '@/lib/agent-status'
import type { ExecutionHostId } from '../../../shared/execution-host'
import type { WorkspaceSessionState } from '../../../shared/workspace-session-state-types'
import { LEGACY_WORKSPACE_LAYOUT_PROFILES } from '../../../shared/workspace-layout/workspace-layout-legacy-profile.test-fixture'
import { loadWorkspaceLayout } from '../../../shared/workspace-layout/workspace-layout-load'
import { WORKSPACE_LAYOUT_PROFILES } from '../../../shared/workspace-layout/workspace-layout-profile.test-fixture'
import { saveWorkspaceLayout } from '../../../shared/workspace-layout/workspace-layout-save'
import { createStoreSessionMockApi } from '../store/slices/store-session-test-harness'
import { createTestStore } from '../store/slices/store-test-helpers'
import {
  bootWindowFromPartitions,
  diffStartupWindowViews,
  projectStartupWindowView
} from './startup-window-view.test-fixture'

vi.mock('sonner', () => ({ toast: { info: vi.fn(), success: vi.fn(), error: vi.fn() } }))
vi.mock('@/lib/agent-status', async (importOriginal) => {
  const actual = await importOriginal<typeof AgentStatusModule>()
  return { ...actual, detectAgentStatusFromTitle: vi.fn().mockReturnValue(null) }
})

createStoreSessionMockApi()

const GIT = 'repo-1::/Users/dev/orca'
const terminal = (tabId: string) =>
  ['phone and CLI title', 'panes', 'focused pane', 'reattaches'].map(
    (field) => `${GIT} terminal ${tabId} ${field}`
  )

type KnownDifference = {
  fixture: string
  /** The Loader rule that makes the window show something else. */
  rule: string
  /** View paths that differ; see `projectStartupWindowView`. */
  paths: string[]
}

/** Differences to fix. Entries may only be removed: fix the rule, then delete its entry. */
const KNOWN_DIFFERENCES: readonly KnownDifference[] = [
  {
    fixture: 'row without a tab-bar entry or a terminal',
    rule: 'ghost tab: the Loader gives every row a tab-bar entry; the window adopts only rows it can reattach',
    paths: [`${GIT} group 0 tabs`, `${GIT} tab tab-b`, ...terminal('tab-b')]
  }
]

type AcceptedDifference = Omit<KnownDifference, 'paths'> & {
  reason: string
  /** Each differing view path with its stored and normalized values; absent means not shown. */
  values: Record<string, { stored?: unknown; normalized?: unknown }>
}

/** Differences that are not bugs: the user sees the same thing, or the window is the outlier. */
const ACCEPTED_DIFFERENCES: readonly AcceptedDifference[] = [
  {
    fixture: 'row terminal differs from its focused pane’s',
    rule: 'row.ptyId rewrite: the Loader sets the row terminal to its focused pane’s, which changes what the tab reattaches',
    reason: 'the pane’s own terminal binding wins on mount, so the user sees the same terminal',
    values: { [`${GIT} terminal tab-a reattaches`]: { stored: 'pty-stale', normalized: 'pty-a' } }
  },
  {
    fixture: 'row with no terminal while its pane has one',
    rule: 'row.ptyId rewrite: the Loader sets the row terminal to its focused pane’s, which changes what the tab reattaches',
    reason: 'the pane’s own terminal binding wins on mount, so the user sees the same terminal',
    values: { [`${GIT} terminal tab-a reattaches`]: { stored: null, normalized: 'pty-a' } }
  },
  {
    fixture: 'legacy surface tombstone on a pane still showing its terminal',
    rule: 'tombstones: the Loader closes a pane a legacy surface tombstone names; the window ignores the tombstone and shows the pane',
    reason: 'the window is the outlier: main already retires panes these tombstones name',
    values: {
      [`${GIT} group 0 tabs`]: { stored: ['tab-a', 'tab-b'], normalized: ['tab-a'] },
      [`${GIT} tab tab-b`]: {
        stored: { kind: 'terminal', shows: 'tab-b', group: 0, label: 'Terminal 2' }
      },
      [`${GIT} terminal tab-b phone and CLI title`]: { stored: 'Terminal 2' },
      [`${GIT} terminal tab-b panes`]: { stored: { pane: 'pty-b' } },
      [`${GIT} terminal tab-b focused pane`]: { stored: 'root' },
      [`${GIT} terminal tab-b reattaches`]: { stored: 'pty-b' }
    }
  },
  {
    fixture: 'tab-bar label differing from the row title',
    rule: 'label over title: the Loader writes the tab-bar label into the row title',
    reason:
      'the desktop tab shows the label, which is unchanged; only phones and the CLI show the row title',
    values: {
      [`${GIT} terminal tab-a phone and CLI title`]: { stored: 'Terminal 1', normalized: 'vim' }
    }
  }
]

/** The shared Loader's round trip, as main would persist it. */
function normalize(hostId: ExecutionHostId, session: WorkspaceSessionState): WorkspaceSessionState {
  let next = 0
  const loaded = loadWorkspaceLayout(hostId, structuredClone(session), {
    mintId: () => `minted-${++next}`,
    mintLeafId: () => `00000000-0000-4000-9000-${String(++next).padStart(12, '0')}`
  })
  return saveWorkspaceLayout(loaded)
}

const PROFILES = [...WORKSPACE_LAYOUT_PROFILES, ...LEGACY_WORKSPACE_LAYOUT_PROFILES]

describe('the window shows the same session before and after the shared Loader rewrites it', () => {
  it.each(PROFILES.map((profile) => [profile.name, profile] as const))(
    '%s',
    async (name, { hostId, build }) => {
      const stored = build()
      const storedView = projectStartupWindowView(
        await bootWindowFromPartitions(createTestStore(), [{ hostId, session: stored }])
      )
      const normalizedView = projectStartupWindowView(
        await bootWindowFromPartitions(createTestStore(), [
          { hostId, session: normalize(hostId, stored) }
        ])
      )
      // The window must show the stored workspaces at all, or an empty view hides differences.
      for (const [key, rows] of Object.entries(stored.tabsByWorktree)) {
        if (rows.length > 0) {
          expect(storedView, key).toHaveProperty([`${key} group 0 tabs`])
        }
      }
      const differences = diffStartupWindowViews(storedView, normalizedView)
      const known = KNOWN_DIFFERENCES.filter((entry) => entry.fixture === name)
      const accepted = ACCEPTED_DIFFERENCES.filter((entry) => entry.fixture === name)
      expect(
        differences.map((difference) => difference.path).sort(),
        `window differences (stored vs normalized):\n${JSON.stringify(differences, null, 2)}`
      ).toEqual(
        [
          ...known.flatMap((entry) => entry.paths),
          ...accepted.flatMap((entry) => Object.keys(entry.values))
        ].sort()
      )
      // An accepted difference stays accepted only while it shows exactly the recorded values.
      const acceptedValues = Object.assign({}, ...accepted.map((entry) => entry.values))
      expect(
        Object.fromEntries(
          differences
            .filter((difference) => difference.path in acceptedValues)
            .map(({ path, stored, normalized }) => [path, { stored, normalized }])
        )
      ).toEqual(acceptedValues)
    }
  )

  it('keeps the tab-bar twin selected when a selected legacy copy is dropped', async () => {
    const profile = PROFILES.find(
      (entry) => entry.name === 'legacy row repeating a tab-bar tab’s terminal, selected'
    )!
    const view = projectStartupWindowView(
      await bootWindowFromPartitions(createTestStore(), [
        { hostId: profile.hostId, session: normalize(profile.hostId, profile.build()) }
      ])
    )
    expect(view['active.terminal']).toBe('tab-a')
    expect(view[`${GIT} active terminal`]).toBe('tab-a')
  })

  it('restores the terminals of a session from before the tab bar, dropping its file tabs', async () => {
    const profile = PROFILES.find(
      (entry) => entry.name === 'session from before the tab bar, with an open file'
    )!
    const view = projectStartupWindowView(
      await bootWindowFromPartitions(createTestStore(), [
        { hostId: profile.hostId, session: profile.build() }
      ])
    )
    expect(view[`${GIT} group 0 tabs`]).toEqual(['tab-a', 'tab-b'])
    expect(view).not.toHaveProperty([`${GIT} tab /Users/dev/orca/src/app.ts`])
  })

  it('lists differences only for fixtures that exist', () => {
    const names = new Set(PROFILES.map((profile) => profile.name))
    expect(
      [...KNOWN_DIFFERENCES, ...ACCEPTED_DIFFERENCES].filter((entry) => !names.has(entry.fixture))
    ).toEqual([])
  })
})
