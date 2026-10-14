import type { AgentSessionExecutionLocation } from '../../../shared/agent-session-record'
import { LOCAL_EXECUTION_HOST_ID } from '../../../shared/execution-host'
import type { StructuredAgentSessionHostDeps } from './structured-agent-session-host-types'
import type { StructuredAgentSessionConversationLifetime } from './structured-agent-session-conversation-lifetime'
import type { StructuredAgentSessionConversations } from './structured-agent-session-conversations'
import type { StructuredAgentSessionTaskQueue } from './structured-agent-session-task-queue'

type WorkspaceSleepHost = {
  deps: Pick<StructuredAgentSessionHostDeps, 'store' | 'logger' | 'hasOpenDispatch'>
  tasks: StructuredAgentSessionTaskQueue
  lifetime: Pick<StructuredAgentSessionConversationLifetime, 'closeForWorkspaceSleep'>
  sessions: StructuredAgentSessionConversations
  deliveryRunning: (sessionId: string) => boolean
  childWorkIncomplete: (sessionId: string) => boolean
}

/** Snapshot host-owned members and return only same-call, current positive stop receipts. */
export async function sleepStructuredAgentSessionWorkspace(
  host: WorkspaceSleepHost,
  workspaceId: string
): Promise<{ stoppedSessionIds: string[] }> {
  let records: ReturnType<StructuredAgentSessionHostDeps['store']['listRecords']>
  try {
    records = host.deps.store.listRecords()
  } catch (error) {
    host.deps.logger.warn('workspace chat inventory failed', {
      scope: 'workspace-chat-inventory',
      workspaceId,
      error
    })
    return { stoppedSessionIds: [] }
  }
  const belongs = (location: AgentSessionExecutionLocation): boolean =>
    location.workspaceId === workspaceId && location.executionHostId === LOCAL_EXECUTION_HOST_ID
  const candidates = new Set([
    ...records.filter((record) => belongs(record.location)).map((record) => record.sessionId),
    ...host.tasks.pendingMembers(workspaceId, LOCAL_EXECUTION_HOST_ID)
  ])
  const outcomes = await Promise.allSettled(
    [...candidates].map((sessionId) =>
      host.lifetime
        .closeForWorkspaceSleep(sessionId, workspaceId, LOCAL_EXECUTION_HOST_ID)
        .then((result) => ({ sessionId, result }))
    )
  )
  await Promise.all([...candidates].map((sessionId) => host.tasks.waitForCurrent(sessionId)))
  const stoppedSessionIds = outcomes.flatMap((outcome) => {
    if (outcome.status !== 'fulfilled' || !outcome.value.result?.stopped) {
      return []
    }
    const { sessionId, result } = outcome.value
    try {
      const record = host.deps.store.getRecord(sessionId)
      const session = host.sessions.get(sessionId)
      if (
        !record ||
        !belongs(record.location) ||
        record.lease.runtimeFence !== result.fence ||
        session?.child ||
        host.tasks.hasPending(sessionId) ||
        host.deliveryRunning(sessionId) ||
        host.childWorkIncomplete(sessionId) ||
        session?.journal.pendingSubmissions().length ||
        host.deps.hasOpenDispatch?.(record)
      ) {
        return []
      }
      return [sessionId]
    } catch (error) {
      host.deps.logger.warn('workspace chat stop receipt could not be checked', {
        scope: 'workspace-chat-receipt',
        sessionId,
        error
      })
      return []
    }
  })
  return { stoppedSessionIds }
}
