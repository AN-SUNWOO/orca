import type { AgentJournalMessageItem } from '../../../shared/agent-session-journal-types'
import { computeAgentSessionPayloadFingerprint } from '../../../shared/agent-session-mutation-envelope'
import type { AgentSessionRecord } from '../../../shared/agent-session-record'
import type { AgentSessionReserveRequest } from '../../runtime/agent-session-reservation-admission'
import type { StructuredAgentSessionAttachContext } from './structured-agent-session-attach-context'
import type { AgentSessionAttachParams } from './structured-agent-session-attach'
import type { StructuredAgentSessionHostSession } from './structured-agent-session-host-types'
import { observedReceipt } from './structured-agent-session-operation-settlement'
import { performSend } from './structured-agent-session-turns'

/** The first message commits the founding receipt in the same journal transaction. */
export function sendOpeningAgentSessionMessage(input: {
  context: StructuredAgentSessionAttachContext
  request: AgentSessionReserveRequest
  params: AgentSessionAttachParams
  record: AgentSessionRecord
  session: StructuredAgentSessionHostSession
  callerKey: string
  first: { clientMessageId: string; body: AgentJournalMessageItem }
}) {
  const { context, request, params, record, session, callerKey, first } = input
  const { deps } = context
  const sessionId = params.envelope.sessionId
  return performSend(
    {
      sessionId,
      journal: session.journal,
      fence: record.lease.runtimeFence,
      adapter: deps.adapter,
      agents: deps.agents,
      agent: params.agent,
      logger: deps.logger,
      resolvedBy: callerKey,
      persistOptions: async () => {},
      publish: () => {},
      operationReceipt: observedReceipt(deps.store, deps.store.founding.receipt(request)),
      now: context.now
    },
    {
      ...first,
      payloadFingerprint: computeAgentSessionPayloadFingerprint({
        method: 'agentSession.send',
        sessionId,
        fields: { body: first.body }
      }),
      origin: 'client',
      source: { kind: 'user' },
      ...openingMessageOptions(record.options)
    }
  )
}

function openingMessageOptions(options: Readonly<Record<string, string>> | undefined): {
  options?: Readonly<Record<string, string>>
} {
  const { model, effort } = options ?? {}
  return model ? { options: { model, ...(effort ? { effort } : {}) } } : {}
}
