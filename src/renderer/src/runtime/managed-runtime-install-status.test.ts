import { afterEach, expect, it, vi } from 'vitest'
import type { ManagedRuntimeInstallState } from '../../../shared/managed-runtime-install'
import {
  installManagedRuntime,
  observeManagedRuntimeInstall,
  readManagedRuntimeInstall,
  type ManagedRuntimeInstallSubject
} from './managed-runtime-install-status'

const { call } = vi.hoisted(() => ({ call: vi.fn() }))
vi.mock('./runtime-rpc-client', () => ({ callRuntimeRpc: call }))

const state = (revision: number): ManagedRuntimeInstallState => ({
  agent: 'fake',
  revision,
  available: true,
  version: '1.3.0',
  installedVersion: null,
  installedCurrent: false,
  source: null,
  operation: null
})

afterEach(() => {
  vi.useRealTimers()
})

it('never reads a failed status read as not installed, nor rolls back to an older reply', async () => {
  vi.useFakeTimers()
  let reads = 0
  call.mockImplementation(async (_target, method: string) => {
    if (method === 'managedRuntime.install') {
      return state(1)
    }
    reads += 1
    if (reads === 1) {
      throw new Error('host unreachable')
    }
    // The second read answers; the long-poll after it waits.
    return reads === 2 ? state(2) : new Promise(() => {})
  })
  const subject: ManagedRuntimeInstallSubject = {
    target: { kind: 'local' },
    runtimeId: null,
    agent: 'fake'
  }
  const release = observeManagedRuntimeInstall(subject)
  await vi.advanceTimersByTimeAsync(0)
  expect(readManagedRuntimeInstall(subject)).toEqual({ kind: 'readFailed' })

  await vi.advanceTimersByTimeAsync(1000)
  expect(readManagedRuntimeInstall(subject)).toEqual({ kind: 'known', state: state(2) })
  expect(call).toHaveBeenLastCalledWith(
    { kind: 'local' },
    'managedRuntime.status',
    { agent: 'fake', shown: 2 },
    expect.anything()
  )

  await installManagedRuntime(subject)
  expect(readManagedRuntimeInstall(subject)).toEqual({ kind: 'known', state: state(2) })
  release()
})
