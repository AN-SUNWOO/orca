import { STRUCTURED_AGENT_SESSION_RUNTIME_CAPABILITY } from '../../../shared/protocol-version'
import { STRUCTURED_AGENT_SESSION_SLEEP_RUNTIME_CAPABILITY } from '../../../shared/structured-agent-session-surface-capabilities'
import { runtimeEnvironmentSupportsCapability } from './runtime-rpc-client'
import type { RuntimeClientTarget } from '../../../shared/runtime-client-target'
import { callStructuredAgentSession } from './structured-agent-session-client'

export async function closeStructuredAgentSession(
  target: RuntimeClientTarget,
  sessionId: string
): Promise<'closed' | 'unsupported'> {
  if (
    target.kind === 'environment' &&
    !(await runtimeEnvironmentSupportsCapability(
      target.environmentId,
      STRUCTURED_AGENT_SESSION_RUNTIME_CAPABILITY
    ))
  ) {
    return 'unsupported'
  }
  await callStructuredAgentSession(target, 'agentSession.close', { sessionId })
  return 'closed'
}

/** Stops a chat's agent and keeps its tab, for Sleep; throws unless the host proved the stop. */
export async function sleepStructuredAgentSession(
  target: RuntimeClientTarget,
  sessionId: string
): Promise<void> {
  if (
    target.kind === 'environment' &&
    !(await runtimeEnvironmentSupportsCapability(
      target.environmentId,
      STRUCTURED_AGENT_SESSION_SLEEP_RUNTIME_CAPABILITY
    ))
  ) {
    throw new Error(AGENT_SESSION_SLEEP_UNSUPPORTED)
  }
  await callStructuredAgentSession(target, 'agentSession.sleep', { sessionId })
}

export const AGENT_SESSION_SLEEP_UNSUPPORTED = 'agent_session_sleep_unsupported'
