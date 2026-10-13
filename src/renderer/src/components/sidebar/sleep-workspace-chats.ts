import type { AppState } from '@/store/types'
import { isStructuredTab } from '@/components/native-chat/structured-agent-session-tabs'
import { structuredAgentSessionTargetForHost } from '@/runtime/structured-agent-session-owner'
import {
  AGENT_SESSION_SLEEP_UNSUPPORTED,
  sleepStructuredAgentSession
} from '@/runtime/structured-agent-session-close'
import type { RuntimeClientTarget } from '../../../../shared/runtime-client-target'

export type WorkspaceChatSleep = { sessionId: string; target: RuntimeClientTarget | null }

/** Each chat routes to the host stamped on its tab; one with none is not stopped, it fails Sleep. */
export function resolveWorkspaceChatSleeps(
  state: Pick<AppState, 'unifiedTabsByWorktree'>,
  worktreeId: string
): WorkspaceChatSleep[] {
  return (state.unifiedTabsByWorktree[worktreeId] ?? []).filter(isStructuredTab).map((tab) => ({
    sessionId: tab.entityId,
    target: structuredAgentSessionTargetForHost(tab.executionHostId)
  }))
}

/** Stops every chat's agent, keeping the tabs; tries them all, then throws the first failure. */
export async function sleepWorkspaceChats(chats: readonly WorkspaceChatSleep[]): Promise<void> {
  const results = await Promise.allSettled(
    chats.map(({ sessionId, target }) =>
      target
        ? sleepStructuredAgentSession(target, sessionId)
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
