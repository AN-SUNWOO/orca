import { agentSessionProviderHandleRoot } from '../../shared/agent-session-provider-handle'
import { StructuredAgentSessionTaskQueue } from '../native-chat/agent-session-wire/structured-agent-session-task-queue'
import { structuredAgentRuntimeRegistration } from './structured-agent-runtime-registrations'

const admissions = new StructuredAgentSessionTaskQueue()

/** The host serializes each managed writer's check and start with a chat handoff. */
export function withStructuredConversationAdmission<T>(
  agent: string,
  providerSessionId: string,
  task: () => Promise<T>
): Promise<T> {
  const transport = structuredAgentRuntimeRegistration(agent)?.definition.handleTransport
  if (!transport) {
    return task()
  }
  const root = agentSessionProviderHandleRoot({
    transport,
    agent,
    nativeId: providerSessionId
  })
  return admissions.serialize(`terminal-adoption:${root}`, task)
}
