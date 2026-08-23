# CARDPICK Android release commands

Run these from the original Flutter project root after the release patches are merged.

## Baseline

```powershell
flutter doctor -v
flutter pub get
flutter analyze
flutter test
```

Do not continue to signing/release if the untouched baseline already fails. Record and fix baseline failures first.

## Debug verification

Debug should keep Google's official test ad IDs.

```powershell
flutter run
```

Verify:

- card search
- native card detail
- market screen
- watchlist persistence
- PSA calculator/tools
- external board launch
- UMP/privacy UI does not block app startup on network error
- `https://cardpick.kr/cards/<slug>` opens the intended native card detail after App Links are configured

## Release build

Never commit the production AdMob IDs. Supply them only in the release environment.

```powershell
$env:ADMOB_ANDROID_APP_ID = 'ca-app-pub-REPLACE_WITH_REAL_APP_ID'
flutter build appbundle --release `
  --dart-define=ADMOB_ANDROID_BANNER_ID=ca-app-pub-REPLACE_WITH_REAL_BANNER_ID
```

The Gradle guard and Dart guard in this kit are designed to fail a release build when Google's test IDs are used.

Expected artifact:

```text
build/app/outputs/bundle/release/app-release.aab
```

## Package ID migration before first Play listing

Preferred final package:

```text
kr.cardpick.app
```

Update all of the following together:

- Android `namespace`
- Android `applicationId`
- MainActivity Kotlin/Java package declaration and directory
- any provider authorities containing the old application ID
- Firebase configuration later, if Firebase is added
- Digital Asset Links `package_name`

Do this only before the first Play app is created. After publishing, the package ID is the app identity and must remain stable.

## Post-build release audit

Re-run static inspection against the final artifact and confirm:

- no `ca-app-pub-3940256099942544` test IDs
- no Supabase service-role key
- no private API tokens/passwords
- only expected permissions
- `targetSdkVersion` remains 36 or newer
- release signing is not Android Debug
- App Links host is only `cardpick.kr`
- privacy-policy URL is reachable over HTTPS
- no verbose auth/token logging

## Play Console first submission

- upload `.aab`, not the universal APK
- enable Play App Signing
- declare that the app contains ads when production ads are enabled
- complete Data safety from the **final AAB's actual SDK/runtime behavior**
- provide `https://cardpick.kr/app-privacy` as the app privacy-policy URL
- run the Play pre-launch report before production
- after Play App Signing is enabled, copy its SHA-256 app-signing certificate fingerprint and only then publish `/.well-known/assetlinks.json`

## Intentionally deferred from first review

FCM price notifications are better added after the first stable release unless they are already product-ready. They require Firebase setup, notification permission handling, device-token lifecycle, server jobs, additional data-safety review and notification UX. The existing app can pass review without them.
