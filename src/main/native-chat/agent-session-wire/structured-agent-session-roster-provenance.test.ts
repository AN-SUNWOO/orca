// A roster row and a background-task row are revised in place across generations, so each entry
// carries the generation that last observed it. Settling an ended generation settles only the
// entries it observed; a later live generation's children stay as they are.

import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  AGENT_JOURNAL_THREAD_SCOPE,
  type AgentJournalItemBody
} from '../../../shared/agent-session-journal-types'
import { claudeProviderHandle } from '../../../shared/agent-session-provider-handle-encoding'
import {
  agentSessionLeaseFixture,
  agentSessionRecordFixture
} from '../../../shared/agent-session-record.test-fixture'
import { backgroundTaskJournalBody } from '../../../shared/native-chat-background-task-row'
import {
  isBackgroundTaskBlock,
  isSubagentGroupBlock,
  type NativeChatBackgroundTaskBlock,
  type NativeChatSubagentEntry
} from '../../../shared/native-chat-types'
import {
  claudeBackgroundTaskIdentity,
  claudeBackgroundTaskBody
} from '../../claude/claude-background-task-row-journal'
import { claudeSubagentGroupIdentity } from '../../claude/claude-subagent-journaled-roster'
import { createTrackedJournalOpener } from '../agent-session-journal/journal-host-database-test-support'
import { subagentGroupJournalBody } from '../agent-session-journal/journal-subagent-group-body'
import type { AgentSessionJournal } from '../agent-session-journal/journal-store'
import { createDeferredStructuredAgentSessionEventSink } from './structured-agent-session-event-sink'
import { settleStructuredAgentSessionLeftovers } from './structured-agent-session-leftover-settlement'
import { testEventSinkLogging } from './structured-agent-session-logger-test-support'
import { backgroundSettlementWrites } from './structured-agent-session-background-writes'

const SESSION = 'orca-session'
const GROUP = 'claude-session:turn-a'
const ENDED = 1
const LIVE = 3

const journals = createTrackedJournalOpener()
let root: string

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'orca-roster-provenance-'))
})

afterEach(async () => {
  await journals.closeAll()
  await rm(root, { recursive: true, force: true })
})

function child(id: string, extra: Partial<NativeChatSubagentEntry> = {}): NativeChatSubagentEntry {
  return { id, label: `Child ${id}`, state: 'working', startedAt: 1, ...extra }
}

function task(
  taskId: string,
  extra: Partial<NativeChatBackgroundTaskBlock> = {}
): NativeChatBackgroundTaskBlock {
  return {
    type: 'background-task',
    taskId,
    kind: 'command',
    label: `Task ${taskId}`,
    state: 'working',
    startedAt: 1,
    ...extra
  }
}

/** One provider process of generation `fence`, observing rows through the host's event sink. */
async function observeAt(
  journal: AgentSessionJournal,
  fence: number,
  rows: readonly (readonly [ReturnType<typeof claudeSubagentGroupIdentity>, AgentJournalItemBody])[]
): Promise<void> {
  const deferred = createDeferredStructuredAgentSessionEventSink(testEventSinkLogging())
  deferred.bind({ journal, fence, publish: () => {} })
  for (const [identity, body] of rows) {
    deferred.sink.appendItem(identity, body, { turnScope: AGENT_JOURNAL_THREAD_SCOPE })
  }
  await expect(deferred.drained()).resolves.toEqual({ ok: true })
  deferred.close()
}

function children(journal: AgentSessionJournal): NativeChatSubagentEntry[] {
  return journal
    .snapshot()
    .items.flatMap((item) =>
      item.body.kind === 'message'
        ? item.body.blocks.flatMap((block) => (isSubagentGroupBlock(block) ? block.agents : []))
        : []
    )
}

function tasks(journal: AgentSessionJournal): NativeChatBackgroundTaskBlock[] {
  return journal
    .snapshot()
    .items.flatMap((item) =>
      item.body.kind === 'message' ? item.body.blocks.filter(isBackgroundTaskBlock) : []
    )
}

function openJournal(): Promise<AgentSessionJournal> {
  return journals.open({
    identity: {
      sessionId: SESSION,
      workspaceId: 'workspace-1',
      hostId: 'local',
      agent: 'claude',
      providerHandle: claudeProviderHandle('claude-session', null)
    },
    now: () => 9_000,
    stateDirectory: root
  })
}

describe('settling an ended generation’s roster', () => {
  it('settles only the children and tasks it observed; the live generation’s stay working', async () => {
    const journal = await openJournal()
    // Generation F spawns a child and starts two background commands, then dies uncleaned.
    await observeAt(journal, ENDED, [
      [claudeSubagentGroupIdentity(GROUP), subagentGroupJournalBody(GROUP, [child('a')])],
      [claudeBackgroundTaskIdentity('bg-1'), claudeBackgroundTaskBody(task('bg-1'))],
      [claudeBackgroundTaskIdentity('bg-2'), claudeBackgroundTaskBody(task('bg-2'))]
    ])
    // Generation F+1 resumes the same group row with a new child of its own, carrying F's child
    // unchanged, and reports progress on one of F's commands, which it now runs.
    await observeAt(journal, LIVE, [
      [
        claudeSubagentGroupIdentity(GROUP),
        subagentGroupJournalBody(GROUP, [child('a'), child('b')])
      ],
      [
        claudeBackgroundTaskIdentity('bg-2'),
        backgroundTaskJournalBody(task('bg-2', { tokens: 50 }))
      ]
    ])
    expect(children(journal).map(({ id, ownerFence }) => [id, ownerFence])).toEqual([
      ['a', ENDED],
      ['b', LIVE]
    ])
    expect(tasks(journal).map(({ taskId, ownerFence }) => [taskId, ownerFence])).toEqual([
      ['bg-1', ENDED],
      ['bg-2', LIVE]
    ])

    // F+1 holds the lease, live; the settlement judges everything below it.
    const live = agentSessionRecordFixture(
      agentSessionLeaseFixture({ sessionId: SESSION, runtimeFence: LIVE })
    )
    expect(
      await settleStructuredAgentSessionLeftovers({
        store: { getRecord: (sessionId) => (sessionId === SESSION ? live : null) },
        sessionId: SESSION,
        journal,
        writes: backgroundSettlementWrites(journal)
      })
    ).toMatchObject({ ok: true })

    expect(children(journal).map(({ id, state }) => [id, state])).toEqual([
      ['a', 'unverifiable'],
      ['b', 'working']
    ])
    expect(tasks(journal).map(({ taskId, state }) => [taskId, state])).toEqual([
      ['bg-1', 'unverifiable'],
      ['bg-2', 'working']
    ])
    // Settled once: a second pass finds nothing of F's left.
    expect(
      await settleStructuredAgentSessionLeftovers({
        store: { getRecord: () => live },
        sessionId: SESSION,
        journal,
        writes: backgroundSettlementWrites(journal)
      })
    ).toEqual({ ok: true, planned: 0 })
  })
})
