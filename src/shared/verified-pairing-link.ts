// Why: an `orca://` link can be claimed by any app, so a pairing secret only leaves the desktop as
// an https link the OS hands to the app whose identity the domain vouches for. Keep these in sync
// with config/verified-links/ and mobile/app.config.js; verified-pairing-link-files.test.ts checks.
// Why www: the apex redirects to www, and neither OS verifies a link through a redirect.
export const VERIFIED_PAIRING_LINK_HOST = 'www.onorca.dev'
export const VERIFIED_PAIRING_LINK_PATH = '/pair'

/** The secret rides in the fragment, which browsers never send to the server. */
export function buildVerifiedPairingLink(pairingCode: string): string {
  return `https://${VERIFIED_PAIRING_LINK_HOST}${VERIFIED_PAIRING_LINK_PATH}#${pairingCode}`
}

/** String parsing only: Hermes's URL polyfill does not expose host or hash reliably. */
export function extractVerifiedPairingLinkCode(url: string): string | null {
  const match = /^https:\/\/([^/?#]*)([^?#]*)(?:\?[^#]*)?#(.*)$/i.exec(url.trim())
  if (!match) {
    return null
  }
  const [, host, path, code] = match
  if (host?.toLowerCase() !== VERIFIED_PAIRING_LINK_HOST || path !== VERIFIED_PAIRING_LINK_PATH) {
    return null
  }
  return code || null
}
