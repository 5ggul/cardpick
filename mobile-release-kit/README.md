# CARDPICK Android release patch kit

This directory is a staging kit for the original Flutter project built from `X:/cardpick_app`.

Do **not** treat these files as a reconstructed Flutter app. The current APK is AOT-compiled and is not an authoritative source tree. Apply this kit to the original project only.

## Facts recovered from the current APK

- package: `kr.cardpick.cardpick_app`
- app version name string observed: `1.0.0`
- Flutter package name: `cardpick_app`
- original build path embedded in AOT: `X:/cardpick_app`
- native app routes include `/home`, `/search`, `/market`, `/watchlist`, `/tools`, `/card/:slug`
- website card URL shape: `https://cardpick.kr/cards/<slug>`
- Google Mobile Ads Android SDK: `25.4.0`
- Google UMP Android SDK: `4.0.0`
- current AdMob app ID: official Google **test** app ID
- current banner unit: official Google **test** banner ID
- Supabase endpoint/public publishable key are packaged in the client
- no Firebase Messaging classes / `POST_NOTIFICATIONS` permission observed
- no verified `cardpick.kr` Android App Link observed
- watchlist currently uses `SharedPreferences` (`cp.watchlist.v1`)

## First-release decisions

1. Final Android application ID: use `kr.cardpick.app` **before the first Play listing is created**, unless the owner decides to preserve the current ID.
2. Keep Firebase/FCM out of the first submission unless price notifications are truly ready. It adds permission/data-safety/review surface and is not required for v1 approval.
3. Add verified App Links for `https://cardpick.kr/cards/*` and route them to the existing native `/card/:slug` screen.
4. Use test AdMob IDs in debug. Release builds must fail if production AdMob IDs are missing.
5. Run UMP before requesting ads where consent is required. Settings must expose a privacy-options entry when required.
6. Build an AAB and use Play App Signing.

## Apply order once `X:/cardpick_app` is reachable

1. Copy the original project to a private Git repository.
2. Commit the untouched source as a baseline.
3. Run `flutter doctor -v`, `flutter pub get`, `flutter analyze`, and tests before modifications.
4. Rename the Android application ID if the Play app has not yet been created.
5. Apply AdMob release separation and UMP wiring.
6. Add App Link manifest entry and GoRouter alias.
7. Add in-app privacy/terms/ad-options links.
8. Build release AAB with real production IDs supplied as secrets/Gradle properties.
9. Inspect the final AAB/APK again for test IDs, secrets, permissions and signing.
10. Only then create/submit the Play release.

## Files in this kit

- `lib/core/ad_config.dart`: debug/release ad-unit guard
- `lib/core/privacy_consent.dart`: UMP bootstrap and privacy-options helper
- `lib/router_deeplink_patch.dart`: mapping from web `/cards/:slug` to native `/card/:slug`
- `android/AndroidManifest.deep-links.xml`: manifest fragment
- `android/build.gradle.kts.admob-snippet.txt`: Kotlin DSL release app-ID guard
- `android/build.gradle.admob-snippet.txt`: Groovy equivalent
- `RELEASE_COMMANDS.md`: release and verification commands

Real AdMob IDs, upload-key passwords, service-role keys and other secrets must never be committed to this public repository.