import 'package:google_mobile_ads/google_mobile_ads.dart';

/// Google UMP bootstrap for the existing google_mobile_ads dependency.
///
/// Call [requestConsent] before loading ads. The app can still render its
/// content if consent lookup/form loading fails; ad loading policy should be
/// decided from `canRequestAds()` after this method returns.
abstract final class PrivacyConsent {
  static Future<void> requestConsent() async {
    final completer = _OnceCompleter();
    final params = ConsentRequestParameters();

    ConsentInformation.instance.requestConsentInfoUpdate(
      params,
      () async {
        ConsentForm.loadAndShowConsentFormIfRequired((formError) async {
          // Do not block the app UI on a form/network error. Log only a
          // non-sensitive error message in debug builds if desired.
          completer.complete();
        });
      },
      (formError) {
        completer.complete();
      },
    );

    await completer.future;
  }

  static Future<bool> canRequestAds() {
    return ConsentInformation.instance.canRequestAds();
  }

  static Future<bool> privacyOptionsRequired() async {
    final status = await ConsentInformation.instance
        .getPrivacyOptionsRequirementStatus();
    return status == PrivacyOptionsRequirementStatus.required;
  }

  static Future<void> showPrivacyOptions() async {
    final completer = _OnceCompleter();
    ConsentForm.showPrivacyOptionsForm((formError) {
      completer.complete();
    });
    await completer.future;
  }
}

/// Tiny dependency-free completer wrapper so this staging file is easy to
/// merge even if the original app has its own async helper layer.
final class _OnceCompleter {
  final _completer = Completer<void>();
  bool _done = false;

  Future<void> get future => _completer.future;

  void complete() {
    if (_done) return;
    _done = true;
    _completer.complete();
  }
}
