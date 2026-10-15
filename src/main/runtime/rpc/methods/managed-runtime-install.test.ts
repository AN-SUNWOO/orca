import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, it, vi } from 'vitest'
import type * as LaunchSpecs from '../../../acp/acp-launch-specs'
import { classifyRuntimeLongPoll } from '../../runtime-rpc/runtime-rpc-long-poll'
import type { RpcContext } from '../core'
import { MANAGED_RUNTIME_INSTALL_METHODS } from './managed-runtime-install'

const host = vi.hoisted(() => ({ dataDirectory: '' }))
vi.mock('../../../orca-profiles/profile-storage-paths', () => ({
  getProfileUserDataPath: () => host.dataDirectory
}))
vi.mock('../../structured-agent-launch-support', () => ({
  resolveHostStructuredAgentLaunchEnvironment: async () => ({ PATH: '' })
}))
// The download never answers until its cancel.
vi.mock('../../../network/http-client', () => ({
  getMainHttpClient: () => ({
    fetch: (_url: string, { signal }: RequestInit) =>
      new Promise((_resolve, reject) => {
        signal?.throwIfAborted()
        signal?.addEventListener('abort', () => reject(signal.reason))
      })
  })
}))
vi.mock('../../../acp/acp-launch-specs', async (importOriginal) => {
  const actual = await importOriginal<typeof LaunchSpecs>()
  const pin = {
    version: '1.0',
    url: 'https://example.test/grok-1.0.tar.gz',
    archiveSha256: 'a'.repeat(64),
    archiveBytes: 10,
    members: [{ path: 'server', sha256: 'b'.repeat(64), bytes: 6 }]
  }
  const managedRuntime = { label: 'Grok', root: (data: string) => `${data}/rt`, pin: () => pin }
  return {
    ...actual,
    acpLaunchSpecFor: (agent: string) => {
      const spec = actual.acpLaunchSpecFor(agent)
      return spec && { ...spec, command: 'orca-rpc-managed-test', managedRuntime }
    }
  }
})

const [statusMethod, installMethod, cancelMethod] = MANAGED_RUNTIME_INSTALL_METHODS
// oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: the handlers read only the settings store.
const ctx = { runtime: { requireStore: () => ({ getSettings: () => ({}) }) } } as unknown as RpcContext

it('answers a status read naming its revision once another client starts the install', async () => {
  host.dataDirectory = await mkdtemp(join(tmpdir(), 'orca-runtime-install-rpc-'))
  const status = statusMethod.handler
  const request = { id: '1', authToken: '', method: statusMethod.name }
  expect(classifyRuntimeLongPoll({ ...request, params: { agent: 'grok' } })).toBe(null)
  expect(classifyRuntimeLongPoll({ ...request, params: { agent: 'grok', shown: 0 } })).toBe('wait')
  const idle = await status({ agent: 'grok' }, ctx)
  expect(idle).toMatchObject({ available: true, installedVersion: null, operation: null })
  const watcher = status({ agent: 'grok', shown: idle.revision }, ctx)
  const started = await installMethod.handler({ agent: 'grok' }, ctx)
  const seen = await watcher
  expect(seen.operation).toMatchObject({ id: started.operation?.id, phase: 'downloading' })

  const operationId = String(seen.operation?.id)
  await cancelMethod.handler({ agent: 'grok', operationId }, ctx)
  await vi.waitFor(async () =>
    expect((await status({ agent: 'grok' }, ctx)).operation?.phase).toBe('cancelled')
  )
  await rm(host.dataDirectory, { recursive: true, force: true })
})
