import { legacyAgentSessionQuestionAnswers } from '../../../shared/agent-session-question-answer'
import { AcpRpcError } from '../acp-errors'
import { readAcpPermissionRequest } from '../acp-permission-requests'
import { pendingAcpResolution } from '../acp-timeline-requests'
import type { AcpDialect, AcpRequestPresentation } from './acp-dialect'

// Antigravity asks the person a question as a permission request on an `interaction_` tool call,
// one choice per option, sent even in its yolo mode: a question, never an approval to auto-allow.
function questionRequest(method: string, params: unknown): AcpRequestPresentation | undefined {
  const request =
    method === 'session/request_permission' ? readAcpPermissionRequest(params, () => {}) : null
  if (!request?.toolCall.toolCallId.startsWith('interaction_')) {
    return undefined
  }
  const body = {
    kind: 'question' as const,
    question: request.toolCall.title ?? 'Question',
    options: request.options.map((option) => ({ id: option.optionId, label: option.name })),
    resolution: pendingAcpResolution
  }
  return {
    body,
    reply: (response) => {
      if (response === null) {
        return { outcome: { outcome: 'cancelled' } }
      }
      const answers =
        response.kind === 'answers'
          ? response.answers
          : legacyAgentSessionQuestionAnswers(body, response.optionId)
      const [answer] = answers ?? []
      const optionId = answer?.optionIds[0]
      // The server takes back one of its own choices; it has no free-text answer.
      if (
        answers?.length !== 1 ||
        answer?.optionIds.length !== 1 ||
        answer.other?.trim() ||
        !body.options.some((option) => option.id === optionId)
      ) {
        throw new AcpRpcError(-32602, 'Question answer must choose one offered option')
      }
      return { outcome: { outcome: 'selected', optionId } }
    }
  }
}

export const ANTIGRAVITY_ACP_DIALECT: AcpDialect = { request: questionRequest }
