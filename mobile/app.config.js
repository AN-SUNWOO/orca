// Why this file exists: a bare "expo-notifications" plugin entry writes
// `aps-environment: development` into the iOS entitlements, while push-token.ts
// reports `production` for every non-__DEV__ build. A TestFlight or App Store build
// would then register a production APNs token against a sandbox entitlement, and the
// gateway's pushes would be accepted by Apple and delivered nowhere. Deriving the
// mode from an env var the release workflow sets makes the two agree by construction
// instead of relying on the export step to rewrite the entitlement.
//
// app.json stays the source for everything else: Expo reads it first and hands it to
// this function, so the fastlane version/buildNumber rewrite still flows through.
const APS_ENVIRONMENT =
  process.env.ORCA_IOS_APS_ENVIRONMENT === 'production' ? 'production' : 'development'

// Verified pairing links. Mirrors src/shared/verified-pairing-link.ts and config/verified-links/;
// src/shared/verified-pairing-link-files.test.ts fails if they drift.
const VERIFIED_PAIRING_LINK_HOST = 'www.onorca.dev'
const VERIFIED_PAIRING_LINK_PATH = '/pair'
// Why opt-in: an App Store archive with this entitlement fails to sign until the App ID has the
// Associated Domains capability (config/verified-links/README.md).
const IOS_ASSOCIATED_DOMAINS = process.env.ORCA_IOS_ASSOCIATED_DOMAINS === '1'

module.exports = ({ config }) => ({
  ...config,
  ios: {
    ...config.ios,
    ...(IOS_ASSOCIATED_DOMAINS
      ? { associatedDomains: [`applinks:${VERIFIED_PAIRING_LINK_HOST}`] }
      : {}),
    entitlements: { ...config.ios?.entitlements, 'aps-environment': APS_ENVIRONMENT }
  },
  android: {
    ...config.android,
    intentFilters: [
      ...(config.android?.intentFilters ?? []),
      {
        action: 'VIEW',
        autoVerify: true,
        data: [
          { scheme: 'https', host: VERIFIED_PAIRING_LINK_HOST, path: VERIFIED_PAIRING_LINK_PATH }
        ],
        category: ['BROWSABLE', 'DEFAULT']
      }
    ]
  },
  plugins: (config.plugins ?? []).map((plugin) =>
    plugin === 'expo-notifications'
      ? [
          'expo-notifications',
          {
            enableBackgroundRemoteNotifications: true,
            mode: APS_ENVIRONMENT,
            icon: './assets/notification-icon.png'
          }
        ]
      : plugin
  )
})
