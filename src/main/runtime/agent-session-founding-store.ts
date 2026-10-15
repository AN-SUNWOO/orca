import { agentSessionRefusalError } from '../../shared/agent-session-wire-refusals'
import type { AgentSessionWireRefusal } from '../../shared/agent-session-wire'
import type { AgentProcessIdentity } from '../../shared/agent-process-presence'
import { agentSessionOperationKey } from '../../shared/agent-session-operation-ledger'
import { agentSessionAccountHomesEqual } from '../../shared/agent-session-account-home'
import { agentSessionExecutionLocationsEqual } from '../../shared/agent-session-record'
import { agentSessionProviderHandleRoot } from '../../shared/agent-session-provider-handle'
import { setAgentSessionTabVisibility } from './agent-session-tab-table'
import type { AgentSessionStoreState } from './agent-session-store-state'
import type { JournalOperationReceipt } from '../native-chat/agent-session-journal/journal-row-writer'
import { commitAgentSessionFounding } from './agent-session-founding-admission'
import type { AgentSessionReserveRequest } from './agent-session-reservation-admission'
import { draftAgentSessionStoreState } from './agent-session-store-draft'
import type { AgentSessionStoreTransactions } from './agent-session-store-transactions'

/** Founding shares the store's admission and publishes only after the message transaction commits. */
export function createAgentSessionFoundingStore(
  transactions: AgentSessionStoreTransactions,
  firstRecordListeners: ReadonlySet<() => void>
) {
  const operationKey = (request: AgentSessionReserveRequest) =>
    agentSessionOperationKey(request.operation.callerKey, request.operation.operationId)
  const pendingAdoption = (
    draft: AgentSessionStoreState,
    request: AgentSessionReserveRequest
  ) => {
    const record = draft.records.get(request.sessionId)
    const row = draft.operations.get(operationKey(request))
    if (
      !record ||
      record.adoptionSurvivors === undefined ||
      row?.outcome.status !== 'pending' ||
      record.lease.ownerProcess !== null ||
      record.provider !== request.provider ||
      !agentSessionExecutionLocationsEqual(record.location, request.location) ||
      !agentSessionAccountHomesEqual(record.accountHome, request.accountHome) ||
      !request.adoptedHandleLink ||
      record.providerHandleChain.length !== 1 ||
      agentSessionProviderHandleRoot(record.providerHandleChain[0].handle) !==
        agentSessionProviderHandleRoot(request.adoptedHandleLink.handle)
    ) {
      throw agentSessionRefusalError('agent_session_conflict', { reason: 'sessionExists' })
    }
    return { record, row }
  }
  const completeAdoption = (draft: AgentSessionStoreState, request: AgentSessionReserveRequest) => {
    const { record, row } = pendingAdoption(draft, request)
    // The caller has just re-probed the saved identities; keep them until this same commit.
    const { adoptionSurvivors: _survivors, ...completed } = record
    draft.records.set(request.sessionId, completed)
    draft.operations.set(operationKey(request), {
      ...row,
      outcome: { status: 'succeeded', sessionId: request.sessionId }
    })
    setAgentSessionTabVisibility(draft, request.sessionId, true, request.surfaceTabId)
  }
  return {
    prepare: (request: AgentSessionReserveRequest) =>
      commitAgentSessionFounding(draftAgentSessionStoreState(transactions.state), request),
    commit: async (request: AgentSessionReserveRequest) => {
      let heldBefore = true
      const result = await transactions.transact((draft) => {
        heldBefore = draft.records.size > 0 || draft.unreadableRecords.size > 0
        return commitAgentSessionFounding(draft, request)
      })
      if (!heldBefore) {
        firstRecordListeners.forEach((listener) => listener())
      }
      return result
    },
    reserveAdoption: async (request: AgentSessionReserveRequest) => {
      const result = await transactions.transact((draft) =>
        commitAgentSessionFounding(draft, { ...request, adoptionHandoff: true })
      )
      if (result.operationRow.outcome.status === 'pending') {
        firstRecordListeners.forEach((listener) => listener())
      }
      return result
    },
    receipt: (request: AgentSessionReserveRequest): JournalOperationReceipt => {
      let heldBefore = true
      const receipt = transactions.receipt((draft) => {
        heldBefore = draft.records.size > 0 || draft.unreadableRecords.size > 0
        const result = request.adoptionHandoff
          ? (completeAdoption(draft, request), null)
          : commitAgentSessionFounding(draft, request)
        if (result?.disposition === 'replayed') {
          throw agentSessionRefusalError('agent_session_operation_unknown', {
            reason: 'outcomeUnknown'
          })
        }
      })
      return {
        write: receipt.write,
        committed: () => {
          receipt.committed()
          if (!heldBefore) {
            firstRecordListeners.forEach((listener) => listener())
          }
        }
      }
    },
    adoptionSurvivors: (request: AgentSessionReserveRequest, survivors: AgentProcessIdentity[]) =>
      transactions.transact((draft) => {
        const { record } = pendingAdoption(draft, request)
        draft.records.set(request.sessionId, { ...record, adoptionSurvivors: survivors })
      }),
    failAdoption: (request: AgentSessionReserveRequest, refusal: AgentSessionWireRefusal) =>
      transactions.transact((draft) => {
        const { row } = pendingAdoption(draft, request)
        draft.operations.set(operationKey(request), {
          ...row,
          outcome: {
            status: 'failed',
            code: refusal.code,
            ...(refusal.details ? { details: refusal.details } : {}),
            ...(refusal.message ? { message: refusal.message } : {})
          }
        })
        setAgentSessionTabVisibility(draft, request.sessionId, true, request.surfaceTabId)
      }),
    cancelAdoptionBeforeStop: (request: AgentSessionReserveRequest, refusal: AgentSessionWireRefusal) =>
      transactions.transact((draft) => {
        const { record, row } = pendingAdoption(draft, request)
        if (record.adoptionSurvivors?.length !== 0) {
          throw agentSessionRefusalError('agent_session_conflict', { reason: 'terminalStopUnconfirmed' })
        }
        draft.operations.set(operationKey(request), {
          ...row,
          outcome: {
            status: 'failed',
            code: refusal.code,
            ...(refusal.details ? { details: refusal.details } : {}),
            ...(refusal.message ? { message: refusal.message } : {})
          }
        })
        setAgentSessionTabVisibility(draft, request.sessionId, false)
        draft.records.delete(request.sessionId)
      }),
    completeAdoption: (request: AgentSessionReserveRequest) =>
      transactions.transact((draft) => completeAdoption(draft, request)),
    abandonUnlaunchedAdoptionReservation: (
      sessionId: string,
      tabId: string,
      journalUnimported: boolean
    ) => transactions.transact((draft) => {
      const record = draft.records.get(sessionId)
      if (
        !record || !journalUnimported ||
        record.adoptionSurvivors === undefined ||
        record.lease.ownerProcess !== null ||
        record.lease.claimStatus !== 'released' ||
        record.providerHandleChain.length !== 1 ||
        draft.sessionTabs?.tabIdFor(sessionId) !== tabId
      ) {
        return false
      }
      setAgentSessionTabVisibility(draft, sessionId, false)
      draft.records.delete(sessionId)
      console.info('[agent-session] abandoned unlaunched terminal adoption', sessionId)
      return true
    })
  }
}
