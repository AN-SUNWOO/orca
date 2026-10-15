import { openAgentSessionJournal } from '../agent-session-journal/journal-store-factory'
import { journalIdentityFor } from './structured-agent-session-attach'
import { attachParamsForRecord } from './structured-agent-session-conversation-open'
import type { StructuredAgentSessionHostDeps } from './structured-agent-session-host-types'

/** Closing an unlaunched reservation can discard it only while its journal is still empty. */
export async function isUnimportedAgentSessionJournal(
  deps: StructuredAgentSessionHostDeps,
  sessionId: string
): Promise<boolean> {
  const record = deps.store.getRecord(sessionId)
  if (!record) {
    return false
  }
  const params = attachParamsForRecord(record, {
    clientOperationId: `close-reservation:${sessionId}`,
    expectedRuntimeFence: record.lease.runtimeFence
  })
  const journal = await openAgentSessionJournal({
    identity: journalIdentityFor(record, params), database: deps.journalDatabase
  })
  const empty = journal.cursor().sequence === 0
  await journal.close()
  return empty
}
