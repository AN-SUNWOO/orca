import { describe, expect, it } from 'vitest'
import {
  VERIFIED_PAIRING_LINK_HOST,
  VERIFIED_PAIRING_LINK_PATH,
  buildVerifiedPairingLink,
  extractVerifiedPairingLinkCode
} from './verified-pairing-link'

describe('verified pairing link', () => {
  it('carries the code in the fragment, never the query string', () => {
    const link = buildVerifiedPairingLink('abc_123-x')
    expect(link).toBe(
      `https://${VERIFIED_PAIRING_LINK_HOST}${VERIFIED_PAIRING_LINK_PATH}#abc_123-x`
    )
    expect(link).not.toContain('?')
  })

  it('round-trips the code', () => {
    expect(extractVerifiedPairingLinkCode(buildVerifiedPairingLink('abc123'))).toBe('abc123')
  })

  it('accepts host casing, surrounding whitespace and an ignored query', () => {
    expect(extractVerifiedPairingLinkCode('  HTTPS://WWW.ONORCA.DEV/pair#abc\n')).toBe('abc')
    expect(extractVerifiedPairingLinkCode('https://www.onorca.dev/pair?utm=x#abc')).toBe('abc')
  })

  it('never reads a code from the query string', () => {
    expect(extractVerifiedPairingLinkCode('https://www.onorca.dev/pair?code=abc')).toBeNull()
  })

  it('rejects other hosts, ports, user info, schemes and paths', () => {
    for (const url of [
      'https://onorca.dev.evil.example/pair#abc',
      'https://evil.example/pair#abc',
      'https://onorca.dev/pair#abc',
      'https://www.onorca.dev:8443/pair#abc',
      'https://user@www.onorca.dev/pair#abc',
      'http://www.onorca.dev/pair#abc',
      'https://www.onorca.dev/pairing#abc',
      'https://www.onorca.dev/pair/#abc',
      'https://www.onorca.dev/pair-confirm#abc',
      'https://www.onorca.dev/pair#',
      'orca://pair#abc'
    ]) {
      expect(extractVerifiedPairingLinkCode(url), url).toBeNull()
    }
  })
})
