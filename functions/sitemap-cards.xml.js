// /sitemap-cards.xml — 가격 있는 인기 카드 SSR
// 신규 도메인 4일차: Day-1 ≤10 페이지 룰 + 자숙 회피를 위해 top 30만 등록.
// 단계별 활성화: 안정화되면 한도 점진 확대 (CLAUDE.md §2.1).
export async function onRequest() {
  const SUPA = 'https://aqxrmdratnkffvivguqs.supabase.co';
  const KEY = 'sb_publishable_AeDBjfn3ymozGyw06ohMUw_S6n1-qpj';

  // 가격 있는 카드 중 latest_krw desc top 30 (보수적)
  // 신규 도메인 4일차: samples_7d 조건 없이 latest_krw>=10000 카드만 (정직성보다 카탈로그 가치)
  let rows = [];
  try {
    const r = await fetch(
      `${SUPA}/rest/v1/card_price_summary_best?select=card_slug,last_fetched_at&latest_krw=gte.10000&order=latest_krw.desc&limit=30`,
      { headers: { apikey: KEY } }
    );
    if (r.ok) rows = await r.json();
  } catch (e) { /* graceful */ }

  // pokemon 카드만 (RLS 우회 방어)
  let cards = [];
  if (rows.length) {
    const slugs = rows.map(r => `"${r.card_slug.replace(/"/g,'\\"')}"`).join(',');
    try {
      const r = await fetch(
        `${SUPA}/rest/v1/cards?select=slug&game=eq.pokemon&slug=in.(${slugs})`,
        { headers: { apikey: KEY } }
      );
      if (r.ok) {
        const validSlugs = new Set((await r.json()).map(c => c.slug));
        cards = rows.filter(r => validSlugs.has(r.card_slug));
      }
    } catch (e) { /* graceful */ }
  }

  const urls = cards.map(c => {
    const lastmod = c.last_fetched_at ? String(c.last_fetched_at).slice(0, 10) : '';
    return `  <url>
    <loc>https://cardpick.kr/cards/${encodeURIComponent(c.card_slug)}</loc>${lastmod ? `
    <lastmod>${lastmod}</lastmod>` : ''}
    <changefreq>daily</changefreq>
    <priority>0.6</priority>
  </url>`;
  }).join('\n');

  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls}
</urlset>`;

  return new Response(xml, {
    status: 200,
    headers: {
      'Content-Type': 'application/xml; charset=utf-8',
      'Cache-Control': 'public, max-age=3600'
    }
  });
}
