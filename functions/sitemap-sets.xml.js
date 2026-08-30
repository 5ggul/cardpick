// /sitemap-sets.xml — 세트별 집계 페이지 sitemap (평판 회복 2단계)
// HIGH 카드 5장 이상 있는 세트만 노출 (품질 임계값).
export async function onRequest() {
  const SUPA = 'https://aqxrmdratnkffvivguqs.supabase.co';
  const KEY = 'sb_publishable_AeDBjfn3ymozGyw06ohMUw_S6n1-qpj';

  // HIGH+MEDIUM trust 카드 조회 → 세트별 그룹
  let rows = [];
  try {
    const r = await fetch(
      `${SUPA}/rest/v1/card_price_trust?select=card_slug,cards(set_code,set_name)&trust_level=in.(HIGH,MEDIUM)&display_krw=not.is.null&limit=2000`,
      { headers: { apikey: KEY } }
    );
    if (r.ok) rows = await r.json();
  } catch (e) { /* graceful */ }

  // 세트별 카운트
  const setCount = new Map();  // code -> {count, name}
  for (const row of rows) {
    const c = row.cards;
    if (!c || !c.set_code) continue;
    const code = c.set_code.toUpperCase().trim();
    if (!/^[A-Z0-9-]+$/.test(code)) continue;
    if (!setCount.has(code)) setCount.set(code, { count: 0, name: c.set_name || code });
    setCount.get(code).count++;
  }

  // 5장 이상 있는 세트만 sitemap 노출 (품질 게이트)
  const sets = [...setCount.entries()]
    .filter(([_, v]) => v.count >= 5)
    .sort((a, b) => b[1].count - a[1].count);

  const today = new Date().toISOString().slice(0, 10);
  const urls = sets.map(([code]) => `  <url>
    <loc>https://cardpick.kr/sets/${encodeURIComponent(code)}</loc>
    <lastmod>${today}</lastmod>
    <changefreq>weekly</changefreq>
    <priority>0.7</priority>
  </url>`).join('\n');

  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls}
</urlset>`;

  return new Response(xml, {
    status: 200,
    headers: {
      'Content-Type': 'application/xml; charset=utf-8',
      'Cache-Control': 'public, max-age=21600',
      'X-Set-Sitemap-Count': String(sets.length)
    }
  });
}
