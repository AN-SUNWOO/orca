import { describe, expect, it } from 'vitest'
import { SshHostNotServedError } from '../providers/ssh-host-not-served-error'
import { getActiveMultiplexer } from './ssh-target-registry'

describe('getActiveMultiplexer', () => {
  it('refuses with the typed not-served error, not a resolver wiring error', () => {
    expect(() => getActiveMultiplexer('ssh-1')).toThrow(SshHostNotServedError)
    expect(() => getActiveMultiplexer('ssh-1')).toThrow(
      'Remote connection dropped. Click Reconnect on the SSH target before retrying.'
    )
    expect(() => getActiveMultiplexer('ssh-1')).not.toThrow(
      'ssh_active_multiplexer_resolver_not_installed'
    )
  })
})
