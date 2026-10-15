import { delayUnlessAborted } from '../../../shared/abort-aware-delay'

/**
 * A host-owned state per subject, read by revision. While any surface observes a subject, one
 * long-poll follows the host, idle included, so another client's change shows up too. A wait is
 * never aborted: the host holds it until it answers either way, so a surface hidden and shown again
 * reuses the one in flight rather than leaving another behind.
 */

export type RevisionedHostSnapshot<S> =
  | { kind: 'unknown' }
  /** No answer yet and the last read failed: says nothing about the host's state. */
  | { kind: 'readFailed' }
  | { kind: 'known'; state: S }

type Entry<Subject, S> = {
  subject: Subject
  snapshot: RevisionedHostSnapshot<S>
  observers: number
  following: boolean
  failures: number
  /** Ends the current retry pause early: on the last release, or when the host is back. */
  wake: AbortController | null
}

const UNKNOWN = { kind: 'unknown' } as const

export function createRevisionedHostStateStore<Subject, S extends { revision: number }>(options: {
  key: (subject: Subject) => string
  /** Subjects with the same host key and a different key answer for a restarted host. */
  hostKey: (subject: Subject) => string
  /** At once without `shown`, else once the host's revision passes it or after a bounded wait. */
  read: (subject: Subject, shown: number | undefined) => Promise<S>
}) {
  const entries = new Map<string, Entry<Subject, S>>()
  const listeners = new Set<() => void>()

  const setSnapshot = (entry: Entry<Subject, S>, snapshot: RevisionedHostSnapshot<S>): void => {
    entry.snapshot = snapshot
    listeners.forEach((listener) => listener())
  }

  const entryFor = (subject: Subject): Entry<Subject, S> => {
    const key = options.key(subject)
    let entry = entries.get(key)
    if (!entry) {
      // A restarted host runtime answers under a new key; the old one's answer is stale.
      for (const [otherKey, other] of entries) {
        if (other.observers === 0 && options.hostKey(other.subject) === options.hostKey(subject)) {
          entries.delete(otherKey)
        }
      }
      entry = {
        subject,
        snapshot: UNKNOWN,
        observers: 0,
        following: false,
        failures: 0,
        wake: null
      }
      entries.set(key, entry)
    }
    return entry
  }

  const apply = (entry: Entry<Subject, S>, state: S): void => {
    // A reply that crossed a newer one on the wire must not roll the view back.
    if (entry.snapshot.kind !== 'known' || entry.snapshot.state.revision <= state.revision) {
      setSnapshot(entry, { kind: 'known', state })
    }
  }

  const follow = async (entry: Entry<Subject, S>): Promise<void> => {
    // Starts with a plain read, so a surface shown again reconciles before any wait.
    let shown: number | undefined
    entry.failures = 0
    while (entry.observers > 0) {
      try {
        const state = await options.read(entry.subject, shown)
        entry.failures = 0
        // Only a host restarted under the same key answers below the revision it was asked for.
        if (shown !== undefined && state.revision < shown) {
          setSnapshot(entry, { kind: 'known', state })
        } else {
          apply(entry, state)
        }
        shown = entry.snapshot.kind === 'known' ? entry.snapshot.state.revision : state.revision
      } catch {
        // A known answer stays through a blip; only a first read failing changes what is shown.
        if (entry.snapshot.kind !== 'known') {
          setSnapshot(entry, { kind: 'readFailed' })
        }
        shown = undefined
        entry.failures += 1
        const wake = new AbortController()
        entry.wake = wake
        const pause = Math.min(30_000, 1000 * 2 ** (entry.failures - 1))
        await delayUnlessAborted(pause, wake.signal)
        entry.wake = null
      }
    }
    entry.following = false
  }

  return {
    read: (subject: Subject): RevisionedHostSnapshot<S> =>
      entries.get(options.key(subject))?.snapshot ?? UNKNOWN,
    /** Follows the host while any shown surface observes `subject`. Returns the release. */
    observe: (subject: Subject): (() => void) => {
      const entry = entryFor(subject)
      entry.observers += 1
      if (!entry.following) {
        entry.following = true
        void follow(entry)
      }
      return () => {
        entry.observers -= 1
        if (entry.observers === 0) {
          entry.wake?.abort()
        }
      }
    },
    /** Retries a failed read at once, e.g. when the host answers again after an outage. */
    wake: (subject: Subject): void => {
      const entry = entries.get(options.key(subject))
      if (entry) {
        entry.failures = 0
        entry.wake?.abort()
      }
    },
    /** An action's reply, ordered by revision with the long-poll's. */
    apply: (subject: Subject, state: S): void => apply(entryFor(subject), state),
    subscribe: (listener: () => void): (() => void) => {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    }
  }
}
