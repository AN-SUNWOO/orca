import { toast } from 'sonner'
import { translate } from '@/i18n/i18n'
import { structuredLaunchFailure } from '@/lib/structured-agent-session-launch-failure'
import { StructuredAgentSessionCreateRefusalError } from '@/lib/structured-agent-session-launch-errors'
import { activateAiVaultStructuredSession } from '@/lib/activate-ai-vault-structured-session'
import { agentSessionWriteFailureText } from '../native-chat/agent-session-write-notice-text'
import { agentLabel } from '../../../../shared/ai-vault-session-filters'
import type { RuntimeClientTarget } from '../../../../shared/runtime-client-target'
import type { CliChatResumeSource } from './cli-chat-resume-source'

export async function reportCliChatResumeFailure(
  source: CliChatResumeSource,
  error: unknown,
  openOwner: boolean,
  target: RuntimeClientTarget
): Promise<void> {
  const refusal =
    error instanceof StructuredAgentSessionCreateRefusalError ? error.refusal : undefined
  if (refusal?.details?.reason === 'terminalStopUnconfirmed') {
    toast.error('The terminal agent could not be confirmed stopped. Retry from the chat after it exits.')
    return
  }
  if (error instanceof Error && error.message.startsWith('Exit the agent in the terminal first')) {
    toast.error(error.message)
    return
  }
  if (
    refusal?.code === 'agent_session_conflict' ||
    refusal?.code === 'agent_session_ownership_unknown'
  ) {
    const owner = refusal.details?.owner
    if (openOwner && owner) {
      await activateAiVaultStructuredSession({ structuredSession: owner }, undefined, target)
      return
    }
    toast.error(owner
      ? translate(
          'auto.components.right.sidebar.AiVaultPanel.resumeInChatConflict',
          'Another chat is already holding this conversation.'
        )
      : `${agentLabel(source.agent)} is still running in a terminal. Exit it there, then switch to chat.`)
    return
  }
  if (refusal?.code === 'agent_session_identity_required') {
    if (refusal.details?.reason === 'transcriptNotFound') {
      toast.error(
        translate(
          'components.native-chat.resumeInNewChat.notSavedYet',
          "{{agent}} hasn't saved this conversation yet. Try again after it replies.",
          { agent: agentLabel(source.agent) }
        )
      )
      return
    }
    const failure = structuredLaunchFailure(error)
    if (failure) {
      toast.error(agentSessionWriteFailureText(failure, 'read-history'))
      return
    }
  }
  toast.error(
    translate(
      'auto.components.right.sidebar.AiVaultPanel.resumeInChatFailed',
      'Could not resume this session in a new chat.'
    )
  )
}
