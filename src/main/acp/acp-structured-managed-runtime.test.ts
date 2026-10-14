import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, join } from 'node:path'
import { afterEach, expect, it, vi } from 'vitest'
import { agentSessionRecordFixture } from '../../shared/agent-session-record.test-fixture'
import { closeProviderTimelineRigs } from '../native-chat/agent-session-timeline/provider-timeline-assembler-test-support'
import type { StructuredAgentCommandSettings } from '../native-chat/structured-agent-command-resolution'
import { createAcpStructuredLaunchResolver } from '../runtime/structured-agent-launch-composition.test-support'
import { GROK, openAcpAdapterRig } from './acp-structured-adapter.test-support'
import { AcpLaunchGate } from './acp-launch-gate'

afterEach(() => closeProviderTimelineRigs())

it('installs the managed runtime when no copy or applicable Command setting is found', async () => {
  const dataDirectory = await mkdtemp(join(tmpdir(), 'orca-acp-managed-'))
  const homePath = join(dataDirectory, 'home')
  const command = `orca-managed-${basename(dataDirectory)}`
  const folder = () => join(dataDirectory, 'runtimes', 'grok')
  const materialize = vi.fn(async () => {
    await mkdir(folder(), { recursive: true })
    await writeFile(join(folder(), command), '', { mode: 0o755 })
  })
  const spec = { ...GROK, command, managedRuntime: { folder, materialize } }
  const signal = new AbortController().signal
  const spawn = async (commandSettings: StructuredAgentCommandSettings, launchSpec = spec) => {
    const resolve = createAcpStructuredLaunchResolver(launchSpec, {
      store: {
        getRecord: () => ({
          ...agentSessionRecordFixture(),
          provider: 'grok',
          providerHandleChain: [],
          accountHome: { variable: 'GROK_HOME', path: join(dataDirectory, '.grok') }
        }),
        pinLaunchDirectory: vi.fn()
      },
      readJournal: () => null,
      resolveEnvironment: async () => ({ PATH: '', HOME: homePath }),
      resolveCommandSettings: () => commandSettings,
      dataDirectory
    })
    const rig = await openAcpAdapterRig({
      spec: launchSpec,
      deps: { resolveLaunch: resolve, dataDirectory }
    })
    await rig.acquire({ signal })
    return rig.child().launch.command
  }
  const custom = join(dataDirectory, 'custom-grok.cmd')
  await writeFile(custom, '', { mode: 0o755 })
  expect(await spawn({ agentCmdOverrides: { grok: custom } })).toBe(custom)
  expect(materialize).not.toHaveBeenCalled()
  expect(
    await spawn(
      { agentCmdOverrides: { grok: custom } },
      { ...spec, ignoreAgentCommandSetting: true }
    )
  ).toBe(join(folder(), command))
  expect(materialize).toHaveBeenCalledExactlyOnceWith(dataDirectory, signal)
  expect(await spawn({})).toBe(join(folder(), command))
  expect(materialize).toHaveBeenCalledExactlyOnceWith(dataDirectory, signal)
  const localBin = join(homePath, '.local', 'bin')
  await mkdir(localBin, { recursive: true })
  await writeFile(join(localBin, command), '', { mode: 0o755 })
  expect(
    await spawn(
      { agentCmdOverrides: { grok: custom } },
      { ...spec, ignoreAgentCommandSetting: true }
    )
  ).toBe(join(localBin, command))
  expect(materialize).toHaveBeenCalledTimes(1)
  await rm(dataDirectory, { recursive: true, force: true })
})

it('aborts a managed runtime install when account work starts', async () => {
  const gate = new AcpLaunchGate('account changing')
  const materialize = vi.fn(
    (_dataDirectory: string, signal?: AbortSignal) =>
      new Promise<void>((_resolve, reject) =>
        signal?.addEventListener('abort', () => reject(new Error('aborted')), { once: true })
      )
  )
  const spec = {
    ...GROK,
    launchGate: gate,
    managedRuntime: { folder: () => '', materialize }
  }
  const rig = await openAcpAdapterRig({
    spec,
    launch: { command: spec.command },
    deps: { dataDirectory: tmpdir() }
  })
  const starting = rig.acquire().catch((error: unknown) => error)
  await vi.waitFor(() => expect(materialize).toHaveBeenCalledOnce())
  await gate.run(
    async () => expect(rig.spawned).toEqual([]),
    async () => {}
  )
  expect(await starting).toBeInstanceOf(Error)
})
