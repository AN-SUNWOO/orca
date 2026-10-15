import type { AgentStatusIpcPayload } from '../../shared/agent-status-types'
import type { StructuredAgentSessionResumeSource } from '../../shared/structured-agent-session-create'
import type { StructuredAgentId } from '../../shared/agent-session-provider-handle'
import { agentSessionRefusalError } from '../../shared/agent-session-wire-refusals'
import { adoptsCliConversations, CLI_CONVERSATION_ADOPTING_AGENTS } from '../../shared/structured-agent-cli-conversation-adoption'
import { isWslUncPath } from '../../shared/wsl-paths'
import { needsWslHostResolution } from './host-readable-transcript-path'
import { parseSshTranscriptPath } from './ssh-transcript-path'

/** A client names a pane; only this host supplies its provider path. */
export function structuredAgentCliSourcePath(input: {
  agent: StructuredAgentId
  resumeFrom: StructuredAgentSessionResumeSource
  workspaceId: string
  rows: readonly AgentStatusIpcPayload[]
}): string | undefined {
  const source = input.resumeFrom.cliSource
  if (!source) return undefined
  const row = input.rows.find((candidate) =>
    source.workspaceId === input.workspaceId && candidate.worktreeId === source.workspaceId &&
    candidate.paneKey === source.paneKey && !candidate.connectionId && !candidate.structuredHost &&
    adoptsCliConversations(candidate.agentType) &&
    CLI_CONVERSATION_ADOPTING_AGENTS[candidate.agentType] === input.agent &&
    candidate.providerSession?.id === input.resumeFrom.providerSessionId)
  if (!row) {
    throw agentSessionRefusalError('agent_session_identity_required',
      { reason: 'transcriptUnreadable' }, 'The source conversation is no longer available.')
  }
  const path = row.providerSession?.transcriptPath?.trim()
  if (path && (isWslUncPath(path) || needsWslHostResolution(path) || parseSshTranscriptPath(path))) {
    throw agentSessionRefusalError('structured_agent_session_unsupported', { reason: 'hostUnsupported' })
  }
  return path || undefined
}
