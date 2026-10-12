import type { TerminalPanePlacement } from '../../shared/terminal-pane-placement'
import type { TerminalPaneSplitDirection } from '../../shared/terminal-tab-types'

/** A main-side create always opens its own tab. */
export function runtimeNewTabPlacement(viewMode?: 'terminal' | 'chat'): TerminalPanePlacement {
  return viewMode ? { kind: 'new-tab', row: { viewMode } } : { kind: 'new-tab' }
}

/** A runtime-started tab opens in the group asked for, else the first group (as the live view). */
export function newTabIn(opts: { viewMode?: 'terminal' | 'chat'; targetGroupId?: string }): {
  placement: TerminalPanePlacement
  groupId?: string
} {
  const { targetGroupId } = opts
  return {
    placement: runtimeNewTabPlacement(opts.viewMode),
    ...(targetGroupId ? { groupId: targetGroupId } : {})
  }
}

export function runtimeSplitPlacement(
  parentLeafId: string,
  direction: TerminalPaneSplitDirection
): TerminalPanePlacement {
  return { kind: 'split', parentLeafId, direction }
}
