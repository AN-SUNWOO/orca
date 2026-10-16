import type { AiVaultSession } from '../../shared/ai-vault-types'
import type { ResumableSessionParseState } from './session-scanner-types'
import type { SessionSidecarObservation } from './session-sidecar-stat'
import type { TranscriptMessageChannel } from './session-transcript-channel'
import type { SkippedTranscriptRecord } from './session-transcript-record-budget'

// Rows Session History lists have no count bound: one smaller than an Unlimited
// scan evicts that scan's own upcoming hits, so every scan re-parsed everything
// (STA-10405). They live as long as this process; the persisted snapshot keeps
// the newest transcripts. Rows only other readers created (search index, title
// lookups) keep a count bound, since an index build reads the whole corpus.
export const MAX_UNLISTED_ENTRIES = 4096
// Live parser state is the heavy part of a row and is count-bounded even on
// listed rows. Dropping it costs one whole re-read of a file that changed, never
// a re-parse of one that did not.
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
// Paths a History scan has listed. Kept apart from the rows so a forced whole
// re-read, which drops the row, leaves it listed.
const listedPaths = new Set<string>()
// Rows no History scan has listed, and rows holding a resume point: the two
// count-bounded sets.
const unlistedPaths = new Set<string>()
const resumePaths = new Set<string>()
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
  listedPaths.clear()
  unlistedPaths.clear()
  resumePaths.clear()
  revision = 0
  onChange = null
}

// Drops one entry after its file is deleted. Cleanliness, not correctness:
// discovery walks disk first, so a trashed file is never rediscovered anyway.
export function invalidateSessionParseCacheEntry(path: string): void {
  unlistedPaths.delete(path)
  resumePaths.delete(path)
  if (cache.delete(path)) {
    notifyChange()
  }
}

export function noteSessionParseCacheListed(path: string): void {
  listedPaths.add(path)
  unlistedPaths.delete(path)
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
// (not incremental) re-parse. They count as listed: the file can't say which
// reader made a row, and the unlisted bound would cut History's own rows to it.
export function seedSessionParseCache(
  entries: Iterable<[string, PersistedSessionParseCacheEntry]>
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
    listedPaths.add(path)
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
  resumePaths.delete(path)
  if (!listedPaths.has(path)) {
    unlistedPaths.add(path)
    trimOldestTranscripts(unlistedPaths, MAX_UNLISTED_ENTRIES, dropRow)
  }
  // Skipped when the trim above dropped this very row, so it can't cost others.
  if (entry.resume !== null && cache.has(path)) {
    resumePaths.add(path)
    trimOldestTranscripts(resumePaths, MAX_RESUME_ENTRIES, dropResumePoint)
  }
  if (changed) {
    notifyChange()
  }
}

// Over the bound, drops the tenth whose transcripts were modified longest ago.
// Scans visit newest first, so store order would drop the most active files.
function trimOldestTranscripts(
  paths: Set<string>,
  max: number,
  drop: (path: string) => void
): void {
  if (paths.size <= max) {
    return
  }
  const oldest = [...paths]
    .sort((left, right) => (cache.get(left)?.mtimeMs ?? 0) - (cache.get(right)?.mtimeMs ?? 0))
    .slice(0, paths.size - max + Math.floor(max / 10))
  for (const path of oldest) {
    paths.delete(path)
    drop(path)
  }
}

function dropRow(path: string): void {
  resumePaths.delete(path)
  cache.delete(path)
}

function dropResumePoint(path: string): void {
  const entry = cache.get(path)
  if (entry?.resume) {
    // Same key, so the row keeps its place in the map.
    cache.set(path, { ...entry, resume: null, skippedRecords: entry.resume.skippedRecords })
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
