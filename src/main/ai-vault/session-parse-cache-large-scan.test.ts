import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, expect, it, vi } from 'vitest'
import {
  ensureSessionParseCacheLoaded,
  flushSessionParseCachePersist,
  initSessionParseCachePersistence,
  resetSessionParseCachePersistenceForTests
} from './session-parse-cache-persistence'
import {
  getSessionParseCacheEntry,
  MAX_RESUME_ENTRIES,
  resetSessionParseCacheForTests,
  SESSION_PARSE_CACHE_IDLE_MS,
  storeSessionParseCacheEntry,
  sweepSessionParseCache
} from './session-parse-cache-store'
import { createSessionParseStats, parseAgentSessionFileCached } from './session-scanner-parse-cache'
import type { SessionFileCandidate } from './session-scanner-types'

const CANDIDATES = MAX_RESUME_ENTRIES + 178
let root: string | undefined

afterEach(async () => {
  vi.useRealTimers()
  resetSessionParseCachePersistenceForTests()
  resetSessionParseCacheForTests()
  if (root) {
    await rm(root, { recursive: true, force: true })
  }
  root = undefined
})

it('drops only rows no reader has used within the idle window', () => {
  vi.useFakeTimers({ toFake: ['Date'], now: 0 })
  const row = { mtimeMs: 1, sizeBytes: 1, platform: 'linux', session: null, resume: null } as const
  storeSessionParseCacheEntry('idle', row)
  storeSessionParseCacheEntry('reused', row)
  vi.setSystemTime(SESSION_PARSE_CACHE_IDLE_MS)
  storeSessionParseCacheEntry('reused', row)
  sweepSessionParseCache(SESSION_PARSE_CACHE_IDLE_MS + 1)
  expect(getSessionParseCacheEntry('idle')).toBeUndefined()
  expect(getSessionParseCacheEntry('reused')).toBeDefined()
})

it('does not reparse an unchanged corpus past the resume bound, across scans or restart', async () => {
  resetSessionParseCacheForTests()
  root = await mkdtemp(join(tmpdir(), 'orca-history-no-reparse-'))
  const cacheFile = join(root, 'cache.json')
  initSessionParseCachePersistence({ filePath: cacheFile, appVersion: 'test' })
  await ensureSessionParseCacheLoaded()
  const candidates: SessionFileCandidate[] = []
  for (let index = 0; index < CANDIDATES; index++) {
    const path = join(root, `session-${index}.jsonl`)
    await writeFile(path, '')
    const fileStat = await stat(path)
    candidates.push({
      agent: 'claude',
      file: {
        path,
        mtimeMs: fileStat.mtimeMs,
        modifiedAt: fileStat.mtime.toISOString(),
        sizeBytes: fileStat.size
      },
      codexHome: null
    })
  }
  const first = createSessionParseStats()
  const second = createSessionParseStats()
  const restarted = createSessionParseStats()
  for (const candidate of candidates) {
    await parseAgentSessionFileCached(candidate, process.platform, first)
  }
  for (const candidate of candidates) {
    await parseAgentSessionFileCached(candidate, process.platform, second)
  }
  await flushSessionParseCachePersist()
  const snapshot = JSON.parse(await readFile(cacheFile, 'utf8'))
  expect(snapshot.entries).toHaveLength(CANDIDATES)
  resetSessionParseCachePersistenceForTests()
  resetSessionParseCacheForTests()
  initSessionParseCachePersistence({ filePath: cacheFile, appVersion: 'test' })
  await ensureSessionParseCacheLoaded()
  expect(getSessionParseCacheEntry(candidates[0]!.file.path)).toBeDefined()
  for (const candidate of candidates) {
    await parseAgentSessionFileCached(candidate, process.platform, restarted)
  }
  expect(first.fullParses).toBe(CANDIDATES)
  expect(second.fullParses).toBe(0)
  expect(restarted.fullParses).toBe(0)
}, 240_000)
