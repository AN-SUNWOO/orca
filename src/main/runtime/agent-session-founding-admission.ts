import {
  AgentSessionRefusalError,
  agentSessionRefusalError,
  isAgentSessionRefusalError
} from '../../shared/agent-session-wire-refusals'
import { agentSessionOperationKey } from '../../shared/agent-session-operation-ledger'
import { foundAgentSessionRecord } from './agent-session-record-founding'
import { agentSessionExecutionLocationsEqual } from '../../shared/agent-session-record'
import { agentSessionAccountHomesEqual } from '../../shared/agent-session-account-home'
import { agentSessionProviderHandleRoot } from '../../shared/agent-session-provider-handle'
import {
  assertAdoptedConversationUnowned,
  assertReservedTabUnheld,
  evaluateAgentSessionReserveOperation,
  requireAgentSessionRecordForReplay,
  validateAgentSessionReservationInput,
  type AgentSessionReserveRequest,
  type AgentSessionReserveResult
} from './agent-session-reservation-admission'
import type { AgentSessionStoreState } from './agent-session-store-state'
import { setAgentSessionTabVisibility } from './agent-session-tab-table'

/** The same create admission as a reservation, with no obligation to acquire an owner. */
export function commitAgentSessionFounding(
  state: AgentSessionStoreState,
  request: AgentSessionReserveRequest
): AgentSessionReserveResult {
  const decision = evaluateAgentSessionReserveOperation(state, request)
  if (decision.decision === 'refused') {
    throw agentSessionRefusalError(decision.code, decision.details)
  }
  if (decision.decision === 'replay') {
    return {
      record: requireAgentSessionRecordForReplay(state, decision.row, request.sessionId),
      disposition: 'replayed',
      operationRow: decision.row
    }
  }
  validateAgentSessionReservationInput(request)
  if (request.expectedFence !== null) {
    throw agentSessionRefusalError('agent_session_operation_invalid', {
      reason: 'requestMalformed'
    })
  }
  if (state.unreadableRecords.has(request.sessionId)) {
    throw agentSessionRefusalError('execution_owner_reconciling', { reason: 'recordUnreadable' })
  }
  if (state.records.has(request.sessionId)) {
    const existing = state.records.get(request.sessionId)
    if (
      !request.adoptionHandoff ||
      !existing ||
      existing.adoptionSurvivors === undefined ||
      existing.lease.ownerProcess !== null ||
      existing.provider !== request.provider ||
      !agentSessionAccountHomesEqual(existing.accountHome, request.accountHome) ||
      !agentSessionExecutionLocationsEqual(existing.location, request.location) ||
      !request.adoptedHandleLink ||
      existing.providerHandleChain.length !== 1 ||
      agentSessionProviderHandleRoot(existing.providerHandleChain[0].handle) !==
        agentSessionProviderHandleRoot(request.adoptedHandleLink.handle)
    ) {
      throw agentSessionRefusalError('agent_session_conflict', { reason: 'sessionExists' })
    }
    assertAdoptedConversationUnowned(state, request)
    assertReservedTabUnheld(state, request)
    state.operations.set(agentSessionOperationKey(decision.row.callerKey, decision.row.operationId), decision.row)
    setAgentSessionTabVisibility(state, request.sessionId, true, request.surfaceTabId)
    return { record: existing, disposition: 'created', operationRow: decision.row }
  }
  try {
    assertAdoptedConversationUnowned(state, request)
  } catch (error) {
    if (isAgentSessionRefusalError(error)) {
      throw new AgentSessionRefusalError({
        ...error.refusal,
        createAttemptRefusedBeforeCommit: true
      })
    }
    throw error
  }
  assertReservedTabUnheld(state, request)
  const founded = foundAgentSessionRecord(request, request)
  const record = request.adoptedHandleLink
    ? {
        ...founded,
        providerHandleChain: [request.adoptedHandleLink],
        ...(request.adoptionHandoff ? { adoptionSurvivors: [] } : {})
      }
    : founded
  const operationRow = {
    ...decision.row,
    outcome: request.adoptionHandoff
      ? { status: 'pending' as const }
      : { status: 'succeeded' as const, sessionId: request.sessionId }
  }
  state.records.set(request.sessionId, record)
  state.operations.set(
    agentSessionOperationKey(operationRow.callerKey, operationRow.operationId),
    operationRow
  )
  setAgentSessionTabVisibility(state, request.sessionId, true, request.surfaceTabId)
  return { record, disposition: 'created', operationRow }
}
