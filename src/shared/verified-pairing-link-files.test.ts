import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { VERIFIED_PAIRING_LINK_HOST, VERIFIED_PAIRING_LINK_PATH } from './verified-pairing-link'

const repoRoot = join(__dirname, '..', '..')
const deployDir = join(repoRoot, 'config', 'verified-links')
const appJson = JSON.parse(readFileSync(join(repoRoot, 'mobile', 'app.json'), 'utf8'))
const bundleId: string = appJson.expo.ios.bundleIdentifier
const androidPackage: string = appJson.expo.android.package
// The build template's public debug key: listing it would let anyone's APK claim the links.
const PUBLIC_TEMPLATE_DEBUG_CERT =
  'FA:C6:17:45:DC:09:03:78:6F:B9:ED:E6:2A:96:2B:39:9F:73:48:F0:BB:6F:89:9B:83:32:66:75:91:03:3B:9C'

function readDeployJson<T>(name: string): T {
  return JSON.parse(readFileSync(join(deployDir, name), 'utf8'))
}

type ExpoConfig = {
  ios: { associatedDomains?: string[]; entitlements: Record<string, string> }
  android: { intentFilters: { autoVerify?: boolean }[] }
}

function loadExpoConfig(associatedDomains: boolean): ExpoConfig {
  const previous = process.env.ORCA_IOS_ASSOCIATED_DOMAINS
  process.env.ORCA_IOS_ASSOCIATED_DOMAINS = associatedDomains ? '1' : ''
  try {
    const require = createRequire(__filename)
    const configPath = require.resolve(join(repoRoot, 'mobile', 'app.config.js'))
    delete require.cache[configPath]
    return require(configPath)({ config: appJson.expo })
  } finally {
    process.env.ORCA_IOS_ASSOCIATED_DOMAINS = previous
  }
}

afterEach(() => {
  delete process.env.ORCA_IOS_ASSOCIATED_DOMAINS
})

describe('verified pairing link deploy files', () => {
  it('scopes the Apple file to the pairing path of the iOS app', () => {
    const aasa = readDeployJson<{
      applinks: { details: { appIDs: string[]; components: Record<string, string>[] }[] }
    }>('apple-app-site-association')
    expect(Object.keys(aasa)).toEqual(['applinks'])
    expect(aasa.applinks.details).toHaveLength(1)
    const [detail] = aasa.applinks.details
    expect(detail.appIDs).toHaveLength(1)
    expect(detail.appIDs[0]).toMatch(
      new RegExp(
        `^(?:[A-Z0-9]{10}|REPLACE_WITH_APPLE_TEAM_ID)\\.${bundleId.replace(/\./g, '\\.')}$`
      )
    )
    expect(detail.components.map((component) => component['/'])).toEqual([
      VERIFIED_PAIRING_LINK_PATH
    ])
    // A query or fragment matcher would narrow nothing we rely on and break the fragment-only secret.
    expect(detail.components.every((component) => !('?' in component) && !('#' in component))).toBe(
      true
    )
  })

  it('binds the Android file to the app package and a private signing key', () => {
    const statements = readDeployJson<
      {
        relation: string[]
        target: { namespace: string; package_name: string; sha256_cert_fingerprints: string[] }
      }[]
    >('assetlinks.json')
    expect(statements).toHaveLength(1)
    const [statement] = statements
    expect(statement.relation).toEqual(['delegate_permission/common.handle_all_urls'])
    expect(statement.target.namespace).toBe('android_app')
    expect(statement.target.package_name).toBe(androidPackage)
    expect(statement.target.sha256_cert_fingerprints.length).toBeGreaterThan(0)
    for (const fingerprint of statement.target.sha256_cert_fingerprints) {
      expect(fingerprint).toMatch(
        /^(?:(?:[0-9A-F]{2}:){31}[0-9A-F]{2}|REPLACE_WITH_RELEASE_SIGNING_CERT_SHA256)$/
      )
      expect(fingerprint).not.toBe(PUBLIC_TEMPLATE_DEBUG_CERT)
    }
  })

  it('registers the same host and exact path in the Android app config', () => {
    const config = loadExpoConfig(false)
    const verifiedFilters = config.android.intentFilters.filter((filter) => filter.autoVerify)
    expect(verifiedFilters).toEqual([
      {
        action: 'VIEW',
        autoVerify: true,
        data: [
          { scheme: 'https', host: VERIFIED_PAIRING_LINK_HOST, path: VERIFIED_PAIRING_LINK_PATH }
        ],
        category: ['BROWSABLE', 'DEFAULT']
      }
    ])
  })

  it('adds the iOS associated domain only when the release opts in', () => {
    expect(loadExpoConfig(false).ios.associatedDomains).toBeUndefined()
    const config = loadExpoConfig(true)
    expect(config.ios.associatedDomains).toEqual([`applinks:${VERIFIED_PAIRING_LINK_HOST}`])
    expect(config.ios.entitlements['aps-environment']).toBeDefined()
  })

  it('keeps the fallback page free of external scripts', () => {
    const html = readFileSync(join(deployDir, 'pair.html'), 'utf8')
    expect(html).not.toMatch(/<script[^>]+src=/i)
    expect(html).toContain('window.location.hash')
  })
})
