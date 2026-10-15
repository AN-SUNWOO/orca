import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { codexProviderHandle } from '../../../shared/agent-session-provider-handle-encoding'
import type { CliSourceStopHost } from '../../runtime/structured-agent-cli-stop'
import { createRestTestRig, type RestTestRig } from './structured-agent-session-rest-test-rig'
import { createTestParams, CREATE_TEST_CALLER } from './structured-agent-session-create-test-fixture'
import {
  HOST_TEST_LOCATION, HOST_TEST_SESSION, HOST_TEST_THREAD, hostTestOperationId
} from './structured-agent-session-host-test-data'

const stop = vi.hoisted(() => ({
  inspect: vi.fn(), capture: vi.fn(), judge: vi.fn(), probe: vi.fn()
}))
vi.mock('../../runtime/structured-agent-cli-stop', async (load) => ({
  ...await load<typeof import('../../runtime/structured-agent-cli-stop')>(),
  inspectCliSourceWriters: stop.inspect,
  captureCliSourceProcessIdentities: stop.capture,
  stopCliSourceAndJudge: stop.judge,
  probeCliSourceSurvivors: stop.probe
}))

let rig: RestTestRig
const identity = { pid: 4321, platform: 'linux' as const, startTime: 'start' }
const sourceHost: CliSourceStopHost = {
  rows: () => [],
  resolvePane: () => ({ ptyId: 'pty-source', connected: true }),
  sleeping: () => false,
  presence: async () => 'live',
  shellForeground: async () => false,
  rootPid: async () => 4321,
  stop: async () => ({ postStopVerified: true })
}
const cliSourceStop = {
  host: sourceHost,
  workspaceId: HOST_TEST_LOCATION.workspaceId,
  resumeFrom: {
    providerSessionId: HOST_TEST_THREAD,
    cliSource: { workspaceId: HOST_TEST_LOCATION.workspaceId, paneKey: 'pane-source', stopRunningAgent: true }
  }
}

beforeEach(async () => {
  vi.clearAllMocks()
  rig = await createRestTestRig({ idleSweep: { intervalMs: 60_000 } })
  stop.inspect.mockResolvedValue({
    ptyId: 'pty-source', workspaceId: HOST_TEST_LOCATION.workspaceId, writerMayLive: true
  })
  stop.capture.mockResolvedValue([identity])
  stop.probe.mockResolvedValue([])
})
afterEach(async () => {
  await rig.dispose()
})

async function adoptedParams() {
  const transcriptPath = join(rig.root, 'rollout.jsonl')
  await writeFile(transcriptPath, [
    JSON.stringify({
      type: 'session_meta',
      payload: { id: HOST_TEST_THREAD, timestamp: '2026-09-06T18:00:00.000Z', cwd: rig.root }
    }),
    JSON.stringify({
      type: 'response_item', timestamp: '2026-09-06T18:00:01.000Z',
      payload: { type: 'message', role: 'user', content: 'terminal history' }
    })
  ].join('\n'))
  return createTestParams(undefined, {
    adopt: { providerHandle: codexProviderHandle(HOST_TEST_THREAD), transcriptPath }
  })
}

it.skipIf(process.platform === 'win32')('reserves and saves identities before stop, then imports after exit', async () => {
  const params = await adoptedParams()
  stop.judge.mockImplementation(async () => {
    expect(rig.store.getRecord(HOST_TEST_SESSION)?.adoptionSurvivors).toEqual([identity])
    expect(rig.store.getRecord(HOST_TEST_SESSION)?.providerHandleChain[0]?.origin).toBe('adopted')
    return []
  })
  const result = await rig.host.create(CREATE_TEST_CALLER, params, { cliSourceStop })
  expect(result).toMatchObject({ ok: true, value: { page: {
    items: expect.arrayContaining([expect.objectContaining({
      body: expect.objectContaining({ blocks: [{ type: 'text', text: 'terminal history' }] })
    })])
  } } })
  expect(rig.store.getRecord(HOST_TEST_SESSION)?.adoptionSurvivors).toBeUndefined()
  expect(rig.adapter.acquire).not.toHaveBeenCalled()
})

it.skipIf(process.platform === 'win32')('keeps an unproven writer across replay and later re-probes it', async () => {
  const params = await adoptedParams()
  stop.judge.mockResolvedValue([identity])
  expect(await rig.host.create(CREATE_TEST_CALLER, params, { cliSourceStop })).toMatchObject({
    ok: false, refusal: { details: { reason: 'terminalStopUnconfirmed' } }
  })
  expect(rig.store.getRecord(HOST_TEST_SESSION)?.adoptionSurvivors).toEqual([identity])
  expect(await rig.host.create(CREATE_TEST_CALLER, params, { cliSourceStop })).toMatchObject({
    ok: false, refusal: { details: { reason: 'terminalStopUnconfirmed' } }
  })
  expect(stop.judge).toHaveBeenCalledOnce()
  const retry = {
    ...params,
    envelope: { ...params.envelope, clientOperationId: hostTestOperationId() }
  }
  stop.probe.mockResolvedValue([])
  expect(await rig.host.create(CREATE_TEST_CALLER, retry, { cliSourceStop })).toMatchObject({
    ok: true
  })
  expect(stop.probe).toHaveBeenCalledWith([identity])
  expect(stop.judge).toHaveBeenCalledOnce()
  expect(rig.store.getRecord(HOST_TEST_SESSION)?.adoptionSurvivors).toBeUndefined()
})
