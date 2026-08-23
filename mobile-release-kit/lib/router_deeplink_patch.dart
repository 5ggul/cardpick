import 'package:go_router/go_router.dart';

/// Add this route next to the existing native `/card/:slug` route.
///
/// The public website uses `/cards/<slug>` while the current APK's native
/// detail route is `/card/:slug`. Android App Links should keep the public URL
/// canonical and redirect internally to the existing native screen.
GoRoute cardpickWebCardAliasRoute() {
  return GoRoute(
    path: '/cards/:slug',
    redirect: (context, state) {
      final slug = state.pathParameters['slug'];
      if (slug == null || slug.isEmpty) return '/search';
      return '/card/$slug';
    },
  );
}
