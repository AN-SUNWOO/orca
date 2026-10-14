// Startup's background heal and each retry round: readers write nothing, a person never waits on a
// round, and a hidden chat's surviving agent is never signalled.

import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import type { AgentSessionOwnerProbe } from '../../../shared/agent-session-lease-adjudication'
import type { AgentSessionRecord } from '../../../shared/agent-session-record'
import type { AgentSessionRecordStore } from '../../runtime/agent-session-record-store'
import {
  openTestAgentSessionRecordStore,
  seedTestAgentSessionRecordStore
} from '../../runtime/agent-session-record-store-test-harness'
import {
  closeTestJournalHostDatabases,
  openTestJournalHostDatabase
} from '../agent-session-journal/journal-host-database-test-support'
import {
  publishJournalSessionEpoch,
  readJournalSessionEpoch
} from '../agent-session-journal/journal-row-table'
import { AgentSessionJournal } from '../agent-session-journal/journal-store'
import type { StructuredAgentSessionHost } from './structured-agent-session-host'
import { HOST_TEST_LOCATION as LOCATION } from './structured-agent-session-host-test-data'
import * as reconciliationLoad from './structured-agent-session-reconciliation-load'
import * as reconciliationPass from './structured-agent-session-reconciliation-pass'
import {
  openScanHost,
  SCAN_RELEASED as RELEASED,
  scanIdle as idle,
  scanRecord as record,
  scanTurnState as turnState,
  seedScanJournal
} from './structured-agent-session-startup-scan.test-fixture'
import { retryOwes } from './structured-agent-session-retry.test-fixture'

const CHAT = 'chat-aaaaaaa1'
const OTHER = 'chat-aaaaaaa2'

let root: string
let store: AgentSessionRecordStore
let host: StructuredAgentSessionHost | undefined

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'orca-startup-scan-'))
})

afterEach(async () => {
  await host?.flushAllStreamedEvents()
  host = undefined
  vi.restoreAllMocks()
  closeTestJournalHostDatabases()
  await rm(root, { recursive: true, force: true })
})

const busy = () =>
  Object.assign(new Error('database is locked'), { errcode: 5, code: 'SQLITE_BUSY' })
const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

/** Records and journals for `ids`; `alive` names chats whose agent outlived the earlier process. */
async function seed(ids: readonly string[], alive: readonly string[] = []) {
  await seedTestAgentSessionRecordStore(root, {
    records: ids.map((id) => record(id, !alive.includes(id)))
  })
  for (const id of ids) {
    await seedScanJournal(root, id)
  }
  store = await openTestAgentSessionRecordStore(root)
  vi.spyOn(console, 'warn').mockImplementation(() => undefined)
}

/** Every pass on `contended` chats meets a lock while `held()`; the rest run as they are. */
function lockPasses(held: () => boolean, contended: (sessionId: string) => boolean) {
  const pass = reconciliationPass.runStructuredAgentSessionReconciliationPass
  return vi
    .spyOn(reconciliationPass, 'runStructuredAgentSessionReconciliationPass')
    .mockImplementation(async (...args) =>
      held() && contended(args[1])
        ? { failed: [busy()], wrote: false, recovering: false }
        : pass(...args)
    )
}

function surviving() {
  let alive = true
  const probeOwner = vi.fn(async (): Promise<AgentSessionOwnerProbe> =>
    alive ? { outcome: 'identity-matched', matchedOn: ['spawn-token'] } : { outcome: 'pid-absent' }
  )
  const stopOwnerProcess = vi.fn(() => {
    alive = false
  })
  return { probeOwner, stopOwnerProcess }
}

const latch = (lease: Partial<AgentSessionRecord['lease']>) => (record: AgentSessionRecord) => ({
  ...record,
  lease: { ...record.lease, handoffStage: 'recovering' as const, ...lease }
})

it('finds what an earlier process left with no fence move and no stored mark, and keeps its send as a card', async () => {
  await seedTestAgentSessionRecordStore(root, { records: [record(RELEASED, true)] })
  await seedScanJournal(root, RELEASED, { queued: true })
  store = await openTestAgentSessionRecordStore(root)
  host = openScanHost(root, store)
  const current = host
  const ended = vi.fn()
  store.onGenerationEnded(ended)

  await current.reconcileRestartLeases()
  await current.startupSettled()
  await idle(current, [RELEASED])

  // Already released: the restart moved nothing and ended no generation.
  expect(ended).not.toHaveBeenCalled()
  expect(store.getRecord(RELEASED)?.lease.runtimeFence).toBe(14)
  // Nothing proved its owner gone, but the runtime that held it was replaced, which ends it.
  expect(await turnState(current, RELEASED)).toBe('interrupted')
  const { journal } = current.collaboratorsForTests().sessions.get(RELEASED)!
  expect(journal.submission(`${RELEASED}-queued`)).toMatchObject({ dispatchState: 'rejected' })
  expect(journal.queuedMessages.list()).toEqual([
    expect.objectContaining({ body: expect.objectContaining({ role: 'user' }) })
  ])
})

it('opens and writes nothing for a chat whose saved epoch holds no row, and owes it nothing', async () => {
  // An older build's repair crashed after naming the epoch: nothing durable is there to settle.
  await seedTestAgentSessionRecordStore(root, { records: [record(RELEASED, true)] })
  const database = openTestJournalHostDatabase(root)
  const identity = { sessionId: RELEASED, workspaceId: LOCATION.workspaceId }
  publishJournalSessionEpoch(database.db, identity, 'empty-epoch')
  store = await openTestAgentSessionRecordStore(root)
  const open = vi.spyOn(AgentSessionJournal.prototype, 'open')
  host = openScanHost(root, store)
  const current = host

  await current.reconcileRestartLeases()
  await current.startupSettled()

  expect(retryOwes(current.collaboratorsForTests().reconciliation, RELEASED)).toBe(false)
  // No retry comes back to it: a fresh epoch held only by a read was a busy loop once.
  await new Promise((resolve) => setTimeout(resolve, 1_200))
  expect(open).not.toHaveBeenCalled()
  expect(readJournalSessionEpoch(database.db, RELEASED)).toBe('empty-epoch')
})

it("never holds the round for a chat's busy lane: a person's long operation delays no other chat", async () => {
  const chats = ['chat-aaaaaaa1', 'chat-aaaaaaa2', 'chat-aaaaaaa3']
  await seed(chats)
  const started = performance.now()
  const visits: Record<string, number> = {}
  const pass = reconciliationPass.runStructuredAgentSessionReconciliationPass
  vi.spyOn(reconciliationPass, 'runStructuredAgentSessionReconciliationPass').mockImplementation(
    async (...args) => {
      visits[args[1]] ??= performance.now() - started
      return pass(...args)
    }
  )
  host = openScanHost(root, store)
  // A person's operation holds the first chat's lane for 3 s (a Stop waiting out its deadline).
  const [busy, ...others] = chats
  const person = host
    .collaboratorsForTests()
    .serialize(busy!, () => new Promise((resolve) => setTimeout(resolve, 3_000)))
  await host.reconcileRestartLeases()
  await vi.waitFor(() => expect(Object.keys(visits)).toHaveLength(2), { timeout: 10_000 })

  expect(Math.max(...others.map((id) => visits[id] ?? Infinity))).toBeLessThan(1_500)
  expect(visits[busy!]).toBeUndefined()
  // The busy chat is visited once its lane frees.
  await person
  await vi.waitFor(() => expect(visits[busy!]).toBeGreaterThan(2_900), { timeout: 10_000 })
}, 20_000)

it('replays each of 20 closed chats once while a lock refuses round after round', async () => {
  const chats = Array.from({ length: 20 }, (_, i) => `chat-r${String(i).padStart(6, '0')}`)
  await seed(chats)
  let held = true
  const passes = lockPasses(
    () => held,
    () => true
  )
  const loads = vi.spyOn(reconciliationLoad, 'loadStructuredAgentSessionForReconciliation')
  host = openScanHost(root, store)
  await host.reconcileRestartLeases()

  // Rounds at 0 s, 1 s, 3 s and 5 s, each stopped by the lock.
  await pause(5_500)
  expect(passes.mock.calls.length).toBeGreaterThanOrEqual(3)
  held = false
  await idle(host, chats)

  expect(loads.mock.calls.length).toBeLessThanOrEqual(20)
}, 30_000)

it("never signals a restored chat's agent for a latch that came after the restore", async () => {
  await seed([CHAT, OTHER])
  const { probeOwner, stopOwnerProcess } = surviving()
  host = openScanHost(root, store, { probeOwner, stopOwnerProcess })
  await host.reconcileRestartLeases()
  await host.restoreReadableSessions([CHAT])
  await idle(host, [CHAT, OTHER])
  const probes = probeOwner.mock.calls.length

  // Mid-session its lease latches, its owner alive; another chat's rounds run.
  const { ownerProcess, reservedSpawnToken } = record(CHAT, false).lease
  await store.transitionHandoff(
    CHAT,
    latch({ ownerProcess, reservedSpawnToken, claimStatus: 'reserved' })
  )
  let held = true
  lockPasses(
    () => held,
    (sessionId) => sessionId === OTHER
  )
  host.collaboratorsForTests().reconciliation.signal(OTHER)
  await pause(3_500)
  held = false
  await idle(host, [OTHER])

  expect(stopOwnerProcess).not.toHaveBeenCalled()
  expect(probeOwner).toHaveBeenCalledTimes(probes)
  expect(store.getRecord(CHAT)?.lease.handoffStage).toBe('recovering')
}, 30_000)

it('on a read-only store, attempts no store-wide step and still visits the other chats', async () => {
  await seed([CHAT, OTHER], [CHAT])
  // A newer Orca wrote the database: a latched lease here stays latched.
  Object.defineProperty(openTestJournalHostDatabase(root), 'readOnly', { value: true })
  const { probeOwner, stopOwnerProcess } = surviving()
  host = openScanHost(root, store, { probeOwner, stopOwnerProcess })
  await host.reconcileRestartLeases()
  await host.restoreReadableSessions([CHAT])
  expect(store.getRecord(CHAT)?.lease.handoffStage).toBe('recovering')
  const reconcile = vi.spyOn(store, 'reconcileOnRestart')
  const probes = probeOwner.mock.calls.length
  const stops = stopOwnerProcess.mock.calls.length

  host.collaboratorsForTests().reconciliation.signal(OTHER)
  await idle(host, [CHAT, OTHER])
  await pause(3_500)

  expect(reconcile).not.toHaveBeenCalled()
  expect(probeOwner).toHaveBeenCalledTimes(probes)
  expect(stopOwnerProcess).toHaveBeenCalledTimes(stops)
}, 30_000)

it.each([
  ['a conflicted claim', { claimStatus: 'conflicted' as const }],
  [
    'an owner on another host',
    {
      ownerProcess: { hostId: 'other', pid: 12_000, processStartTimeMs: 0, spawnToken: 'spawn' }
    }
  ]
])(
  'never re-probes %s round after round',
  async (_name, lease) => {
    await seed([CHAT, OTHER], [CHAT])
    const { probeOwner, stopOwnerProcess } = surviving()
    host = openScanHost(root, store, { probeOwner, stopOwnerProcess })
    await host.reconcileRestartLeases()
    expect(store.getRecord(CHAT)?.lease.handoffStage).toBe('recovering')
    await store.transitionHandoff(CHAT, latch(lease))
    await host.restoreReadableSessions([CHAT])
    await idle(host, [CHAT])
    const probes = probeOwner.mock.calls.length

    // Another chat's rounds, refused by a lock at 0 s, 1 s and 3 s.
    let held = true
    lockPasses(
      () => held,
      (sessionId) => sessionId === OTHER
    )
    host.collaboratorsForTests().reconciliation.signal(OTHER)
    await pause(3_500)
    held = false
    await idle(host, [OTHER])

    expect(probeOwner).toHaveBeenCalledTimes(probes)
    expect(stopOwnerProcess).not.toHaveBeenCalled()
    expect(store.getRecord(CHAT)?.lease.handoffStage).toBe('recovering')
  },
  30_000
)

it("never stops a hidden chat's agent that readers only read, after reconciles a lock refused", async () => {
  // Its agent outlived the earlier process, and the first two reconciles meet a lock.
  await seed([CHAT], [CHAT])
  vi.spyOn(store, 'reconcileOnRestart').mockRejectedValueOnce(busy()).mockRejectedValueOnce(busy())
  const { probeOwner, stopOwnerProcess } = surviving()
  host = openScanHost(root, store, { probeOwner, stopOwnerProcess })
  const current = host
  await current.reconcileRestartLeases()
  expect(store.getRecord(CHAT)?.lease.unreconciled).toBe(true)

  // Every reader that opens a chat no tab shows.
  await current.history({ sessionId: CHAT, direction: 'tail' }, 'own-agent') // worker-show
  await current.journalSnapshot(CHAT) // a mailbox pointer
  await current.journalSnapshot(CHAT) // the conversation outline
  await current.journalSnapshot(CHAT) // a naming read
  await vi.waitFor(() => expect(store.getRecord(CHAT)?.lease.unreconciled).toBe(false), {
    timeout: 8_000
  })
  // Rounds enough for anything that would decide it.
  await new Promise((resolve) => setTimeout(resolve, 3_000))

  expect(stopOwnerProcess).not.toHaveBeenCalled()
  expect(store.getRecord(CHAT)?.lease.handoffStage).toBe('recovering')
}, 20_000)
