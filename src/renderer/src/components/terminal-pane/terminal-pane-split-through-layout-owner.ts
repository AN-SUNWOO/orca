import { useAppStore } from '@/store'
import { getExplicitRuntimeEnvironmentIdForWorktree } from '@/lib/worktree-runtime-owner'
import { callRuntimeRpc } from '@/runtime/runtime-rpc-client'
import type { LayoutApplyReply } from '../../../../shared/workspace-layout/workspace-layout-command-types'

/**
 * A split in a layout-owner build: main writes it and mints the new pane's id, then `mount` shows
 * that pane (no id: split as today). False when a paired server owns the workspace's layout; the
 * caller splits as today.
 */
export function splitThroughLayoutOwner(
  split: {
    worktreeId: string
    tabId: string
    leafId: string
    direction: 'vertical' | 'horizontal'
  },
  mount: (leafId: string | undefined) => void
): boolean {
  // Why: the same owner test that mirrors a workspace's tabs from a paired server; a focused
  // server must not claim a workspace whose row names no owner.
  if (getExplicitRuntimeEnvironmentIdForWorktree(useAppStore.getState(), split.worktreeId)) {
    return false
  }
  const { worktreeId: workspace, ...pane } = split
  void callRuntimeRpc<LayoutApplyReply>({ kind: 'local' }, 'layout.apply', {
    command: { type: 'splitPane', workspace, ...pane }
  })
    .then((reply) => {
      if (reply.ok && reply.result.leafId) {
        mount(reply.result.leafId)
      } else if (!reply.ok && reply.code === 'host_not_owned') {
        // A tab a paired server holds inside a local workspace (#18202): split it as today.
        mount(undefined)
      } else {
        console.warn('[layout-owner] split refused:', reply.ok ? 'no_leaf' : reply.code)
      }
    })
    .catch((error: unknown) => {
      console.warn('[layout-owner] split failed:', error instanceof Error ? error.message : error)
    })
  return true
}
