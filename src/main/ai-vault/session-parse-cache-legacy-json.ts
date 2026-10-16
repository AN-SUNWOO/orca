// Temporary: imports the single JSON file that builds before the per-row
// database wrote, so the first launch after updating re-reads nothing. Remove
// once no supported upgrade path starts from a build that wrote that file.
import { readdir, rm } from 'node:fs/promises'
import { StringDecoder } from 'node:string_decoder'
import { setImmediate as yieldToEventLoop } from 'node:timers/promises'
import { basename, dirname, join } from 'node:path'
import { JsonTextStructureValidator } from '../../shared/json-text-structure-limit'
import { readNodeFileWithinLimit } from '../../shared/node-bounded-file-reader'
import { readStreamedSessionDocument } from './session-document-stream'
import {
  parsePersistedSessionParseCacheRow,
  SESSION_PARSE_CACHE_SCHEMA_VERSION,
  type SessionParseCacheDatabase
} from './session-parse-cache-database'
import type { PersistedSessionParseCacheEntry } from './session-parse-cache-store'

// The limits the old writer kept the file within.
const LEGACY_MAX_BYTES = 64 * 1024 * 1024
const LEGACY_JSON_LIMITS = { structuralTokens: 1_000_000, nestingDepth: 32 } as const
const VALIDATE_CHUNK_CHARACTERS = 256 * 1024
const IMPORT_CHUNK_ROWS = 500

/**
 * Import the old file into an empty database, then delete it (and any temp file
 * a crashed save left) whether or not the import ran, so a failed unlink on one
 * launch is retried on the next instead of leaving the file forever.
 */
export async function importLegacySessionParseCacheJson(
  filePath: string,
  database: SessionParseCacheDatabase,
  usedAt: number
): Promise<void> {
  try {
    if (database.isEmpty()) {
      const entries = await readLegacyEntries(filePath)
      for (let start = 0; start < entries.length; start += IMPORT_CHUNK_ROWS) {
        database.write(entries.slice(start, start + IMPORT_CHUNK_ROWS), usedAt)
        await yieldToEventLoop()
      }
    }
  } catch {
    // Missing, corrupt or foreign: the worst case is a cold scan.
  }
  await removeLegacyFiles(filePath)
}

async function readLegacyEntries(
  filePath: string
): Promise<[string, PersistedSessionParseCacheEntry][]> {
  const { buffer } = await readNodeFileWithinLimit(filePath, LEGACY_MAX_BYTES)
  await assertWithinLegacyLimits(buffer)
  const parsed = await readStreamedSessionDocument({
    bytes: chunksOf(buffer),
    arrayKey: 'entries',
    fields: ['schemaVersion', 'appVersion'],
    create: () => new Map<string, PersistedSessionParseCacheEntry>(),
    consume(entries, item) {
      const entry = parsePersistedSessionParseCacheRow(item)
      if (entry === null) {
        throw new Error('Malformed session parse cache row')
      }
      entries.delete(entry[0])
      entries.set(entry[0], entry[1])
    }
  })
  if (
    parsed?.record.schemaVersion !== SESSION_PARSE_CACHE_SCHEMA_VERSION ||
    typeof parsed.record.appVersion !== 'string'
  ) {
    return []
  }
  return [...parsed.state]
}

async function assertWithinLegacyLimits(content: Buffer): Promise<void> {
  const validator = new JsonTextStructureValidator(LEGACY_JSON_LIMITS)
  const decoder = new StringDecoder('utf8')
  for (let start = 0; start < content.length; start += VALIDATE_CHUNK_CHARACTERS) {
    validator.consume(decoder.write(content.subarray(start, start + VALIDATE_CHUNK_CHARACTERS)))
    await yieldToEventLoop()
  }
  validator.consume(decoder.end())
}

async function* chunksOf(buffer: Buffer): AsyncGenerator<Buffer> {
  for (let start = 0; start < buffer.length; start += 64 * 1024) {
    yield buffer.subarray(start, start + 64 * 1024)
  }
}

async function removeLegacyFiles(filePath: string): Promise<void> {
  const directory = dirname(filePath)
  let names: string[] = []
  try {
    names = await readdir(directory)
  } catch {
    return
  }
  await Promise.all(
    names
      .filter(
        (name) =>
          name === basename(filePath) ||
          (name.startsWith('session-parse-cache-') && name.endsWith('.tmp'))
      )
      .map((name) => rm(join(directory, name), { force: true }).catch(() => {}))
  )
}
