import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, expect, it } from 'vitest'
import {
  ensureSessionParseCacheLoaded,
  flushSessionParseCachePersist,
  initSessionParseCachePersistence,
  resetSessionParseCachePersistenceForTests
} from './session-parse-cache-persistence'
import {
  getSessionParseCacheEntry,
  MAX_CACHE_ENTRIES,
  resetSessionParseCacheForTests,
  storeSessionParseCacheEntry
} from './session-parse-cache-store'
import { createSessionParseStats, parseAgentSessionFileCached } from './session-scanner-parse-cache'
import type { SessionFileCandidate } from './session-scanner-types'

const CANDIDATES = MAX_CACHE_ENTRIES + 178
let root: string | undefined

afterEach(async () => {
  resetSessionParseCachePersistenceForTests()
  resetSessionParseCacheForTests()
  if (root) {
    await rm(root, { recursive: true, force: true })
  }
  root = undefined
})

it('retains every ordered cache API result beyond the memory bound', async () => {
  resetSessionParseCacheForTests()
  root = await mkdtemp(join(tmpdir(), 'orca-history-no-reparse-'))
  initSessionParseCachePersistence({ filePath: join(root, 'cache.json'), appVersion: 'test' })
  await ensureSessionParseCacheLoaded()
  let misses = 0
  for (let pass = 0; pass < 2; pass++) {
    for (let index = 0; index < CANDIDATES; index++) {
      const path = `session-${index}.jsonl`
      if (!getSessionParseCacheEntry(path)) {
        misses++
        storeSessionParseCacheEntry(path, {
          mtimeMs: index,
          sizeBytes: 64,
          platform: 'win32',
          session: null,
          resume: null
        })
      }
    }
  }
  expect(misses).toBe(CANDIDATES)
}, 120_000)

it('does not reparse an unchanged corpus larger than memory across scans or restart', async () => {
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
  expect(snapshot.entries).toHaveLength(MAX_CACHE_ENTRIES)
  resetSessionParseCachePersistenceForTests()
  resetSessionParseCacheForTests()
  initSessionParseCachePersistence({ filePath: cacheFile, appVersion: 'test' })
  await ensureSessionParseCacheLoaded()
  expect(getSessionParseCacheEntry(candidates[178]!.file.path)).toBeDefined()
  for (const candidate of candidates) {
    await parseAgentSessionFileCached(candidate, process.platform, restarted)
  }
  expect(first.fullParses).toBe(CANDIDATES)
  expect(second.fullParses).toBe(0)
  expect(restarted.fullParses).toBe(0)

  const changed = candidates[0]!
  await writeFile(changed.file.path, '{}\n')
  const changedStat = await stat(changed.file.path)
  changed.file.mtimeMs = changedStat.mtimeMs
  changed.file.sizeBytes = changedStat.size
  const afterChange = createSessionParseStats()
  for (const candidate of candidates) {
    await parseAgentSessionFileCached(candidate, process.platform, afterChange)
  }
  expect(afterChange.fullParses + afterChange.incremental).toBe(1)
  expect(afterChange.reused).toBe(CANDIDATES - 1)
}, 240_000)
