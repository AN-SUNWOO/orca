import { delayUnlessAborted } from '../../../shared/abort-aware-delay'
import type { ManagedRuntimeInstallState } from '../../../shared/managed-runtime-install'
import type { RuntimeClientTarget } from '../../../shared/runtime-client-target'
import { callRuntimeRpc } from './runtime-rpc-client'

/**
 * What each host says about the runtime it installs for an agent, one entry per host runtime
 * instance and agent, so Settings and a chat read the same answer. While any surface observes
 * an entry, one status long-poll follows the host, idle included, so another client's change
 * shows up too.
 */

export type ManagedRuntimeInstallSubject = {
  target: RuntimeClientTarget
  /** The paired host's runtime that answers; null for the local runtime. */
  runtimeId: string | null
  agent: string
}

export type ManagedRuntimeInstallSnapshot =
  | { kind: 'unknown' }
  /** No answer yet and the last read failed: says nothing about whether it is installed. */
  | { kind: 'readFailed' }
  | { kind: 'known'; state: ManagedRuntimeInstallState }

type Entry = {
  subject: ManagedRuntimeInstallSubject
  snapshot: ManagedRuntimeInstallSnapshot
  observers: number
  stop: AbortController | null
}

const UNKNOWN: ManagedRuntimeInstallSnapshot = { kind: 'unknown' }
// The host answers a status wait within 25 s; the default remote timeout is shorter.
const STATUS_WAIT_TIMEOUT_MS = 40_000

const entries = new Map<string, Entry>()
const listeners = new Set<() => void>()

const hostAgentKey = ({ target, agent }: ManagedRuntimeInstallSubject): string =>
  `${target.kind === 'local' ? '' : target.environmentId}\u0000${agent}`
const subjectKey = (subject: ManagedRuntimeInstallSubject): string =>
  `${hostAgentKey(subject)}\u0000${subject.runtimeId ?? ''}`

function setSnapshot(entry: Entry, snapshot: ManagedRuntimeInstallSnapshot): void {
  entry.snapshot = snapshot
  listeners.forEach((listener) => listener())
}

function entryFor(subject: ManagedRuntimeInstallSubject): Entry {
  const key = subjectKey(subject)
  let entry = entries.get(key)
  if (!entry) {
    // A restarted host runtime answers under a new key; the old one's answer is stale.
    for (const [otherKey, other] of entries) {
      if (other.observers === 0 && hostAgentKey(other.subject) === hostAgentKey(subject)) {
        entries.delete(otherKey)
      }
    }
    entry = { subject, snapshot: UNKNOWN, observers: 0, stop: null }
    entries.set(key, entry)
  }
  return entry
}

function apply(entry: Entry, state: ManagedRuntimeInstallState): void {
  // A reply that crossed a newer one on the wire must not roll the view back.
  if (entry.snapshot.kind !== 'known' || entry.snapshot.state.revision <= state.revision) {
    setSnapshot(entry, { kind: 'known', state })
  }
}

function callHost(
  subject: ManagedRuntimeInstallSubject,
  method: 'managedRuntime.status' | 'managedRuntime.install' | 'managedRuntime.cancel',
  params: Record<string, unknown>,
  options: { signal?: AbortSignal; timeoutMs?: number } = {}
): Promise<ManagedRuntimeInstallState> {
  return callRuntimeRpc<ManagedRuntimeInstallState>(
    subject.target,
    method,
    { agent: subject.agent, ...params },
    {
      ...options,
      ...(subject.runtimeId ? { expectedEnvironmentRuntimeId: subject.runtimeId } : {})
    }
  )
}

async function follow(entry: Entry, signal: AbortSignal): Promise<void> {
  // Starts with a plain read, so a surface shown again reconciles before any wait.
  let shown: number | undefined
  let failures = 0
  while (!signal.aborted) {
    try {
      const params = shown === undefined ? {} : { shown }
      const state = await callHost(entry.subject, 'managedRuntime.status', params, {
        signal,
        timeoutMs: STATUS_WAIT_TIMEOUT_MS
      })
      if (signal.aborted) {
        return
      }
      failures = 0
      apply(entry, state)
      shown = entry.snapshot.kind === 'known' ? entry.snapshot.state.revision : state.revision
    } catch {
      if (signal.aborted) {
        return
      }
      // A known answer stays through a blip; only a first read failing changes what is shown.
      if (entry.snapshot.kind !== 'known') {
        setSnapshot(entry, { kind: 'readFailed' })
      }
      shown = undefined
      failures += 1
      await delayUnlessAborted(Math.min(30_000, 1000 * 2 ** (failures - 1)), signal)
    }
  }
}

export function readManagedRuntimeInstall(
  subject: ManagedRuntimeInstallSubject
): ManagedRuntimeInstallSnapshot {
  return entries.get(subjectKey(subject))?.snapshot ?? UNKNOWN
}

/** Follows the host while at least one shown surface observes this subject. Returns the release. */
export function observeManagedRuntimeInstall(subject: ManagedRuntimeInstallSubject): () => void {
  const entry = entryFor(subject)
  entry.observers += 1
  if (!entry.stop) {
    entry.stop = new AbortController()
    void follow(entry, entry.stop.signal)
  }
  return () => {
    entry.observers -= 1
    if (entry.observers === 0) {
      entry.stop?.abort()
      entry.stop = null
    }
  }
}

/** Starts, or joins, the host's install; rejects with the host's refusal. */
export async function installManagedRuntime(subject: ManagedRuntimeInstallSubject): Promise<void> {
  apply(entryFor(subject), await callHost(subject, 'managedRuntime.install', {}))
}

export async function cancelManagedRuntimeInstall(
  subject: ManagedRuntimeInstallSubject,
  operationId: string
): Promise<void> {
  apply(entryFor(subject), await callHost(subject, 'managedRuntime.cancel', { operationId }))
}

export function subscribeManagedRuntimeInstalls(listener: () => void): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}
