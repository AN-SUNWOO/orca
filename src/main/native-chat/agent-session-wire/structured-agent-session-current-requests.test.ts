import { afterEach, expect, it, vi } from 'vitest'
import { AGENT_JOURNAL_THREAD_SCOPE } from '../../../shared/agent-session-journal-types'
import { MOBILE_BRIDGE_MAX_FRAME_BYTES } from '../../../shared/mobile-bridge-frame-bytes'
import { createStructuredAgentSessionEventCoalescer } from '../../../shared/structured-agent-session-coalescer'
import {
  EMPTY_STRUCTURED_AGENT_SESSION,
  reduceStructuredAgentSession
} from '../../../shared/structured-agent-session-reducer'
import { pendingStructuredSessionPrompts } from '../../../renderer/src/components/native-chat/structured-agent-session-message-projection'
import {
  HOST_TEST_SESSION as SESSION,
  HOST_TEST_THREAD as THREAD,
  hostTestOperationId
} from './structured-agent-session-host-test-data'
import {
  currentJournal,
  exitWhileSettlementFails
} from './structured-agent-session-leftover-settlement.test-fixture'
import {
  createQueuedMessageTestRig,
  QUEUED_RIG_CALLER,
  type QueuedMessageTestRig
} from './structured-agent-session-queued-message-rig.test-fixture'

let rig: QueuedMessageTestRig | undefined
afterEach(async () => {
  await rig?.dispose()
  rig = undefined
  vi.restoreAllMocks()
})

it('keeps full child requests answerable outside the bounded transcript and clears ended work without a row', async () => {
  rig = await createQueuedMessageTestRig({ restartable: true })
  const current = rig
  await current.workingSend()
  const journal = currentJournal(current)
  const parent = { provider: 'codex' as const, threadId: THREAD, turnId: 'parent', ordinal: 0 }
  const attribution = { fence: 1, ownerFence: 1, turnScope: AGENT_JOURNAL_THREAD_SCOPE }
  await journal.appendItem(
    parent,
    { kind: 'turn', turnId: 'parent', state: 'running' },
    attribution
  )
  const pending = {
    state: 'pending',
    selectedOptionId: null,
    resolvedBy: null,
    resolvedAt: null
  }
  const approval = await journal.appendItem(
    { provider: 'codex', threadId: THREAD, turnId: 'child', ordinal: 1 },
    {
      kind: 'approval',
      title: 'Run child command?',
      detail: 'inspect all files',
      options: [{ id: 'yes', label: 'Allow child' }],
      resolution: pending
    },
    {
      fence: 1,
      ownerFence: 1,
      agentId: 'child',
      turnScope: AGENT_JOURNAL_THREAD_SCOPE
    }
  )
  const longChoice = '\\"😀'.repeat(30_000)
  const question = await journal.appendItem(
    { provider: 'codex', threadId: THREAD, turnId: 'child', ordinal: 2 },
    {
      kind: 'question',
      question: 'Choose a path',
      options: [],
      questions: [
        {
          id: 'path',
          question: 'Which?',
          multiSelect: true,
          options: [{ id: 'exact-id', label: longChoice }]
        }
      ],
      resolution: pending
    },
    {
      fence: 1,
      ownerFence: 1,
      agentId: 'child',
      turnScope: AGENT_JOURNAL_THREAD_SCOPE
    }
  )
  await journal.appendItem(
    parent,
    { kind: 'turn', turnId: 'parent', state: 'completed' },
    attribution
  )
  let state = EMPTY_STRUCTURED_AGENT_SESSION
  const coalescer = createStructuredAgentSessionEventCoalescer((event) => {
    state = reduceStructuredAgentSession(state, { type: 'event', event })
  })
  const emit = (event: Parameters<typeof coalescer.push>[0]) => {
    expect(Buffer.byteLength(JSON.stringify(event))).toBeLessThan(MOBILE_BRIDGE_MAX_FRAME_BYTES)
    coalescer.push(event)
  }
  const close = await current.host.subscribe({
    id: 'visible',
    sessionId: SESSION,
    boundedFrames: true,
    emit
  })
  expect(state.currentRequests?.map((item) => item.itemId)).toEqual([
    approval.itemId,
    question.itemId
  ])
  const cursor = state.cursor
  if (!cursor) throw new Error('expected hydrated cursor')
  close()
  for (let ordinal = 0; ordinal < 205; ordinal++) {
    await journal.appendItem(
      { provider: 'codex', threadId: THREAD, turnId: 'root-output', ordinal },
      {
        kind: 'message',
        role: 'assistant',
        blocks: [{ type: 'text', text: `Root ${ordinal}` }]
      },
      { fence: 1, ownerFence: 1, turnScope: AGENT_JOURNAL_THREAD_SCOPE }
    )
  }
  await current.host.subscribe({
    id: 'reopened',
    sessionId: SESSION,
    boundedFrames: true,
    cursor,
    emit
  })
  coalescer.flush()
  expect(state.items.length).toBeLessThanOrEqual(200)
  expect(
    state.items.some((item) => item.itemId === approval.itemId || item.itemId === question.itemId)
  ).toBe(false)
  const prompts = pendingStructuredSessionPrompts(state.items, state.currentRequests)
  expect(prompts.map((item) => item.itemId)).toEqual([approval.itemId, question.itemId])
  expect(prompts[1]?.body).toMatchObject({
    questions: [
      {
        id: 'path',
        multiSelect: true,
        options: [{ id: 'exact-id', label: longChoice }]
      }
    ]
  })
  const answer = {
    itemId: approval.itemId,
    expectedRevision: approval.revision,
    optionId: 'yes'
  }
  expect(
    await current.host.respondToPrompt(QUEUED_RIG_CALLER, {
      ...answer,
      kind: 'approval',
      envelope: current.envelope(answer, 'agentSession.respondTo:approval', hostTestOperationId())
    })
  ).toMatchObject({ ok: true })
  await vi.waitFor(() =>
    expect(state.currentRequests?.map((item) => item.itemId)).toEqual([question.itemId])
  )
  const beforeExit = journal.cursor()
  await exitWhileSettlementFails(current)
  await vi.waitFor(() => expect(state.currentRequests).toEqual([]))
  expect(journal.cursor()).toEqual(beforeExit)
  expect(pendingStructuredSessionPrompts(state.items, state.currentRequests)).toEqual([])
  coalescer.dispose()
})
