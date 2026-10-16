// Persists the reusable portion of the AI Vault session parse cache, one SQLite
// row per transcript, so a fresh launch reuses prior parse work instead of
// re-reading the whole transcript corpus (issue #9210: 6.7 GB / 109 s cold
// scans). The in-memory map is the hot tier; the database is read on a miss and
// written only with what changed. Only the scanner child opens it, and every
// failure degrades to a re-parse.
import { dirname, join } from 'node:path'
import { setImmediate as yieldToEventLoop } from 'node:timers/promises'
import { SessionParseCacheDatabase } from './session-parse-cache-database'
import { importLegacySessionParseCacheJson } from './session-parse-cache-legacy-json'
import {
  setSessionParseCacheColdTier,
  type PersistedSessionParseCacheEntry
} from './session-parse-cache-store'

const WRITE_DEBOUNCE_MS = 1_500
const WRITE_MAX_WAIT_MS = 15_000
const WRITE_CHUNK_ROWS = 500
const DAY_MS = 24 * 60 * 60_000
// Long enough that time away doesn't empty the cache; Claude Code's own
// transcript cleanup defaults to the same window.
const UNUSED_ROW_TTL_MS = 30 * DAY_MS

export type SessionParseCachePersistenceOptions = {
  // The legacy JSON file; the database sits beside it.
  filePath: string
  appVersion: string
}

let options: SessionParseCachePersistenceOptions | null = null
let owner = false
// undefined: not opened yet; null: unavailable for this process's life.
let database: SessionParseCacheDatabase | null | undefined
let loadPromise: Promise<void> | null = null
const pendingWrites = new Map<string, PersistedSessionParseCacheEntry>()
let writeTimer: NodeJS.Timeout | null = null
let pendingSince: number | null = null

/** Electron main records where the cache lives for the scanner child it spawns; it never opens it. */
export function configureSessionParseCachePersistence(
  next: SessionParseCachePersistenceOptions
): void {
  options = { ...next }
}

/** The scanner child's half: lookups read through to the database and changes are written back. */
export function initSessionParseCachePersistence(next: SessionParseCachePersistenceOptions): void {
  configureSessionParseCachePersistence(next)
  owner = true
  setSessionParseCacheColdTier({ read: readRow, stored: queueWrite, deleted: deleteRow })
}

export function getSessionParseCachePersistenceOptions(): SessionParseCachePersistenceOptions | null {
  return options ? { ...options } : null
}

export function resetSessionParseCachePersistenceForTests(): void {
  clearWriteTimer()
  pendingWrites.clear()
  database?.close()
  database = undefined
  options = null
  owner = false
  loadPromise = null
  setSessionParseCacheColdTier(null)
}

/** Opens the database and imports the old JSON file once. Memoized; a no-op outside the owner. */
export function ensureSessionParseCacheLoaded(): Promise<void> {
  const current = options
  if (!owner || current === null) {
    return Promise.resolve()
  }
  loadPromise ??= (async () => {
    const db = openedDatabase()
    if (db) {
      await importLegacySessionParseCacheJson(current.filePath, db, Date.now())
    }
  })()
  return loadPromise
}

/** Write every queued row now, before process exit. Each committed chunk survives a kill. */
export async function flushSessionParseCachePersist(): Promise<void> {
  clearWriteTimer()
  while (pendingWrites.size > 0) {
    const chunk: [string, PersistedSessionParseCacheEntry][] = []
    for (const row of pendingWrites) {
      chunk.push(row)
      pendingWrites.delete(row[0])
      if (chunk.length === WRITE_CHUNK_ROWS) {
        break
      }
    }
    openedDatabase()?.write(chunk, Date.now())
    if (pendingWrites.size > 0) {
      await yieldToEventLoop()
    }
  }
}

function openedDatabase(): SessionParseCacheDatabase | null {
  if (database !== undefined || !owner || options === null) {
    return database ?? null
  }
  try {
    database = new SessionParseCacheDatabase(
      join(dirname(options.filePath), 'session-parse-cache.sqlite')
    )
    database.expireUnusedBefore(Date.now() - UNUSED_ROW_TTL_MS)
  } catch (error) {
    console.debug('[ai-vault] session parse cache database unavailable', error)
    database = null
  }
  return database
}

function readRow(path: string): PersistedSessionParseCacheEntry | undefined {
  const row = openedDatabase()?.read(path)
  if (row === undefined) {
    return undefined
  }
  // A rewrite stamps used_at; at most one per row per day keeps reuse nearly free.
  if (Date.now() - row.usedAt > DAY_MS) {
    queueWrite(path, row.entry)
  }
  return row.entry
}

function queueWrite(path: string, entry: PersistedSessionParseCacheEntry): void {
  pendingWrites.delete(path)
  pendingWrites.set(path, entry)
  const now = Date.now()
  pendingSince ??= now
  if (writeTimer) {
    clearTimeout(writeTimer)
  }
  writeTimer = setTimeout(
    () => void flushSessionParseCachePersist(),
    Math.max(0, Math.min(WRITE_DEBOUNCE_MS, pendingSince + WRITE_MAX_WAIT_MS - now))
  )
  writeTimer.unref?.()
}

// Immediate, so a queued write or a later lookup can't bring the row back.
function deleteRow(path: string): void {
  pendingWrites.delete(path)
  openedDatabase()?.delete(path)
}

function clearWriteTimer(): void {
  if (writeTimer) {
    clearTimeout(writeTimer)
    writeTimer = null
  }
  pendingSince = null
}
