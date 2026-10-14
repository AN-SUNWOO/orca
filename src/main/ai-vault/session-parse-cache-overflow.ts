import { createHash, randomUUID } from 'node:crypto'
import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync
} from 'node:fs'
import { dirname, join } from 'node:path'
import { JsonTextStructureValidator } from '../../shared/json-text-structure-limit'
import type { PersistedSessionParseCacheEntry } from './session-parse-cache-store'
import {
  SESSION_PARSE_CACHE_JSON_LIMITS,
  SESSION_PARSE_CACHE_MAX_BYTES
} from './session-parse-cache-snapshot-serialization'

const PRIVATE_DIRECTORY_MODE = 0o700
const PRIVATE_FILE_MODE = 0o600

// The bounded snapshot keeps hot entries; this store holds the ones it evicts.
export function createSessionParseCacheOverflow(
  snapshotPath: string,
  schemaVersion: number,
  parseRow: (value: unknown) => [string, PersistedSessionParseCacheEntry] | null
): {
  read: (path: string) => PersistedSessionParseCacheEntry | undefined
  write: (path: string, entry: PersistedSessionParseCacheEntry) => void
  remove: (path: string) => void
} {
  const directory = `${snapshotPath}.overflow`
  function entryPath(path: string): string {
    const digest = createHash('sha256').update(path).digest('hex')
    return join(directory, digest.slice(0, 2), `${digest}.json`)
  }

  return {
    read(path) {
      if (!existsSync(directory)) {
        return undefined
      }
      const file = entryPath(path)
      try {
        if (statSync(file).size > SESSION_PARSE_CACHE_MAX_BYTES) {
          return undefined
        }
        const content = readFileSync(file, 'utf8')
        const validator = new JsonTextStructureValidator(SESSION_PARSE_CACHE_JSON_LIMITS)
        validator.consume(content)
        const value: unknown = JSON.parse(content)
        if (typeof value !== 'object' || value === null || !('schemaVersion' in value)) {
          return undefined
        }
        if (value.schemaVersion !== schemaVersion || !('row' in value)) {
          return undefined
        }
        const parsed = parseRow(value.row)
        return parsed?.[0] === path ? parsed[1] : undefined
      } catch (error) {
        if (
          !(
            typeof error === 'object' &&
            error !== null &&
            'code' in error &&
            error.code === 'ENOENT'
          )
        ) {
          console.debug('[ai-vault] session parse cache overflow lookup failed', error)
        }
        return undefined
      }
    },
    write(path, entry) {
      const file = entryPath(path)
      const temp = `${file}.${process.pid}.${randomUUID()}.tmp`
      try {
        const payload = JSON.stringify({ schemaVersion, row: [path, entry] })
        if (Buffer.byteLength(payload) > SESSION_PARSE_CACHE_MAX_BYTES) {
          return
        }
        new JsonTextStructureValidator(SESSION_PARSE_CACHE_JSON_LIMITS).consume(payload)
        mkdirSync(dirname(file), { recursive: true, mode: PRIVATE_DIRECTORY_MODE })
        writeFileSync(temp, payload, { mode: PRIVATE_FILE_MODE })
        renameSync(temp, file)
      } catch (error) {
        console.debug('[ai-vault] session parse cache overflow write failed', error)
      } finally {
        rmSync(temp, { force: true })
      }
    },
    remove(path) {
      try {
        rmSync(entryPath(path), { force: true })
      } catch (error) {
        console.debug('[ai-vault] session parse cache overflow deletion failed', error)
      }
    }
  }
}
