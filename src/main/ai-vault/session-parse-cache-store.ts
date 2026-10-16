import type { AiVaultSession } from '../../shared/ai-vault-types'
import type { ResumableSessionParseState } from './session-scanner-types'
import type { SessionSidecarObservation } from './session-sidecar-stat'
import type { TranscriptMessageChannel } from './session-transcript-channel'
import type { SkippedTranscriptRecord } from './session-transcript-record-budget'

// Rows are bounded by use, not by count: a count bound smaller than one
// Unlimited scan evicts that scan's own upcoming hits, so every scan re-parsed
// everything (STA-10405). A row no reader has used for this long is dropped by
// the next sweep.
export const SESSION_PARSE_CACHE_IDLE_MS = 24 * 60 * 60 * 1000
// Live parser state is the heavy part of a row and the only part with a count
// bound. Dropping it costs one whole re-read of a file that changed, never a
// re-parse of one that did not.
export const MAX_RESUME_ENTRIES = 4096

export type SessionParseResumePoint = {
  state: ResumableSessionParseState
  mtimeMs: number
  sizeBytes: number | undefined
  // Byte offset just past the last complete ('\n'-terminated) line consumed;
  // a trailing unterminated line is deliberately left before this point.
  byteOffset: number
  // Bound to the cached state, which keeps the reference its parsers were built
  // with; a resumed read re-points this channel instead of replacing it.
  channel: TranscriptMessageChannel
  // Records this fold dropped for exceeding the per-record budget, accumulated
  // across resumes. Lives with the fold, so a whole-file re-read starts clean.
  skippedRecords: SkippedTranscriptRecord[]
}

export type SessionParseCacheEntry = {
  mtimeMs: number
  sizeBytes: number | null
  platform: NodeJS.Platform
  session: AiVaultSession | null
  // What the sibling file looked like when `session` was built. Tracked apart
  // from the transcript's key so each can go stale on its own.
  sidecar?: SessionSidecarObservation
  // The session the transcript alone produced, before any sibling was merged
  // onto it. In-memory only: without it a sibling change costs one re-parse.
  foldSession?: AiVaultSession | null
  resume: SessionParseResumePoint | null
  // The dropped resume point's skipped records, so its notice outlives it.
  skippedRecords?: SkippedTranscriptRecord[]
}

const cache = new Map<string, SessionParseCacheEntry>()
// When each row was last stored, oldest first. Every reuse stores, so this is
// when a reader last used it.
const usedAt = new Map<string, number>()
// Paths whose row holds a resume point, least recently stored first.
const resumeOrder = new Set<string>()
let revision = 0
let onChange: (() => void) | null = null

export function sessionParseCacheRevision(): number {
  return revision
}

export function observeSessionParseCacheChanges(observer: (() => void) | null): void {
  onChange = observer
}

function notifyChange(): void {
  revision++
  try {
    onChange?.()
  } catch (error) {
    console.debug('[ai-vault] session parse cache checkpoint scheduling failed', error)
  }
}

export function resetSessionParseCacheForTests(): void {
  cache.clear()
  usedAt.clear()
  resumeOrder.clear()
  revision = 0
  onChange = null
}

// Drops one entry after its file is deleted. Cleanliness, not correctness:
// discovery walks disk first, so a trashed file is never rediscovered anyway.
export function invalidateSessionParseCacheEntry(path: string): void {
  usedAt.delete(path)
  resumeOrder.delete(path)
  if (cache.delete(path)) {
    notifyChange()
  }
}

// Called after a pass over the rows rather than per store, so a long scan
// re-stores what it reaches before the rows it has not reached yet can age out.
export function sweepSessionParseCache(nowMs = Date.now()): void {
  let dropped = false
  for (const [path, at] of usedAt) {
    if (nowMs - at <= SESSION_PARSE_CACHE_IDLE_MS) {
      break
    }
    usedAt.delete(path)
    resumeOrder.delete(path)
    dropped = cache.delete(path) || dropped
  }
  if (dropped) {
    notifyChange()
  }
}

// Persisted subset of a cache entry: the non-serializable `resume` parser
// state is dropped, and `foldSession` with it, so a restart pays one re-parse
// for a session whose sibling moved rather than storing every row twice
// (see session-parse-cache-persistence.ts).
export type PersistedSessionParseCacheEntry = Omit<SessionParseCacheEntry, 'resume' | 'foldSession'>

export function snapshotSessionParseCacheForPersistence(): [
  string,
  PersistedSessionParseCacheEntry
][] {
  return [...cache].map(([path, entry]): [string, PersistedSessionParseCacheEntry] => [
    path,
    {
      mtimeMs: entry.mtimeMs,
      sizeBytes: entry.sizeBytes,
      platform: entry.platform,
      session: entry.session,
      ...(entry.sidecar === undefined ? {} : { sidecar: entry.sidecar })
    }
  ])
}

// Seeded entries carry `resume: null`: after a restart an unchanged file is a
// cache hit; a file that changed while the app was closed pays one full
// (not incremental) re-parse. They count as used at load, so a restart never
// drops a row before a scan has had the idle window to reach it.
export function seedSessionParseCache(
  entries: Iterable<[string, PersistedSessionParseCacheEntry]>,
  nowMs = Date.now()
): void {
  const newest = new Map<string, PersistedSessionParseCacheEntry>()
  for (const [path, entry] of entries) {
    if (cache.has(path)) {
      continue
    }
    newest.delete(path)
    newest.set(path, entry)
  }
  // In-process entries win; among persisted duplicates the newest row wins.
  for (const [path, entry] of newest) {
    usedAt.set(path, nowMs)
    cache.set(path, {
      mtimeMs: entry.mtimeMs,
      sizeBytes: entry.sizeBytes,
      platform: entry.platform,
      session: entry.session,
      // Absent in files an older build wrote; `sidecarUnchanged` reads that as
      // unknown, so such a row re-enriches on its first scan.
      sidecar: entry.sidecar,
      resume: null
    })
  }
}

export function getSessionParseCacheEntry(path: string): SessionParseCacheEntry | undefined {
  return cache.get(path)
}

export function storeSessionParseCacheEntry(path: string, entry: SessionParseCacheEntry): void {
  const previous = cache.get(path)
  const changed =
    previous === undefined ||
    previous.mtimeMs !== entry.mtimeMs ||
    previous.sizeBytes !== entry.sizeBytes ||
    previous.platform !== entry.platform ||
    previous.session !== entry.session ||
    !sameSidecar(previous.sidecar, entry.sidecar)
  cache.delete(path)
  cache.set(path, entry)
  usedAt.delete(path)
  usedAt.set(path, Date.now())
  resumeOrder.delete(path)
  if (entry.resume !== null) {
    resumeOrder.add(path)
    if (resumeOrder.size > MAX_RESUME_ENTRIES) {
      dropOldestResumePoint()
    }
  }
  if (changed) {
    notifyChange()
  }
}

function dropOldestResumePoint(): void {
  const oldest = resumeOrder.values().next()
  if (oldest.done) {
    return
  }
  resumeOrder.delete(oldest.value)
  const entry = cache.get(oldest.value)
  if (entry?.resume) {
    // Same key, so the row keeps its place in the snapshot order.
    cache.set(oldest.value, {
      ...entry,
      resume: null,
      skippedRecords: entry.resume.skippedRecords
    })
  }
}

function sameSidecar(
  left: SessionSidecarObservation | undefined,
  right: SessionSidecarObservation | undefined
): boolean {
  return (
    left === right ||
    (typeof left === 'object' &&
      typeof right === 'object' &&
      left.path === right.path &&
      left.mtimeMs === right.mtimeMs &&
      left.sizeBytes === right.sizeBytes)
  )
}
