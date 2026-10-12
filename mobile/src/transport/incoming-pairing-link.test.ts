import { describe, expect, it } from 'vitest'
import { PAIR_SCAN_LINK_REFUSED_NOTICE, redirectIncomingPairingLink } from './incoming-pairing-link'

const refused = `/pair-scan?notice=${PAIR_SCAN_LINK_REFUSED_NOTICE}`

describe('redirectIncomingPairingLink', () => {
  it('sends a verified https link to the confirm screen with the fragment code', () => {
    expect(redirectIncomingPairingLink('https://www.onorca.dev/pair#abc_1-2')).toBe(
      '/pair-confirm?code=abc_1-2'
    )
  })

  it('refuses a pairing code carried by the custom scheme', () => {
    for (const url of [
      'orca://pair?code=abc123',
      'orca://pair#abc123',
      'ORCA://PAIR?code=abc123',
      'orca://pair/?code=abc123',
      'orca:///pair?code=abc123',
      'orca://pair-confirm?code=abc123',
      'orca:///pair-confirm?code=abc123',
      'exp+orca-mobile://pair-confirm?code=abc123',
      'orca://pair%2Dconfirm?code=abc123',
      'orca://./pair-confirm?code=abc123',
      'orca://h/host-1?code=abc123',
      'orca://pair-confirm?%63ode=abc123',
      'orca://pair-confirm?CODE=abc123',
      'orca:///ignored/../pair-confirm?code=abc123',
      `orca://expo-development-client/?url=${encodeURIComponent('orca://pair-confirm?code=abc123')}`,
      `exp+orca-mobile://expo-development-client/?url=${encodeURIComponent(
        encodeURIComponent('orca://pair-confirm?code=abc123')
      )}`,
      `orca://expo-development-client/?url=${encodeURIComponent('orca://pair-confirm?%2563ode=abc')}`,
      `orca://expo-development-client/?junk=%ZZ&url=${encodeURIComponent('orca://pair-confirm?code=x')}`,
      'orca://expo-development-client/?url=orca%3A%2F%2Fpair-confirm%3Fa%3D%E0%26code%3DSECRET',
      'orca://expo-development-client/?url=orca://pair-confirm?a%3D%E0%26code%3DSECRET',
      'orca://pair-confirm?code=SECRET#\u2029x',
      'orca://pair-confirm?code=SECRET#\nx',
      'orca://pair-confirm?code=SECRET#\u2028x',
      'orca://expo-development-client/?url=orca://pair-confirm?co%09de=SECRET',
      'orca://expo-development-client/?url=orca://pair-confirm?c%0Aode=SECRET',
      'orca://expo-development-client/?url=orca://pair-confirm%3Fcode%0D=SECRET'
    ]) {
      expect(redirectIncomingPairingLink(url), url).toBe(refused)
    }
  })

  it('refuses a code nested in development-client wrappers at any depth', () => {
    let url = 'orca://pair-confirm?code=abc123'
    for (let depth = 0; depth < 12; depth++) {
      url = `orca://expo-development-client/?url=${encodeURIComponent(url)}`
    }
    expect(redirectIncomingPairingLink(url)).toBe(refused)
  })

  it('opens the scanner for a bare custom-scheme pairing link', () => {
    expect(redirectIncomingPairingLink('orca://pair')).toBe('/pair-scan')
    expect(redirectIncomingPairingLink('orca://pair/')).toBe('/pair-scan')
  })

  it('refuses unverified https links that target a pairing screen', () => {
    expect(redirectIncomingPairingLink('https://evil.example/pair#abc123')).toBe(refused)
    expect(redirectIncomingPairingLink('https://www.onorca.dev/pair-confirm?code=abc')).toBe(
      refused
    )
    expect(redirectIncomingPairingLink('https://www.onorca.dev/pair?code=abc')).toBe(refused)
  })

  it('leaves every other link to the router', () => {
    expect(redirectIncomingPairingLink('orca://h/host-1/session/wt-1')).toBeNull()
    expect(redirectIncomingPairingLink('orca://pairing')).toBeNull()
    expect(redirectIncomingPairingLink('orca://h/host-1?notice=x#y')).toBeNull()
    expect(redirectIncomingPairingLink('orca://pair-scan')).toBeNull()
    expect(redirectIncomingPairingLink('orca://h/host-1/session/pair')).toBeNull()
    expect(redirectIncomingPairingLink('/settings')).toBeNull()
  })
})
