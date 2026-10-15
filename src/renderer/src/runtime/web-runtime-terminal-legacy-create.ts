import type { RuntimeRpcResponse } from '../../../shared/runtime-rpc-envelope'
import type { RuntimeMobileSessionCreateTerminalResult } from '../../../shared/runtime-types'
import { toHostSessionTabId } from '../../../shared/terminal-surface-id'
import { unwrapRuntimeRpcResult } from './runtime-rpc-result'
import { toRuntimeWorktreeSelector } from './runtime-worktree-selector'
import type { CreateWebRuntimeSessionTerminalArgs } from './web-runtime-session-types'

export async function createLegacyWebRuntimeTerminal(
  args: CreateWebRuntimeSessionTerminalArgs,
  callEnvironment: (request: {
    method: string
    params?: unknown
    timeoutMs?: number
  }) => Promise<RuntimeRpcResponse<unknown>>
): Promise<RuntimeMobileSessionCreateTerminalResult> {
  const response = await callEnvironment({
    method: 'session.tabs.createTerminal',
    params: {
      worktree: toRuntimeWorktreeSelector(args.worktreeId),
      afterTabId: args.afterTabId ? toHostSessionTabId(args.afterTabId) : undefined,
      targetGroupId: args.targetGroupId,
      command: args.command,
      cwd: args.cwd,
      ...(args.env ? { env: args.env } : {}),
      ...(args.envToDelete ? { envToDelete: args.envToDelete } : {}),
      startupCommandDelivery: args.startupCommandDelivery,
      ...(args.launchConfig ? { launchConfig: args.launchConfig } : {}),
      ...(args.launchToken ? { launchToken: args.launchToken } : {}),
      ...(args.viewMode ? { viewMode: args.viewMode } : {}),
      // Old hosts use activate:false; new hosts use select/navigation for client-local focus.
      activate: false,
      select: args.activate !== false,
      navigation: 'caller'
    },
    timeoutMs: 15_000
  })
  return unwrapRuntimeRpcResult(
    response as RuntimeRpcResponse<RuntimeMobileSessionCreateTerminalResult>
  )
}
