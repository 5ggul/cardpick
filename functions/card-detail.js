// /card-detail?slug=X → /cards/X 301 (정식 경로 단일화)
export async function onRequest(context) {
  const url = new URL(context.request.url);
  const slug = (url.searchParams.get('slug') || '').toLowerCase().replace(/[^a-z0-9\-_]/g, '');
  if (slug) {
    return Response.redirect(`https://cardpick.kr/cards/${slug}`, 301);
  }
  // slug 없으면 홈으로
  return Response.redirect('https://cardpick.kr/', 301);
}
