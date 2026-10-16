import { describe, expect, it, vi } from 'vitest'
import type { ProcessResult, ProcessSpec } from '@orca/process-host/process-spec'
import { resolveOrcadOsKeyring } from './orcad-os-keyring'

function result(partial: Partial<ProcessResult>): ProcessResult {
  return { code: 0, signal: null, stdout: '', stderr: '', timedOut: false, ...partial }
}

describe('resolveOrcadOsKeyring', () => {
  it('uses no keyring on Windows, or on Linux without a session bus', () => {
    expect(resolveOrcadOsKeyring('win32', {})).toBeNull()
    expect(resolveOrcadOsKeyring('linux', {})).toBeNull()
    expect(resolveOrcadOsKeyring('linux', { DBUS_SESSION_BUS_ADDRESS: 'unix:path=/x' })).not.toBe(
      null
    )
  })

  it('macOS: tells a missing item apart from a locked or slow Keychain', async () => {
    const runner = vi.fn<(spec: ProcessSpec) => Promise<ProcessResult>>()
    const keychain = resolveOrcadOsKeyring('darwin', {}, runner)!
    runner.mockResolvedValueOnce(result({ stdout: 'a2V5\n' }))
    expect(await keychain.lookup('acct')).toEqual({ kind: 'found', value: 'a2V5' })
    runner.mockResolvedValueOnce(result({ code: 44 }))
    expect(await keychain.lookup('acct')).toEqual({ kind: 'missing' })
    runner.mockResolvedValueOnce(result({ code: 36, stderr: 'User interaction is not allowed.' }))
    expect((await keychain.lookup('acct')).kind).toBe('unreachable')
    runner.mockResolvedValueOnce(result({ code: null, timedOut: true }))
    expect(await keychain.lookup('acct')).toEqual({
      kind: 'unreachable',
      reason: 'timed out after 5s'
    })
    expect(runner.mock.calls.every(([spec]) => spec.timeoutMs === 5_000)).toBe(true)
  })

  it('macOS: never puts the key on argv, where every user can read it in ps', async () => {
    const runner = vi.fn(async (_spec: ProcessSpec) => result({}))
    await resolveOrcadOsKeyring('darwin', {}, runner)!.store('acct', 'SECRETKEY=')
    const [spec] = runner.mock.calls[0]
    expect(spec.args).toEqual(['-i'])
    expect(spec.input).toContain('-w SECRETKEY=')
    // Never -U: an existing item must not be replaced.
    expect(spec.input).not.toContain('-U')
  })

  it('Linux: passes the key on stdin and treats a silent exit 1 as missing', async () => {
    const runner = vi.fn<(spec: ProcessSpec) => Promise<ProcessResult>>()
    const keyring = resolveOrcadOsKeyring('linux', { DBUS_SESSION_BUS_ADDRESS: 'x' }, runner)!
    runner.mockResolvedValueOnce(result({}))
    expect(await keyring.store('acct', 'SECRETKEY=')).toBe(true)
    expect(runner.mock.calls[0][0].args).not.toContain('SECRETKEY=')
    expect(runner.mock.calls[0][0].input).toBe('SECRETKEY=')
    runner.mockResolvedValueOnce(result({ code: 1 }))
    expect(await keyring.lookup('acct')).toEqual({ kind: 'missing' })
    runner.mockResolvedValueOnce(
      result({ code: 1, stderr: 'Cannot create an item in a locked collection' })
    )
    expect((await keyring.lookup('acct')).kind).toBe('unreachable')
    runner.mockRejectedValueOnce(
      Object.assign(new Error('spawn secret-tool ENOENT'), { code: 'ENOENT' })
    )
    expect(await keyring.lookup('acct')).toEqual({
      kind: 'unreachable',
      reason: 'spawn secret-tool ENOENT'
    })
  })
})
