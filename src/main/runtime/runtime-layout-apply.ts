import { parseExecutionHostId, type ExecutionHostId } from '../../shared/execution-host'
import type {
  LayoutApplyReply,
  LayoutCommand
} from '../../shared/workspace-layout/workspace-layout-command-types'
import { markAgentLaunchesClosedByUser } from '../agent-launch/agent-launch-pane-attachment'
import type { RuntimeStore } from './runtime-store-contract'

/** A window's layout command: one on a tab, which names its partitions, or on the group tree. */
export type WindowLayoutCommand = LayoutCommand &
  ({ tabId: string } | { type: 'setGroupRatios' } | { type: 'closeTabs'; tabIds: [string] })

/**
 * `layout.apply`: the window's command on the partitions holding its tab, routed partition first;
 * a group tree command goes to the workspace's routed partition. A pane close is the user's: main
 * marks it so, and the window cannot.
 */
export async function applyWindowLayoutCommand(
  store: RuntimeStore,
  hostIdsFor: (worktreeId: string, tabId: string | null) => ExecutionHostId[],
  command: WindowLayoutCommand
): Promise<LayoutApplyReply> {
  const routedTabId =
    'tabId' in command ? command.tabId : command.type === 'closeTabs' ? command.tabIds[0] : null
  const hostIds = hostIdsFor(command.workspace, routedTabId)
  // Why: a paired server's workspaces keep today's mirrored layout until that server owns it.
  if (!hostIds[0] || parseExecutionHostId(hostIds[0])?.kind === 'runtime') {
    return { ok: false, code: 'host_not_owned' }
  }
  if (!store.applyLayoutCommand) {
    throw new Error('layout_store_unavailable')
  }
  // Why every holder: a legacy relay reattach can leave one tab in two partitions.
  const holders = hostIds.filter((hostId) => parseExecutionHostId(hostId)?.kind !== 'runtime')
  if (command.type === 'closeTabs') {
    // The window already confirmed, removed the tab and stopped its terminals: main forces the
    // close, records it, and stops nothing (a terminal another tab shares must live on).
    if (command.recordClose === 'user') {
      // Launches go by the terminal's own id, which a legacy tab-bar entry's can differ from.
      const tabId =
        store
          .getWorkspaceSession?.(hostIds[0])
          ?.unifiedTabs?.[command.workspace]?.find((entry) => entry.id === command.tabIds[0])
          ?.entityId ?? command.tabIds[0]
      markAgentLaunchesClosedByUser(command.workspace, { kind: 'tab', tabId })
    }
    const reply = await store.applyLayoutCommand({ ...command, force: true }, holders)
    // Why: a workspace main lacks records nothing; today's close records it in the routed partition.
    return reply.ok && reply.result.alreadyClosed
      ? { ok: false, code: 'workspace_not_found' }
      : reply
  }
  if (command.type !== 'closePane') {
    return store.applyLayoutCommand(command, [hostIds[0]])
  }
  const { workspace, tabId, leafId } = command
  // A launch still starting in the pane the user closed stops, and says so (as the legacy close).
  markAgentLaunchesClosedByUser(workspace, { kind: 'pane', tabId, leafId })
  return store.applyLayoutCommand({ ...command, userPaneClose: true }, holders)
}
