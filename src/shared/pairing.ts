import {
  PAIRING_OFFER_VERSION,
  PairingOfferSchema,
  type PairingOffer
} from './mobile-relay-pairing-offer'
import {
  PAIRING_CODE_MAX_CHARACTERS,
  PAIRING_INPUT_MAX_CHARACTERS
} from './mobile-pairing-protocol-limits'
import { buildVerifiedPairingLink, extractVerifiedPairingLinkCode } from './verified-pairing-link'

export { PAIRING_OFFER_VERSION, PairingOfferSchema }
export type { PairingOffer }

export function encodePairingOffer(offer: PairingOffer): string {
  const json = JSON.stringify(PairingOfferSchema.parse(offer))
  const base64url = Buffer.from(json, 'utf-8')
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '')
  if (base64url.length > PAIRING_CODE_MAX_CHARACTERS) {
    throw new Error('Pairing offer exceeds safe size')
  }
  // Why: Android camera intents and Expo Router preserve query params more
  // reliably than URL fragments when launching a custom-scheme app.
  return `orca://pair?code=${base64url}`
}

export function decodePairingOffer(url: string): PairingOffer {
  if (url.length > PAIRING_INPUT_MAX_CHARACTERS) {
    throw new Error('Invalid pairing URL: pairing code exceeds safe size')
  }
  const code = extractPairingCodeFromUrl(url)
  if (!code) {
    throw new Error(
      'Invalid pairing URL: must be an orca://pair or verified https pairing link with a code'
    )
  }
  return decodePairingBase64(code)
}

/** The form handed to a phone: the custom scheme can be claimed by any app, this link cannot. */
export function toVerifiedPairingLink(pairingUrl: string): string | null {
  const code = extractPairingCodeFromUrl(pairingUrl)
  return code ? buildVerifiedPairingLink(code) : null
}

function extractPairingCodeFromUrl(url: string): string | null {
  const verifiedCode = extractVerifiedPairingLinkCode(url)
  if (verifiedCode) {
    return verifiedCode
  }
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    return null
  }
  // Why: prefix checks accepted routes like `orca://pairing?...`; only the
  // pairing deep-link host may carry runtime auth material.
  if (parsed.protocol !== 'orca:' || parsed.hostname !== 'pair') {
    return null
  }
  if (parsed.pathname !== '' && parsed.pathname !== '/') {
    return null
  }
  const code = parsed.searchParams.get('code')
  if (code) {
    return code
  }
  return parsed.hash ? parsed.hash.slice(1) || null : null
}

// Why: accept an `orca://pair?...` URL, a verified https link, or the bare base64
// string so the mobile paste-pair flow can take whichever the user
// actually copied from desktop.
export function parsePairingCode(input: string): PairingOffer | null {
  if (input.length > PAIRING_INPUT_MAX_CHARACTERS) {
    return null
  }
  const trimmed = input.trim()
  if (!trimmed) {
    return null
  }
  try {
    if (/^(?:orca|https):\/\//i.test(trimmed)) {
      return decodePairingOffer(trimmed)
    }
    return decodePairingBase64(trimmed)
  } catch {
    return null
  }
}

function decodePairingBase64(base64url: string): PairingOffer {
  if (
    base64url.length === 0 ||
    base64url.length > PAIRING_CODE_MAX_CHARACTERS ||
    !/^[A-Za-z0-9+/_-]+={0,2}$/.test(base64url)
  ) {
    throw new Error('Invalid pairing code')
  }
  const base64 = base64url.replace(/-/g, '+').replace(/_/g, '/')
  const json =
    typeof Buffer === 'undefined'
      ? new TextDecoder().decode(
          Uint8Array.from(atob(base64), (character) => character.charCodeAt(0))
        )
      : Buffer.from(base64, 'base64').toString('utf-8')
  return PairingOfferSchema.parse(JSON.parse(json))
}
