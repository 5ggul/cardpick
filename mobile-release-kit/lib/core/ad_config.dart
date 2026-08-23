import 'package:flutter/foundation.dart';

/// Compile-time AdMob unit configuration.
///
/// Debug builds use Google's official test banner ID. Release builds require
/// an explicit `ADMOB_ANDROID_BANNER_ID` dart-define and reject Google's test
/// ID so a production build cannot silently ship without monetization.
abstract final class AdConfig {
  static const _googleTestBannerId = 'ca-app-pub-3940256099942544/6300978111';

  static const _releaseBannerId = String.fromEnvironment(
    'ADMOB_ANDROID_BANNER_ID',
    defaultValue: '',
  );

  static String get bannerId {
    if (kDebugMode) return _googleTestBannerId;

    if (_releaseBannerId.isEmpty) {
      throw StateError(
        'Missing ADMOB_ANDROID_BANNER_ID for release build. '
        'Pass --dart-define=ADMOB_ANDROID_BANNER_ID=ca-app-pub-...',
      );
    }
    if (_releaseBannerId == _googleTestBannerId ||
        _releaseBannerId.startsWith('ca-app-pub-3940256099942544/')) {
      throw StateError('Google test AdMob unit ID must not ship in release.');
    }
    return _releaseBannerId;
  }

  static bool get adsEnabled {
    if (kDebugMode) return true;
    return _releaseBannerId.isNotEmpty;
  }
}
