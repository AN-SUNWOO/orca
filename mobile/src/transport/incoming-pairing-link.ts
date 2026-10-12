import { extractExpoPathFromURL } from 'expo-router/build/fork/extractPathFromURL'
import { parseUrlUsingCustomBase } from 'expo-router/build/utils/url'
import { extractVerifiedPairingLinkCode } from '../../../src/shared/verified-pairing-link'

export const PAIR_SCAN_LINK_REFUSED_NOTICE = 'custom-scheme-link'

const REFUSED_PATH = `/pair-scan?notice=${PAIR_SCAN_LINK_REFUSED_NOTICE}`
const PAIRING_ROUTES = new Set(['pair', 'pair-confirm'])
const DEV_CLIENT_HOST = 'expo-development-client'

/** The router's own reading of an OS link: the same functions its linking uses, after this hook. */
export function resolveRouterTarget(url: string): {
  pathname: string
  searchParams: URLSearchParams
  hash: string
} {
  const parsed = parseUrlUsingCustomBase(extractExpoPathFromURL([], url))
  return { pathname: parsed.pathname, searchParams: parsed.searchParams, hash: parsed.hash }
}

/**
 * Rewrites an OS-delivered link before the router sees it. Null leaves the link to the router.
 * Why: the OS hands an `orca://` URL to whichever app claimed the scheme, so a code it carries may
 * already be in another app's hands. Only a verified https link may start pairing. The decision is
 * made on the router's own parse, never a re-implementation, and anything unparseable is refused.
 */
export function redirectIncomingPairingLink(
  url: string,
  allowDevClientLinks: boolean = typeof __DEV__ !== 'undefined' && __DEV__
): string | null {
  const verifiedCode = extractVerifiedPairingLinkCode(url)
  if (verifiedCode) {
    return `/pair-confirm?code=${encodeURIComponent(verifiedCode)}`
  }
  // Why: the router unwraps `expo-development-client/?url=` links; release builds have no use for them.
  const outer = parseOuterUrl(url)
  if (!allowDevClientLinks && outer?.hostname === DEV_CLIENT_HOST) {
    return REFUSED_PATH
  }
  let target: ReturnType<typeof resolveRouterTarget>
  try {
    target = resolveRouterTarget(url)
  } catch {
    return REFUSED_PATH
  }
  if ([...target.searchParams.keys()].some((key) => key.toLowerCase() === 'code')) {
    return REFUSED_PATH
  }
  // Pairing screens are top-level routes; groups like `(tabs)` don't count as segments.
  const route = target.pathname
    .split('/')
    .map((segment) => safeDecode(segment).toLowerCase())
    .find((segment) => segment !== '' && !/^\(.*\)$/.test(segment))
  if (!route || !PAIRING_ROUTES.has(route)) {
    return null
  }
  // Why the outer hash too: the router drops it, but a legacy `orca://pair#<code>` still earns the notice.
  const carriesPayload =
    [...target.searchParams.keys()].length > 0 ||
    target.hash.length > 1 ||
    (outer?.hash.length ?? 0) > 1
  return carriesPayload ? REFUSED_PATH : '/pair-scan'
}

// Same check the router applies before unwrapping a development-client link.
function parseOuterUrl(url: string): URL | null {
  try {
    return new URL(url)
  } catch {
    return null
  }
}

function safeDecode(value: string): string {
  try {
    return decodeURIComponent(value)
  } catch {
    return value
  }
}
