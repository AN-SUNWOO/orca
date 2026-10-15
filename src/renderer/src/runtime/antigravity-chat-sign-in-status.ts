import type { AntigravityChatSignInState } from '../../../shared/antigravity-account-types'
import type { RuntimeClientTarget } from '../../../shared/runtime-client-target'
import {
  callAntigravityAccounts,
  callAntigravityChatSignIn
} from './runtime-antigravity-accounts-client'

/**
 * Each host's Antigravity chat sign-in as one entry, so every Settings row shows the same flow and
 * saved sign-in. The host runs one flow at a time; a row shown later adopts the running one from
 * the List and follows it, so a sign-in nobody watched stays visible and cancellable.
 */

export type AntigravityChatSignInView = {
  flow: AntigravityChatSignInState | null
  saved: boolean
  /** Why the last request failed; empty when it gave no reason. */
  error: string | null
  /** The browser could not open the link this client asked for. */
  openFailed: boolean
}

type Entry = {
  view: AntigravityChatSignInView
  observers: number
  /** The flow whose Link poll is out; one per entry. */
  following: string | null
  /** The flow this client started while shown, whose link it opens once. */
  opens: string | null
  starts: number
}

const EMPTY: AntigravityChatSignInView = {
  flow: null,
  saved: false,
  error: null,
  openFailed: false
}
/** The pause before polling again after a failed poll, so a lasting error can't spin. */
const POLL_RETRY_MS = 2_000
const entries = new Map<string, Entry>()
const listeners = new Set<() => void>()

export const antigravityChatSignInRunning = (
  flow: AntigravityChatSignInState | null
): flow is AntigravityChatSignInState => flow?.phase === 'starting' || flow?.phase === 'waiting'

const hostKey = (owner: RuntimeClientTarget): string =>
  owner.kind === 'local' ? '' : owner.environmentId

function entryFor(owner: RuntimeClientTarget): Entry {
  let entry = entries.get(hostKey(owner))
  if (!entry) {
    entry = { view: EMPTY, observers: 0, following: null, opens: null, starts: 0 }
    entries.set(hostKey(owner), entry)
  }
  return entry
}

function set(entry: Entry, patch: Partial<AntigravityChatSignInView>): void {
  entry.view = { ...entry.view, ...patch }
  listeners.forEach((listener) => listener())
}

const message = (cause: unknown): string | null => (cause instanceof Error ? cause.message : null)

async function refresh(owner: RuntimeClientTarget, entry: Entry, pollAfterMs = 0): Promise<void> {
  // A failed read leaves the row offering sign-in, which is still correct to act on.
  const read = await callAntigravityAccounts(owner, { runtime: 'host' }, 'List').catch(() => null)
  const chat = read?.chatSignIn
  if (!chat) {
    return
  }
  set(entry, { saved: chat.saved })
  if (chat.flowId && entry.view.flow?.flowId !== chat.flowId) {
    set(entry, { flow: { flowId: chat.flowId, phase: 'starting' }, error: null })
  }
  if (pollAfterMs > 0) {
    setTimeout(() => void follow(owner, entry), pollAfterMs)
  } else {
    void follow(owner, entry)
  }
}

async function follow(owner: RuntimeClientTarget, entry: Entry): Promise<void> {
  const flow = entry.view.flow
  if (!antigravityChatSignInRunning(flow) || entry.observers === 0 || entry.following) {
    return
  }
  const { flowId } = flow
  const current = (): boolean => entry.view.flow?.flowId === flowId
  entry.following = flowId
  let next = flow
  let failed = false
  try {
    // A hidden row lets the poll in flight answer, then stops; showing it again resumes.
    while (antigravityChatSignInRunning(next) && entry.observers > 0 && current()) {
      const shown = next.phase
      next = await callAntigravityChatSignIn(owner, 'Link', { flowId, shown })
      if (!current()) {
        break
      }
      set(entry, { flow: next })
      if (next.phase === 'waiting' && next.url && entry.opens === flowId) {
        entry.opens = null
        void window.api.shell.openUrl(next.url).catch(() => {
          if (current()) {
            set(entry, { openFailed: true })
          }
        })
      }
    }
  } catch (cause) {
    if (current()) {
      set(entry, { flow: null, error: message(cause) ?? '' })
      failed = true
    }
  } finally {
    entry.following = null
  }
  if (failed) {
    // The host's flow can outlive a failed poll; the List adopts it again so it stays cancellable.
    void refresh(owner, entry, POLL_RETRY_MS)
    return
  }
  // Settled: the saved sign-in may have changed. Replaced: follow the flow that replaced it.
  if (current() && !antigravityChatSignInRunning(entry.view.flow)) {
    void refresh(owner, entry)
  } else {
    void follow(owner, entry)
  }
}

/** Starts a sign-in on the host, replacing any running one, and follows it while shown. */
export async function startAntigravityChatSignIn(owner: RuntimeClientTarget): Promise<void> {
  const entry = entryFor(owner)
  const ticket = ++entry.starts
  set(entry, { error: null, openFailed: false })
  try {
    const { flowId } = await callAntigravityChatSignIn<{ flowId: string }>(owner, 'Start')
    if (ticket !== entry.starts) {
      return
    }
    // A row that left before the host answered opens nothing; one shown later adopts the flow.
    entry.opens = entry.observers > 0 ? flowId : null
    set(entry, { flow: { flowId, phase: 'starting' } })
    void follow(owner, entry)
  } catch (cause) {
    if (ticket === entry.starts) {
      set(entry, { flow: null, error: message(cause) ?? '' })
    }
  }
}

export async function cancelAntigravityChatSignIn(owner: RuntimeClientTarget): Promise<void> {
  const entry = entryFor(owner)
  const flow = entry.view.flow
  if (flow) {
    await callAntigravityChatSignIn(owner, 'Cancel', { flowId: flow.flowId }).catch(
      (cause: unknown) => set(entry, { error: message(cause) ?? '' })
    )
  }
}

/** Reads the host's sign-in while a row shows it. Returns the release. */
export function observeAntigravityChatSignIn(owner: RuntimeClientTarget): () => void {
  const entry = entryFor(owner)
  entry.observers += 1
  if (entry.observers === 1) {
    void refresh(owner, entry)
  }
  return () => {
    entry.observers -= 1
    if (entry.observers === 0) {
      entry.opens = null
    }
  }
}

export function readAntigravityChatSignIn(owner: RuntimeClientTarget): AntigravityChatSignInView {
  return entries.get(hostKey(owner))?.view ?? EMPTY
}

export function subscribeAntigravityChatSignIns(listener: () => void): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}
