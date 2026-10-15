import { expect, it } from 'vitest'
import type { AgentJournalRenderItem } from '../../../shared/agent-session-journal-types'
import type { AgentSessionSubscribeEvent } from '../../../shared/agent-session-wire'
import {
  EMPTY_STRUCTURED_AGENT_SESSION,
  reduceStructuredAgentSession,
  type StructuredAgentSessionState
} from '../../../shared/structured-agent-session-reducer'
import { pendingStructuredSessionPrompts } from '../../../renderer/src/components/native-chat/structured-agent-session-message-projection'
import {
  emitCurrentRequests,
  type CurrentRequestsSubscriber
} from './agent-session-current-requests'

it('publishes only complete versions, discards interrupted transfers, and preserves old-host fallback', () => {
  const prompt: AgentJournalRenderItem = {
    itemId: 'child-approval' + 'x'.repeat(9000),
    revision: 4,
    sequence: 1,
    observedAt: 10,
    body: {
      kind: 'approval',
      title: 'Inspect?',
      detail: '\\"😀'.repeat(50_000),
      options: [{ id: 'yes', label: 'Yes' }],
      resolution: {
        state: 'pending',
        selectedOptionId: null,
        resolvedBy: null,
        resolvedAt: null
      }
    }
  }
  let state: StructuredAgentSessionState = {
    ...EMPTY_STRUCTURED_AGENT_SESSION,
    epoch: 'e',
    cursor: { epoch: 'e', sequence: 10 },
    items: [prompt]
  }
  expect(pendingStructuredSessionPrompts(state.items, state.currentRequests)).toEqual([prompt])
  const batch = {
    type: 'batch' as const,
    actionablePromptIds: [prompt.itemId],
    sessionId: 's',
    fence: 1,
    batch: {
      cursor: state.cursor,
      items: [],
      removedItemIds: [],
      submissions: []
    }
  }
  const subscriber: CurrentRequestsSubscriber = {}
  const frames: AgentSessionSubscribeEvent[] = []
  emitCurrentRequests(
    subscriber,
    batch,
    { actionablePrompts: () => [prompt], viewKey: () => '1' },
    (event) =>
      frames.push(...boundedFrames(event, { queued: undefined, backgroundTasks: undefined }))
  )
  expect(frames.length).toBeGreaterThan(1)
  expect(frames[0]).not.toHaveProperty('actionablePromptIds')
  for (const event of frames.slice(0, -1)) {
    state = reduceStructuredAgentSession(state, { type: 'event', event })
    expect(state.currentRequests).toBeUndefined()
  }
  state = reduceStructuredAgentSession(state, {
    type: 'event',
    event: { type: 'end' }
  })
  expect(state.requestTransfer).toBeUndefined()
  state = reduceStructuredAgentSession(state, {
    type: 'event',
    event: frames.at(-1)!
  })
  expect(state.currentRequests).toBeUndefined()
  for (const event of frames) state = reduceStructuredAgentSession(state, { type: 'event', event })
  expect(state.currentRequests).toEqual([prompt])
  const page = {
    sessionId: 's',
    epoch: 'e',
    direction: 'tail' as const,
    items: [],
    removedItemIds: [],
    submissions: [],
    window: { oldest: null, newest: null, nextCursor: state.cursor! },
    liveCursor: state.cursor!,
    hasOlder: true,
    hasNewer: false
  }
  state = reduceStructuredAgentSession(state, { type: 'history-page', page })
  expect(state.currentRequests).toEqual([prompt])
  const clear: AgentSessionSubscribeEvent[] = []
  emitCurrentRequests(
    subscriber,
    batch,
    { actionablePrompts: () => [], viewKey: () => 'released' },
    (event) => clear.push(event)
  )
  for (const event of clear) state = reduceStructuredAgentSession(state, { type: 'event', event })
  expect(pendingStructuredSessionPrompts([prompt], state.currentRequests)).toEqual([])
  for (const event of frames) state = reduceStructuredAgentSession(state, { type: 'event', event })
  expect(state.currentRequests).toEqual([])
  state = reduceStructuredAgentSession(state, {
    type: 'event',
    event: {
      type: 'snapshot',
      sessionId: 's',
      fence: 2,
      page: {
        ...page,
        epoch: 'next',
        liveCursor: { epoch: 'next', sequence: 0 }
      }
    }
  })
  expect(state.currentRequests).toBeUndefined()
  expect(state.requestTransfer).toBeUndefined()
})
