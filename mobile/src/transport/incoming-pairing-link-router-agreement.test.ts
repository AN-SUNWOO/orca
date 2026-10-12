import { extractExpoPathFromURL } from 'expo-router/build/fork/extractPathFromURL'
import { parseUrlUsingCustomBase } from 'expo-router/build/utils/url'
import { describe, expect, it } from 'vitest'
import { redirectIncomingPairingLink } from './incoming-pairing-link'

// The oracle is the router itself: what its linking reads from an OS link after the hook passes it on.
function routerParams(url: string): URLSearchParams | null {
  try {
    return parseUrlUsingCustomBase(extractExpoPathFromURL([], url)).searchParams
  } catch {
    return null
  }
}

const TARGETS = [
  'orca://pair-confirm?code=SECRET',
  'orca://pair?code=SECRET',
  'orca://pair-confirm?a=1&code=SECRET',
  'orca:///x/../pair-confirm?code=SECRET',
  'orca://(group)/pair-confirm?code=SECRET',
  'orca://h/host-1/session/wt-1?code=SECRET',
  'https://evil.example/pair-confirm?code=SECRET',
  'exp+orca-mobile://pair-confirm?code=SECRET'
]
// Tab, LF and CR are removed anywhere; C0 controls and space are trimmed from the ends.
const STRIPPED = ['\t', '\n', '\r']
const TRIMMED = ['\u0000', '\u001f', ' ']

function* mutations(url: string): Generator<string> {
  yield url
  yield url.toUpperCase()
  yield url.replace('code', 'CODE')
  yield url.replace('code', '%63ode')
  yield url.replace('code', 'ｃｏｄｅ')
  yield url.replace('pair-confirm', 'pair%2Dconfirm')
  yield url.replace('?code=', '?code%3D')
  yield url.replace('&code=', '%26code=')
  for (const character of STRIPPED) {
    for (let index = 0; index <= url.length; index++) {
      yield url.slice(0, index) + character + url.slice(index)
    }
    yield url.replace('code', `co${encodeURIComponent(character)}de`)
  }
  for (const character of TRIMMED) {
    yield `${character}${url}${character}`
  }
}

function* wrapped(url: string): Generator<string> {
  for (const depth of [0, 1, 2, 7]) {
    for (const layers of [0, 1, 2, 3]) {
      let current = url
      for (let level = 0; level < depth; level++) {
        let inner = current
        for (let layer = 0; layer < layers; layer++) {
          inner = encodeURIComponent(inner)
        }
        current = `orca://expo-development-client/?url=${inner}`
      }
      yield current
      if (depth === 0) {
        break
      }
    }
  }
}

function* corpus(): Generator<string> {
  for (const target of TARGETS) {
    for (const mutated of mutations(target)) {
      yield* wrapped(mutated)
    }
  }
}

describe('redirectIncomingPairingLink agrees with the router', () => {
  it('never passes on a link from which the router would read a code', () => {
    let checked = 0
    for (const url of corpus()) {
      for (const allowDevClientLinks of [true, false]) {
        if (redirectIncomingPairingLink(url, allowDevClientLinks) === null) {
          const params = routerParams(url)
          expect(params, url).not.toBeNull()
          expect(params?.has('code'), JSON.stringify(url)).toBe(false)
        }
      }
      checked++
    }
    expect(checked).toBeGreaterThan(1000)
  }, 60_000)

  it('refuses every development-client wrapper in a release build', () => {
    for (const url of corpus()) {
      if (url.toLowerCase().includes('orca://expo-development-client')) {
        expect(redirectIncomingPairingLink(url, false), JSON.stringify(url)).not.toBeNull()
      }
    }
  }, 60_000)

  it('still lets ordinary links and the dev launcher through', () => {
    expect(redirectIncomingPairingLink('orca://h/host-1/session/wt-1', false)).toBeNull()
    expect(
      redirectIncomingPairingLink(
        `orca://expo-development-client/?url=${encodeURIComponent('http://192.168.1.5:8081')}`,
        true
      )
    ).toBeNull()
  })
})
