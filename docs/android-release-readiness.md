# CARDPICK Android release readiness

Updated: 2026-08-23

This document tracks launch blockers found by static inspection of the pre-review APK.

## Observed in the current APK

- Flutter app with native screens (not a single WebView shell)
- current application ID: `kr.cardpick.cardpick_app`
- `minSdkVersion 24`
- `targetSdkVersion 36`
- `compileSdkVersion 36`
- release certificate is not the Android debug certificate
- Google Mobile Ads is present
- AdMob application ID is still Google's test application ID
- banner unit ID is still Google's test banner ID
- no Firebase Cloud Messaging / `POST_NOTIFICATIONS` wiring was observed
- no verified Android App Links intent filter was observed
- local watchlist storage (`SharedPreferences`) is present
- app bundle contains public Supabase endpoint / publishable key, which is expected for a public client only when RLS and server authorization are correct

## P0 before Play submission

- [ ] Add the original Flutter project to a durable private repository or otherwise make the source available for release engineering.
- [ ] Decide the final application ID before the first Play app is created. Preferred: `kr.cardpick.app`. Once published, do not rename it.
- [ ] Replace the Google test AdMob app ID and ad unit ID in **release only**. Keep official test IDs in debug/dev builds.
- [ ] Run Google UMP consent flow where required and expose a "privacy / ad choices" entry in app settings.
- [ ] Build and upload an Android App Bundle (`.aab`), not the universal APK.
- [ ] Complete Play Console "Contains ads" and Data safety declarations against the exact SDK versions in the final AAB.
- [ ] Verify Play App Signing and back up the upload key.
- [ ] Run Play pre-launch report on physical device matrix.
- [ ] Verify no secret/service-role key is packaged in the AAB.
- [ ] Verify release logging does not print auth tokens or user data.

## Server-side hardening included with this change

- rate-limit `/api/request-update`
- rate-limit `/api/search-log`
- reject foreign browser origins while allowing native clients without an `Origin` header
- cap JSON body size and validate slugs/query lengths
- stop returning raw exception text to clients
- only create persistent search IP hashes when `SEARCH_LOG_PEPPER` is configured
- retain existing user-scoped Supabase RLS for watchlist and price alerts

Set `SEARCH_LOG_PEPPER` as a long random Cloudflare secret/environment variable before relying on `ip_hash`. If it is not configured, `ip_hash` is deliberately stored as `null`.

## P1 immediately after source is available

- [ ] Add FCM price alerts and Android 13+ notification permission flow.
- [ ] Register device tokens per authenticated user with token rotation / logout cleanup.
- [ ] Deep-link `https://cardpick.kr/cards/<slug>` into the native card detail screen.
- [ ] Add `/.well-known/assetlinks.json` **after** final package ID and Play App Signing SHA-256 certificate fingerprint are known.
- [ ] Sync watchlist to `public.watchlist` after login; keep local storage for anonymous users and merge on sign-in.
- [ ] Add in-app links to `/app-privacy`, `/terms`, account deletion and ad privacy options.
- [ ] Add network timeout/retry/offline states and cache last successful price/card payloads.
- [ ] Add crash reporting only after its SDK data handling is reflected in Play Data safety and the privacy policy.

## Recommended Play Data safety review inputs for the final AAB

The exact answers must be based on the final dependency versions and runtime behavior. Google Mobile Ads documentation currently states that its SDK can automatically process/share data such as IP address, user product interactions, diagnostic information and device/account identifiers including the advertising ID when enabled.

Also account for Cardpick's own account, search, watchlist, alert and any future crash/notification data. Re-audit after every SDK upgrade.

## Do not publish assetlinks.json yet

The current APK package name may change before first submission, and Play App Signing can introduce the certificate fingerprint users actually receive. Publishing an asset link now with a provisional package/fingerprint can create broken verification and false confidence.
