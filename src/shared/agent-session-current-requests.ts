import { agentSessionCurrentContextRows } from './agent-session-context-clear'
import type { AgentJournalRenderItem } from './agent-session-journal-types'
import { isAdmissibleAgentJournalRenderItem } from './agent-session-journal-schemas'

/** Optional data on existing batches; old readers ignore it and old hosts omit it. */
export type AgentSessionCurrentRequestsPart = {
  id: number
  view: string
  index: number
  count: number
  json: string
}

type RequestChunk = { json: string; previous?: RequestChunk }

export type AgentSessionCurrentRequestsState = {
  currentRequests?: AgentJournalRenderItem[]
  requestVersion?: number
  requestTransfer?: {
    id: number
    view: string
    cursor: string
    count: number
    received: number
    last?: RequestChunk
  }
}

/** An interrupted stream retains its last complete answer; contact loss is not resolution. */
export function detachedCurrentRequests(
  state: AgentSessionCurrentRequestsState
): AgentSessionCurrentRequestsState {
  return {
    currentRequests: state.currentRequests,
    requestVersion: undefined,
    requestTransfer: undefined
  }
}

export function applyCurrentRequestsPart(
  state: AgentSessionCurrentRequestsState,
  part: AgentSessionCurrentRequestsPart | undefined,
  cursor: string
): AgentSessionCurrentRequestsState {
  if (!part) return state
  if (
    !Number.isSafeInteger(part.id) ||
    part.id <= (state.requestVersion ?? 0) ||
    !Number.isSafeInteger(part.index) ||
    !Number.isSafeInteger(part.count) ||
    part.index < 0 ||
    part.count <= part.index ||
    typeof part.json !== 'string' ||
    (state.requestTransfer !== undefined && part.id < state.requestTransfer.id)
  )
    return state
  const transfer: AgentSessionCurrentRequestsState['requestTransfer'] =
    part.index === 0
      ? { id: part.id, view: part.view, cursor, count: part.count, received: 0 }
      : state.requestTransfer
  if (
    !transfer ||
    transfer.id !== part.id ||
    transfer.view !== part.view ||
    transfer.cursor !== cursor ||
    transfer.count !== part.count ||
    transfer.received !== part.index
  )
    return state
  const last = { json: part.json, previous: transfer.last }
  if (transfer.received + 1 !== part.count) {
    return {
      ...state,
      requestTransfer: { ...transfer, received: transfer.received + 1, last }
    }
  }
  const chunks: string[] = []
  for (let chunk: RequestChunk | undefined = last; chunk; chunk = chunk.previous)
    chunks.push(chunk.json)
  try {
    const value: unknown = JSON.parse(chunks.reverse().join(''))
    if (!Array.isArray(value) || !value.every(isAdmissibleAgentJournalRenderItem))
      return { ...state, requestTransfer: undefined }
    if (
      !value.every(
        (item) =>
          (item.body.kind === 'approval' || item.body.kind === 'question') &&
          item.body.resolution.state === 'pending'
      )
    )
      return { ...state, requestTransfer: undefined }
    return {
      currentRequests: value,
      requestVersion: part.id,
      requestTransfer: undefined
    }
  } catch {
    return { ...state, requestTransfer: undefined }
  }
}

export type AgentSessionCurrentRequest = AgentJournalRenderItem & {
  body: Extract<AgentJournalRenderItem['body'], { kind: 'approval' | 'question' }>
}

/** Once published, the host's complete list owns controls; history remains only the fallback. */
export function selectAgentSessionCurrentRequests(state: {
  items: readonly AgentJournalRenderItem[]
  currentRequests?: readonly AgentJournalRenderItem[]
}): AgentSessionCurrentRequest[] {
  return (state.currentRequests ?? agentSessionCurrentContextRows(state.items).items).filter(
    (item): item is AgentSessionCurrentRequest =>
      (item.body.kind === 'approval' || item.body.kind === 'question') &&
      item.body.resolution.state === 'pending'
  )
}
