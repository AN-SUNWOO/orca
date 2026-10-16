// Store-free so store slices can send; `layout-owner-command` reads the store for other callers.
import { getExplicitRuntimeEnvironmentIdForWorktree } from '@/lib/worktree-runtime-owner'
import { callRuntimeRpc } from '@/runtime/runtime-rpc-client'
import type { TabGroupLayoutNode } from '../../../shared/tab-types'
import type { TerminalPaneLayoutNode } from '../../../shared/terminal-tab-types'
import type { PaneSide } from '../../../shared/workspace-layout/terminal-pane-tree'
import type {
  GroupSide,
  LayoutApplyReply,
  LayoutCommandResult,
  LayoutRefusalCode
} from '../../../shared/workspace-layout/workspace-layout-command-types'

/** The commands a window sends `layout.apply`; main mints any new id. */
export type WindowLayoutCommand =
  | { type: 'splitPane'; tabId: string; leafId: string; direction: 'vertical' | 'horizontal' }
  | { type: 'closePane'; tabId: string; leafId: string }
  | { type: 'renamePane'; tabId: string; leafId: string; title: string | null }
  | { type: 'equalizePanes'; tabId: string }
  | { type: 'movePane'; tabId: string; leafId: string; targetLeafId: string; side: PaneSide }
  | { type: 'setPaneRatios'; tabId: string; root: TerminalPaneLayoutNode }
  | { type: 'moveTab'; tabId: string; toGroupId: string; index: number }
  | { type: 'splitGroup'; tabId: string; besideGroupId: string; direction: GroupSide }
  | { type: 'setGroupRatios'; groupLayout: TabGroupLayoutNode }
  | { type: 'closeTabs'; tabIds: [string]; recordClose: 'user' | 'cleanup' }

export type LayoutApplyHandlers = {
  apply: (result: LayoutCommandResult) => void
  asToday: () => void
  refused?: (code: LayoutRefusalCode) => void
}

/**
 * A layout command in a layout-owner build: main applies it first, then `apply` shows main's
 * result. `asToday` runs instead when main cannot act on it: a paired server holds the tab
 * (#18202), main's copy lacks the workspace, tab, pane or group, or the call threw. `refused` on
 * any other refusal. False when a paired server owns the workspace's layout; the caller acts as
 * today.
 */
export function sendLayoutApply(
  state: Parameters<typeof getExplicitRuntimeEnvironmentIdForWorktree>[0],
  worktreeId: string,
  command: WindowLayoutCommand,
  handlers: LayoutApplyHandlers
): boolean {
  // Why: the same owner test that mirrors a workspace's tabs from a paired server; a focused
  // server must not claim a workspace whose row names no owner.
  if (getExplicitRuntimeEnvironmentIdForWorktree(state, worktreeId)) {
    return false
  }
  void callRuntimeRpc<LayoutApplyReply>({ kind: 'local' }, 'layout.apply', {
    command: { ...command, workspace: worktreeId }
  })
    .then(
      (reply) => {
        if (reply.ok) {
          handlers.apply(reply.result)
        } else if (reply.code === 'host_not_owned' || mainLacksTarget(reply.code)) {
          // Why lacking: main's copy lags the window's here (the window still saves its own).
          handlers.asToday()
        } else {
          console.warn(`[layout-owner] ${command.type} refused:`, reply.code)
          handlers.refused?.(reply.code)
        }
      },
      (error: unknown) => {
        // Why as today: a thrown write is rolled back. An indeterminate disk write is not, and may
        // leave a pane main minted; accepted until main is the only writer.
        console.warn(`[layout-owner] ${command.type} failed:`, errorMessage(error))
        handlers.asToday()
      }
    )
    // A throwing handler is not a failed call; it must not run the fallback too.
    .catch((error: unknown) => {
      console.warn(`[layout-owner] ${command.type} handler threw:`, errorMessage(error))
    })
  return true
}

function mainLacksTarget(code: LayoutRefusalCode): boolean {
  return (
    code === 'workspace_not_found' ||
    code === 'tab_not_found' ||
    code === 'pane_not_found' ||
    code === 'group_not_found'
  )
}

function errorMessage(error: unknown): unknown {
  return error instanceof Error ? error.message : error
}
