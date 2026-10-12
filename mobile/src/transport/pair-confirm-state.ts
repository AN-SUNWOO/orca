import { deriveHostFingerprint } from '../notifications/push-host-fingerprint'
import { parsePairingCode } from './pairing'
import type { PairingOffer } from './types'

export type PairConfirmRouteState =
  | { kind: 'ready'; offer: PairingOffer; errorMessage: '' }
  | { kind: 'error'; offer: null; errorMessage: string }

export function resolvePairConfirmRouteState(code: string | undefined): PairConfirmRouteState {
  if (!code) {
    return { kind: 'error', offer: null, errorMessage: 'Missing pairing code' }
  }

  const offer = parsePairingCode(code)
  if (!offer) {
    return { kind: 'error', offer: null, errorMessage: 'Not a valid pairing code' }
  }

  return { kind: 'ready', offer, errorMessage: '' }
}

/** What the user checks against the desktop before pairing; a verified link proves the app, not the host. */
export function describePairingHost(offer: PairingOffer): {
  endpoint: string
  keyFingerprint: string | null
} {
  return { endpoint: offer.endpoint, keyFingerprint: deriveHostFingerprint(offer.publicKeyB64) }
}
