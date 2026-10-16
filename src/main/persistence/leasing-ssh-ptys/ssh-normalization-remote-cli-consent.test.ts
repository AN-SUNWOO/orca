import { describe, expect, it } from 'vitest'
import type { SshTarget } from '../../../shared/ssh-types'
import { normalizeSshTarget } from './ssh-normalization'

const base: SshTarget = { id: 'ssh-1', label: 'Box', host: 'box', port: 22, username: 'me' }

describe("loading a host's orca CLI control switch (#29145)", () => {
  it('turns off a switch saved before it let the host drive the desktop browser, and says why', () => {
    const loaded = normalizeSshTarget({ ...base, allowRemoteCliControl: true })

    expect(loaded.allowRemoteCliControl).toBeUndefined()
    expect(loaded.allowRemoteCliControlReset).toBe(true)
  })

  it('keeps a switch the user turned on with its current meaning', () => {
    const loaded = normalizeSshTarget({
      ...base,
      allowRemoteCliControl: true,
      allowRemoteCliControlConsent: 'desktop-browser-bridge'
    })

    expect(loaded.allowRemoteCliControl).toBe(true)
    expect(loaded.allowRemoteCliControlReset).toBeUndefined()
  })

  it('keeps the notice across loads until the switch is saved, and drops a stray consent', () => {
    const reset = normalizeSshTarget(normalizeSshTarget({ ...base, allowRemoteCliControl: true }))
    expect(reset.allowRemoteCliControlReset).toBe(true)

    const stray = normalizeSshTarget({
      ...base,
      allowRemoteCliControlConsent: 'desktop-browser-bridge'
    })
    expect(stray.allowRemoteCliControlConsent).toBeUndefined()
    expect(stray.allowRemoteCliControl).toBeUndefined()
  })
})
