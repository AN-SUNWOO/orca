import './rpc/unused-default-rpc-methods.test-fixture'
// A dispatched chat starting helper workers on the Run it works for, on the coordinator-mail rig:
// the helpers report to it, its own mailbox never moves, and whatever it never handled goes back
// to the Run's coordinator once it settles.

import { describe, expect, it, vi } from 'vitest'
import { formatOrcaSessionAddress } from '../../shared/orca-session-address'
import { testOrcaSessionId } from '../../shared/orca-session-address-test-fixture'
import { idOf } from './rpc/orchestration-session-caller-test-fixture'
import {
  COORDINATOR,
  PEER_CHAT,
  WAIT,
  WORKER_PANE,
  call,
  coordinatorRunAndTask,
  db,
  dispatcher,
  openChat,
  request,
  runtime
} from './structured-chat-coordinator-mail-rig.test-fixture'

const WORKER = formatOrcaSessionAddress(testOrcaSessionId(PEER_CHAT))
const HELPER = 'term_worker'

async function refusal(method: string, params: Record<string, unknown>, sessionId: string) {
  const response = await dispatcher.dispatch(request(method, params, { sessionId }))
  if (response.ok) {
    throw new Error(`expected a refusal, got ${JSON.stringify(response)}`)
  }
  return response.error
}

/** The helper row worker-start reserves once the worker's authority resolved, in a live terminal. */
function reserveHelper(creatorDispatchId: string): { dispatchId: string; taskId: string } {
  const started = db.createStartingWorkerDispatch({
    creator: { kind: 'session', orcaSessionId: testOrcaSessionId(PEER_CHAT) },
    maxDepth: runtime.getNestedWorkerMaxDepth(),
    requiredCreatorDispatchId: creatorDispatchId,
    taskSpec: 'review the parser',
    taskRunId: db.getDispatchContextById(creatorDispatchId)!.run_id,
    taskParentId: db.getDispatchContextById(creatorDispatchId)!.task_id,
    startOptions: {}
  })
  db.prepareStartingWorkerAuthority({
    dispatchId: started.dispatch.id,
    handle: HELPER,
    paneKey: WORKER_PANE,
    processIncarnation: `runtime_test:${HELPER}:1`,
    worktreeId: 'repo::worker',
    effects: [],
    setupState: 'not_applicable'
  })
  db.markWorkerDispatchReady(started.dispatch.id)
  return { dispatchId: started.dispatch.id, taskId: started.task.id }
}

function helperSend(type: string, subject: string, helper: { dispatchId: string; taskId: string }) {
  return call('orchestration.send', {
    from: HELPER,
    type,
    subject,
    payload: JSON.stringify({ ...helper, outcome: 'succeeded' })
  })
}

type InboxMessage = { id: string; subject: string; type: string }

async function check(
  sessionId: string,
  ack?: unknown
): Promise<{ deliveryId: unknown; messages: InboxMessage[] }> {
  const inbox = await call('orchestration.check', ack ? { ack } : {}, { sessionId })
  const messages = Array.isArray(inbox.messages)
    ? inbox.messages.map((message: Record<string, unknown>) => ({
        id: String(message.id),
        subject: String(message.subject),
        type: String(message.type)
      }))
    : []
  return { deliveryId: inbox.deliveryId, messages }
}

async function subjects(sessionId: string, ack?: unknown): Promise<string[]> {
  return (await check(sessionId, ack)).messages.map((message) => message.subject)
}

describe('a worker starting helpers on the Run it works for', () => {
  it('gets their reports and questions in its own check, and hands the unhandled rest to the Run when it settles', async () => {
    await openChat(COORDINATOR)
    await openChat(PEER_CHAT)
    const { runId, taskId } = await coordinatorRunAndTask()
    const parent = idOf(
      (await call('orchestration.dispatch', { task: taskId, to: WORKER }, { sessionId: COORDINATOR }))
        .dispatch
    )
    vi.spyOn(runtime, 'getNestedWorkerMaxDepth').mockReturnValue(2)

    // The coordinator seat no longer gates it: the worker reaches the helper-scope rules instead.
    expect(
      await refusal(
        'orchestration.workerStart',
        { run: runId, spec: 'review', terminal: HELPER },
        PEER_CHAT
      )
    ).toMatchObject({ code: 'invalid_argument', message: expect.stringContaining('--terminal') })

    const helper = reserveHelper(parent)
    expect(db.getDispatchContextById(helper.dispatchId)).toMatchObject({
      run_id: runId,
      creator_dispatch_id: parent,
      depth: 2
    })

    await helperSend('escalation', 'Blocked on fixtures', helper)
    const asked = call('orchestration.ask', { from: HELPER, question: 'Which parser?' })
    await vi.waitFor(
      () => expect(db.db.prepare('SELECT COUNT(*) AS n FROM question_threads').get()).toEqual({ n: 1 }),
      WAIT
    )
    const inbox = await check(PEER_CHAT)
    const messages = inbox.messages
    expect(messages.map((message) => message.subject)).toEqual(['Blocked on fixtures', 'Question'])
    await call(
      'orchestration.reply',
      { id: messages.find((message) => message.type === 'question')!.id, body: 'the TOML one' },
      { sessionId: PEER_CHAT }
    )
    expect(await asked).toMatchObject({ answer: 'the TOML one' })

    expect(await subjects(COORDINATOR)).toEqual([])
    expect(await call('orchestration.runCurrent', {}, { sessionId: PEER_CHAT })).toEqual({
      run: null
    })

    // The worker's last check acknowledges what it read; what arrives after goes to the Run.
    expect(await subjects(PEER_CHAT, inbox.deliveryId)).toEqual([])
    await helperSend('escalation', 'Blocked again', helper)
    await call(
      'orchestration.send',
      {
        type: 'worker_done',
        subject: 'Parent done',
        payload: JSON.stringify({ taskId, dispatchId: parent, outcome: 'succeeded' })
      },
      { sessionId: PEER_CHAT }
    )
    await helperSend('worker_done', 'Helper done', helper)
    expect(await subjects(COORDINATOR)).toEqual(['Blocked again', 'Parent done', 'Helper done'])
  })
})
