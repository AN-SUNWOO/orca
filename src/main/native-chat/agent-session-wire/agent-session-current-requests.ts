import type { AgentJournalRenderItem } from '../../../shared/agent-session-journal-types'
import type { AgentSessionSubscribeEvent } from '../../../shared/agent-session-wire'
import { emptyAgentSessionBatch } from './agent-session-empty-batch'
import type { AgentSessionPublishedWork } from './agent-session-published-work'

export type CurrentRequestsSubscriber = {
  currentRequests?: AgentJournalRenderItem[]
  requestVersion?: number
}

// Six escaped bytes per UTF-16 unit still leave ample room inside a 640 KiB frame.
const REQUEST_PART_UNITS = 48 * 1024
const serializedRequests = new WeakMap<AgentJournalRenderItem[], string>()

/** Full records on independent empty batches, never the lossy history-row formatter. */
export function emitCurrentRequests(
  subscriber: CurrentRequestsSubscriber,
  event: AgentSessionSubscribeEvent,
  work: Pick<AgentSessionPublishedWork, 'actionablePrompts' | 'viewKey'> | undefined,
  emit: (event: AgentSessionSubscribeEvent) => void
): void {
  if (!work || event.type === 'end') {
    emit(event)
    return
  }
  const requests = work.actionablePrompts()
  if (
    event.type === 'batch' &&
    subscriber.currentRequests?.length === requests.length &&
    requests.every((item, index) => item === subscriber.currentRequests?.[index])
  ) {
    emit(event)
    return
  }
  let json = serializedRequests.get(requests)
  if (json === undefined) {
    json = JSON.stringify(requests)
    serializedRequests.set(requests, json)
  }
  const count = Math.ceil(json.length / REQUEST_PART_UNITS) + 1
  const id = (subscriber.requestVersion ?? 0) + 1
  const cursor =
    event.type === 'batch'
      ? event.batch.cursor
      : (event.page.liveCursor ?? event.page.window.nextCursor)
  for (let index = 0; index < count; index++) {
    const currentRequests = {
      id,
      view: work.viewKey(),
      index,
      count,
      json:
        index === 0 ? '' : json.slice((index - 1) * REQUEST_PART_UNITS, index * REQUEST_PART_UNITS)
    }
    emit(
      index === 0
        ? { ...event, currentRequests }
        : {
            type: 'batch',
            sessionId: event.sessionId,
            batch: emptyAgentSessionBatch(cursor),
            ...(event.fence === undefined ? {} : { fence: event.fence }),
            ...(event.hostNow === undefined ? {} : { hostNow: event.hostNow }),
            ...(event.type === 'batch' && event.hasNewer ? { hasNewer: true as const } : {}),
            currentRequests
          }
    )
  }
  subscriber.currentRequests = requests
  subscriber.requestVersion = id
}
