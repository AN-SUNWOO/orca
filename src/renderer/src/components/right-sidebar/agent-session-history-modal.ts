import { useAppStore } from '@/store'
import { normalizeExecutionHostId } from '../../../../shared/execution-host'
import type { AiVaultPanelWorkspace } from './ai-vault-panel-workspace'

export type AgentSessionHistoryModalRequest = {
  workspace: AiVaultPanelWorkspace
  initialQuery: string
}

/** Opens Session History in the app's modal slot, scoped to `workspace`. */
export function openAgentSessionHistoryModal(request: AgentSessionHistoryModalRequest): void {
  useAppStore.getState().openModal('agent-session-history', {
    worktreeId: request.workspace.worktreeId,
    executionHostId: request.workspace.executionHostId,
    initialQuery: request.initialQuery
  })
}

export function readAgentSessionHistoryModalRequest(
  data: Record<string, unknown>
): AgentSessionHistoryModalRequest | null {
  if (typeof data.worktreeId !== 'string') {
    return null
  }
  const executionHostId =
    typeof data.executionHostId === 'string' ? normalizeExecutionHostId(data.executionHostId) : null
  return {
    workspace: {
      worktreeId: data.worktreeId,
      ...(executionHostId ? { executionHostId } : {})
    },
    initialQuery: typeof data.initialQuery === 'string' ? data.initialQuery : ''
  }
}
