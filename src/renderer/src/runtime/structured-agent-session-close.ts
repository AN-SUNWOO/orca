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

/** Refuse Sleep before teardown when a paired host cannot stop native chats. */
export async function assertStructuredAgentSessionSleepSupported(
  target: RuntimeClientTarget
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
}

export const AGENT_SESSION_SLEEP_UNSUPPORTED = 'agent_session_sleep_unsupported'
