import { redirectIncomingPairingLink } from '../src/transport/incoming-pairing-link'

// Why: rewrite before routing, so no OS-delivered custom-scheme link reaches a screen that reads a code.
export function redirectSystemPath({ path }: { path: string; initial: boolean }): string {
  return redirectIncomingPairingLink(path) ?? path
}
