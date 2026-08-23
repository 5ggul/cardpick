# Google Play Data safety draft for CARDPICK Android

Updated: 2026-08-23

This is a working draft, not a final legal declaration. Re-audit the **final AAB** and the exact SDK versions before submitting Play Console.

## Confirmed from current APK / current architecture

### Google Mobile Ads

Google's current Android Mobile Ads disclosure documentation states that the SDK automatically collects/shares data for advertising, analytics and fraud prevention, including:

- IP address (may estimate general location)
- user product interactions (app launch, taps, video/ad interactions)
- diagnostic information (performance-related information)
- device/account identifiers, including advertising ID / app set ID when applicable

Transport is encrypted in transit by the SDK according to Google's disclosure documentation.

### CARDPICK service data

The app/service may process:

- card search queries
- card detail/price lookup activity
- update requests
- watchlist state
- authenticated account/profile data if/when app login is enabled
- price-alert configuration if/when it is enabled

Server hardening now avoids storing a persistent search IP hash unless a private `SEARCH_LOG_PEPPER` exists. Raw IP is not written into the `card_search_logs.ip_hash` field by that flow.

## Suggested Play Console review map

Do not blindly copy these answers. Verify every final dependency and runtime path.

### Location

- Approximate location: **review as potentially collected/shared by Google Mobile Ads through IP-based estimation**.
- Precise location: currently no evidence of a GPS/location permission or app feature requiring it. Keep it out unless the final app adds location access.

### App activity

- App interactions: yes, because Mobile Ads can process interaction information and CARDPICK itself records search/service activity.
- In-app search history: CARDPICK search queries are sent to the service; disclose according to the final Play form wording and retention policy.

### App info and performance

- Diagnostics/performance: yes for Google Mobile Ads SDK behavior. Re-check if a crash-reporting SDK is added later.

### Device or other IDs

- Advertising ID / app set ID / related identifiers: yes when enabled by Google Mobile Ads. The final answer depends on the selected ad mode, consent state and manifest configuration.

### Personal info

Only mark account data that the final Android build actually collects/uses. If first release has no app login, do not copy the website's entire account schema into the app declaration. If login is enabled, review email, user ID, display name/profile fields and deletion handling.

### User content

Do not mark board posts/comments merely because the website has them if the Android app only opens the board externally. Mark user content only if the final app itself collects/transmits it.

## Security answers to verify

- Data encrypted in transit: service and ad traffic use HTTPS/TLS; verify all custom endpoints remain HTTPS only.
- User can request deletion: provide a discoverable deletion path if the final Android release includes account creation/login.
- Independent security review: do not claim unless actually completed under Google's definition.

## Ads declaration

When production AdMob is enabled:

- Play Console `Contains ads`: YES
- do not submit a production build containing Google's test AdMob IDs

## Re-review triggers

Re-run Data safety review whenever any of these change:

- Google Mobile Ads / UMP version
- Firebase/FCM added
- Crashlytics/Sentry or another diagnostics SDK added
- native Google/Supabase login added or removed
- user-generated content moves into the native app
- camera/OCR feature added
- analytics SDK added
- location permission added
- mediation/ad-network adapters added
