# Verified pairing links

Orca Mobile pairs from `https://www.onorca.dev/pair#<code>`. The pairing code is in the URL
fragment, which browsers never send to a server. iOS and Android open that link in Orca Mobile only
after they have fetched and verified the two files in this directory from `www.onorca.dev`. Links
that use the `orca://` scheme no longer carry a code into the app, because any app can claim that
scheme.

The marketing site that serves `www.onorca.dev` is not in this repository, so these files must be
deployed there by hand.

## What to deploy

| File in this directory       | Serve at                                                        | Content-Type       |
| ---------------------------- | --------------------------------------------------------------- | ------------------ |
| `apple-app-site-association` | `https://www.onorca.dev/.well-known/apple-app-site-association` | `application/json` |
| `assetlinks.json`            | `https://www.onorca.dev/.well-known/assetlinks.json`            | `application/json` |
| `pair.html`                  | `https://www.onorca.dev/pair`                                   | `text/html`        |

Both `.well-known` files must:

- return `200` directly, with **no redirect**. The apex `onorca.dev` redirects to `www`, which is
  why the links use `www.onorca.dev`. Neither OS follows a redirect while verifying.
- need **no authentication**, cookie, bot challenge, or other interstitial. Exempt `/.well-known/`
  from any Cloudflare bot or challenge rule.
- be served with `Content-Type: application/json`. The Apple file has no extension, so most hosts
  serve it as `application/octet-stream` unless a header rule overrides that.

`pair.html` is the page people see when the app is not installed, is too old to claim the link, or
the OS has not verified the domain yet. It explains how to pair instead, and can copy the code from
the fragment for the paste flow, which older app versions also accept. Do not add analytics or any
third-party script to this page: a script on it could read the code from the fragment.

## Placeholders to fill in before deploying

- `apple-app-site-association`: replace `REPLACE_WITH_APPLE_TEAM_ID` with the Apple Developer Team
  ID (the `APPLE_TEAM_ID` secret used by `mobile/fastlane`).
- `assetlinks.json`: replace `REPLACE_WITH_RELEASE_SIGNING_CERT_SHA256` with the SHA-256 fingerprint
  of the certificate that signs the shipped APK. If the app is published on Google Play, use the
  **app signing key** fingerprint from Play Console → App integrity, not the upload key. You can list
  more than one fingerprint, for example both the Play key and a key used for direct APK downloads.

The direct-download APK built by `.github/workflows/mobile-android-release.yml` is currently signed
with the build template's public debug keystore. Do not list that fingerprint (`FA:C6:17:45:…`): it
is public, so any app signed with it could claim the links.
`src/shared/verified-pairing-link-files.test.ts` fails if it appears.

## App side

- Android: `mobile/app.config.js` adds an `autoVerify` intent filter for `https://www.onorca.dev/pair`.
  Android checks `assetlinks.json` when the app is installed or updated.
- iOS: the associated-domains entitlement is opt-in, because an App Store archive with it fails to
  sign until the App ID has the capability. To turn it on:
  1. In the Apple Developer portal, enable **Associated Domains** on the App ID
     `com.stably.orca.mobile`. The release lane regenerates the provisioning profile on every run.
  2. Set the GitHub repository variable `ORCA_IOS_ASSOCIATED_DOMAINS` to `1`. The iOS release
     workflow then builds with `applinks:www.onorca.dev`.

The host, the path, and the app identifiers are mirrored in `src/shared/verified-pairing-link.ts`,
`mobile/app.config.js`, and the files in this directory. `src/shared/verified-pairing-link-files.test.ts`
fails if they drift apart.

## Checking a deployment

```sh
curl -sI https://www.onorca.dev/.well-known/apple-app-site-association   # 200, application/json
curl -sI https://www.onorca.dev/.well-known/assetlinks.json              # 200, application/json
```

Apple fetches the file through its own CDN, which can lag by up to a day:
`https://app-site-association.cdn-apple.com/a/v1/www.onorca.dev`. On an Android device, run
`adb shell pm get-app-links com.stably.orca.mobile` and look for `www.onorca.dev: verified`.
