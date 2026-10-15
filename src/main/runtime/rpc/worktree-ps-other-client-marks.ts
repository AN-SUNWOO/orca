import type { RuntimeWorktreePsResult } from '../../../shared/runtime-worktree-contracts'
import {
  EMPTY_PAIRED_DEVICE_IDS_BY_ENVIRONMENT,
  isWorkspaceOwnedBySomeoneElse
} from '../../../shared/workspace-creator-visibility'
import type { RpcContext } from './core'

/**
 * Marks the rows this host's own sidebar hides under "Hide other-client workspaces", for a phone
 * paired to it: the setting is the desktop's own and never crosses the pairing. A delegated phone
 * belongs to another desktop, whose view this host cannot speak for.
 */
export function markWorktreePsOtherClientRows<T extends RuntimeWorktreePsResult>(
  result: T,
  context: Pick<RpcContext, 'clientKind' | 'pairedDeviceParentId'> & {
    runtime: Pick<RpcContext['runtime'], 'hidesWorkspacesFromOtherDevices'>
  }
): T {
  if (
    context.clientKind !== 'mobile' ||
    context.pairedDeviceParentId !== undefined ||
    !context.runtime.hidesWorkspacesFromOtherDevices()
  ) {
    return result
  }
  let marked = false
  const worktrees = result.worktrees.map((row) => {
    if (!isWorkspaceOwnedBySomeoneElse(row, EMPTY_PAIRED_DEVICE_IDS_BY_ENVIRONMENT)) {
      return row
    }
    marked = true
    return { ...row, desktopOtherClient: true as const }
  })
  return marked ? { ...result, worktrees } : result
}
