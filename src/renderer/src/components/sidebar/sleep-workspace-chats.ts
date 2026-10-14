import type { AppState } from '@/store/types'
import { isStructuredTab } from '@/components/native-chat/structured-agent-session-tabs'
import { structuredAgentSessionTargetForHost } from '@/runtime/structured-agent-session-owner'
import {
  AGENT_SESSION_SLEEP_UNSUPPORTED,
  assertStructuredAgentSessionSleepSupported
} from '@/runtime/structured-agent-session-close'
import { callStructuredAgentSession } from '@/runtime/structured-agent-session-client'
import {
  findIndexedFolderWorkspaceOwner,
  resolveIndexedWorktreeOwner
} from '@/lib/worktree-runtime-owner-index'
import { resolveExplicitWorktreeOperationRouteResult } from '@/lib/worktree-operation-catalog-route'
import {
  getRepoExecutionHostId,
  parseExecutionHostId,
  toRuntimeExecutionHostId
} from '../../../../shared/execution-host'
import { parseWorkspaceKey } from '../../../../shared/workspace-scope'
import type { Worktree } from '../../../../shared/worktree/types'
import type { WorktreeRuntimeOwnerState } from '@/lib/worktree-runtime-owner-state'
import type { RuntimeClientTarget } from '../../../../shared/runtime-client-target'

export type WorkspaceChatSleep = { sessionId: string; target: RuntimeClientTarget | null }
export type WorkspaceSleepTarget =
  | string
  | Pick<Worktree, 'id' | 'repoId' | 'hostId' | 'runtimeOwnerEnvironmentId'>

type ChatOwnerState = WorktreeRuntimeOwnerState & Pick<AppState, 'unifiedTabsByWorktree'>

function sleepTargetHost(state: ChatOwnerState, target: WorkspaceSleepTarget): string | null {
  const worktreeId = typeof target === 'string' ? target : target.id
  if (typeof target !== 'string') {
    const runtimeOwner = target.runtimeOwnerEnvironmentId?.trim()
    if (runtimeOwner) {
      return toRuntimeExecutionHostId(runtimeOwner)
    }
    const stampedHost = parseExecutionHostId(target.hostId)
    if (stampedHost) {
      return stampedHost.id
    }
  }
  const scope = parseWorkspaceKey(worktreeId)
  if (scope?.type === 'folder') {
    const owner = findIndexedFolderWorkspaceOwner(state.folderWorkspaces, scope.folderWorkspaceId)
    return owner ? getRepoExecutionHostId(owner) : null
  }
  const resolution = resolveExplicitWorktreeOperationRouteResult(state, worktreeId)
  if (resolution.kind !== 'resolved') {
    return null
  }
  return resolution.route.runtimeEnvironmentId
    ? toRuntimeExecutionHostId(resolution.route.runtimeEnvironmentId)
    : resolution.route.executionHostId
}

/** Qualify each chat by the selected workspace host before routing it. */
export function resolveWorkspaceChatSleeps(
  state: ChatOwnerState,
  target: WorkspaceSleepTarget
): WorkspaceChatSleep[] {
  const worktreeId = typeof target === 'string' ? target : target.id
  const selectedHost = sleepTargetHost(state, target)
  const legacyOwnerAmbiguous =
    resolveIndexedWorktreeOwner(state.worktreesByRepo, worktreeId).kind === 'ambiguous'
  return (state.unifiedTabsByWorktree[worktreeId] ?? []).filter(isStructuredTab).flatMap((tab) => {
    const tabHost = tab.executionHostId ?? (legacyOwnerAmbiguous ? null : selectedHost)
    if (tabHost && selectedHost && tabHost !== selectedHost) {
      return []
    }
    return [
      {
        sessionId: tab.entityId,
        target: tabHost && selectedHost ? structuredAgentSessionTargetForHost(tabHost) : null
      }
    ]
  })
}

/** Resolve predictable failures before browsers or terminals are torn down. */
export async function preflightWorkspaceChatSleep(
  chats: readonly WorkspaceChatSleep[]
): Promise<void> {
  const preflight = await Promise.allSettled(
    chats.map(({ target }) =>
      target
        ? assertStructuredAgentSessionSleepSupported(target)
        : Promise.reject(new Error(AGENT_SESSION_SLEEP_UNSUPPORTED))
    )
  )
  const unsupported = preflight.find(
    (result): result is PromiseRejectedResult => result.status === 'rejected'
  )
  if (unsupported) {
    throw unsupported.reason
  }
}

/** Issue every stop in the same turn after the caller's final activation check. */
export async function sleepWorkspaceChats(chats: readonly WorkspaceChatSleep[]): Promise<void> {
  const results = await Promise.allSettled(
    chats.map(({ sessionId, target }) =>
      target
        ? callStructuredAgentSession(target, 'agentSession.sleep', { sessionId })
        : Promise.reject(new Error(AGENT_SESSION_SLEEP_UNSUPPORTED))
    )
  )
  const failure = results.find(
    (result): result is PromiseRejectedResult => result.status === 'rejected'
  )
  if (failure) {
    throw failure.reason
  }
}
