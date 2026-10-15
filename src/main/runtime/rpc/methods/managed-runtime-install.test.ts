import { existsSync } from 'node:fs'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, it, vi } from 'vitest'
import { acpLaunchSpecFor } from '../../../acp/acp-launch-specs'
import type * as LaunchSpecs from '../../../acp/acp-launch-specs'
import { writeRuntimeReleaseReceipt } from '../../../node-runtime/managed-runtime-release'
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
// A host with one loaded chat, which a requested close stops.
const chats = vi.hoisted((): { loaded: string[]; closed: string[] } => ({ loaded: [], closed: [] }))
vi.mock(
  '../../../native-chat/agent-session-wire/structured-agent-session-registry',
  async (actual) => ({
    ...(await actual<object>()),
    getStructuredAgentSessionHost: () => ({
      loadedSessionIds: () => [...chats.loaded],
      sessionAgent: () => 'opencode',
      close: async (id: string) => {
        chats.closed.push(id)
        chats.loaded = chats.loaded.filter((loaded) => loaded !== id)
      }
    })
  })
)
vi.mock('../../../acp/acp-launch-specs', async (importOriginal) => {
  const actual = await importOriginal<typeof LaunchSpecs>()
  const { AcpLaunchGate } = await import('../../../acp/acp-launch-gate')
  const launchGate = new AcpLaunchGate('Grok')
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
      return spec && { ...spec, command: 'orca-rpc-managed-test', managedRuntime, launchGate }
    }
  }
})

const [statusMethod, installMethod, cancelMethod, removeMethod] = MANAGED_RUNTIME_INSTALL_METHODS
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

it('removes the files only once every chat and unclosed child that may run them is stopped', async () => {
  host.dataDirectory = await mkdtemp(join(tmpdir(), 'orca-runtime-remove-rpc-'))
  const agent = 'opencode'
  const spec = acpLaunchSpecFor(agent)
  const pin = spec?.managedRuntime?.pin()
  if (!spec?.launchGate || !pin) {
    throw new Error('managed test spec missing')
  }
  const release = join(host.dataDirectory, 'rt', pin.version)
  await mkdir(release, { recursive: true })
  await writeFile(join(release, 'server'), 'server', { mode: 0o755 })
  await writeRuntimeReleaseReceipt(release, pin)
  const removed = async () => {
    await removeMethod.handler({ agent }, ctx)
    await vi.waitFor(async () =>
      expect((await statusMethod.handler({ agent }, ctx)).operation?.phase).toMatch(/ed$/)
    )
    return statusMethod.handler({ agent }, ctx)
  }
  // A sign-in child whose close was never proven still holds the files.
  const child = { close: vi.fn(async () => false), onExit: () => {} }
  spec.launchGate.retain(child)
  chats.loaded = ['chat-1']
  expect(await removed()).toMatchObject({
    installedVersion: pin.version,
    operation: { kind: 'remove', phase: 'failed', error: expect.stringContaining('stopped') }
  })

  child.close.mockResolvedValue(true)
  chats.loaded = ['chat-2']
  expect(await removed()).toMatchObject({
    installedVersion: null,
    source: null,
    operation: { kind: 'remove', phase: 'succeeded' }
  })
  expect(chats.closed).toEqual(['chat-1', 'chat-2'])
  expect(existsSync(join(host.dataDirectory, 'rt'))).toBe(false)
  await rm(host.dataDirectory, { recursive: true, force: true })
})
