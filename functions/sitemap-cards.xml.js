// /sitemap-cards.xml — 가격 신뢰도 HIGH 카드 점진 색인 (리스크 없는 단계적 개방)
//
// 정책 (2026-06-20 단계적 개방 시작, CLAUDE.md §8.3 / §11 준수):
// - 품질 게이트: trust_level=HIGH 카드만 노출 (distinct_7d>=5 + ratio gate 통과 = 신뢰 가격).
//   HIGH 카드 페이지는 FAQ + 같은 세트 내부링크를 갖춰 thin 아님.
// - 점진 ramp: 한 번에 대량 노출(자숙/자동화 신호) 금지. 날짜 기반으로 천천히 확대.
//   첫 150장 → 주당 +120장 → 상한 1500 (약 3개월에 걸쳐). 가치(display_krw) 높은 카드 우선.
// - 새 페이지 발행이 아니라 "이미 색인 가능한(hasPrice) 기존 페이지"의 발견을 여는 것.
//   적극적 색인 요청 아님 (§2 준수) — 단순 발견 지도 확대.
export async function onRequest() {
  const SUPA = 'https://aqxrmdratnkffvivguqs.supabase.co';
  const KEY = 'sb_publishable_AeDBjfn3ymozGyw06ohMUw_S6n1-qpj';

  // 점진 ramp 한도 계산 (날짜 기반, 자동)
  const START = Date.UTC(2026, 5, 20);   // 2026-06-20 개방 시작 (월: 0-based, 5=6월)
  const BASE = 150, STEP = 120, CAP = 1500;
  const weeks = Math.max(0, Math.floor((Date.now() - START) / (7 * 86400000)));
  const limit = Math.min(CAP, BASE + weeks * STEP);

  // HIGH trust 카드, 가치(display_krw) 높은 순
  let rows = [];
  try {
    const r = await fetch(
      `${SUPA}/rest/v1/card_price_trust?select=card_slug,computed_at,display_krw&trust_level=eq.HIGH&display_krw=not.is.null&order=display_krw.desc&limit=${limit}`,
      { headers: { apikey: KEY } }
    );
    if (r.ok) rows = await r.json();
  } catch (e) { /* graceful */ }

  // pokemon 카드만 (RLS 우회 방어) + 메타(set_id·name·number) 수집 — slug 청크
  const meta = new Map();  // slug -> {set_id, name, number}
  if (rows.length) {
    const all = rows.map(r => r.card_slug);
    for (let i = 0; i < all.length; i += 200) {
      const chunk = all.slice(i, i + 200);
      const slugs = chunk.map(s => `"${s.replace(/"/g, '\\"')}"`).join(',');
      try {
        const r = await fetch(
          `${SUPA}/rest/v1/cards?select=slug,set_id,name,number&game=eq.pokemon&slug=in.(${slugs})`,
          { headers: { apikey: KEY } }
        );
        if (r.ok) (await r.json()).forEach(c => meta.set(c.slug, c));
      } catch (e) { /* graceful */ }
    }
  }

  // ★ slug 중복 dedup: 같은 카드가 clean slug + ugly('---') slug 2개로 중복 적재됨(§2-1: 한 카드가 두 set_id로).
  //   set_id는 불일치(예: pre vs sv8pt5)하지만 이름+인쇄번호+display_krw는 동일 → 이 3개로 같은 카드 식별.
  //   같은 카드일 때만 clean 우선·ugly 제외. 단일 slug 카드는 보존(데이터 신중).
  const norm = s => String(s || '').toLowerCase().replace(/[^a-z0-9가-힣]/g, '');
  const printedNum = n => String(n || '').split('/')[0].trim();
  const isClean = s => !s.includes('---');
  const keyOf = (m, slug, krw) => (m && m.name)
    ? `${norm(m.name)}|${printedNum(m.number)}|${krw}`
    : `__solo__|${slug}`;  // 메타 없으면 dedup 안 함(보존)

  const best = new Map();  // key -> 대표 slug
  for (const r of rows) {
    const slug = r.card_slug;
    if (!meta.has(slug)) continue;  // pokemon 아님
    const k = keyOf(meta.get(slug), slug, r.display_krw);
    if (!best.has(k)) best.set(k, slug);
    else if (!isClean(best.get(k)) && isClean(slug)) best.set(k, slug);  // ugly→clean 교체
  }
  const chosen = new Set(best.values());
  const cards = rows.filter(r => meta.has(r.card_slug) && chosen.has(r.card_slug));

  const urls = cards.map(c => {
    const lastmod = c.computed_at ? String(c.computed_at).slice(0, 10) : '';
    return `  <url>
    <loc>https://cardpick.kr/cards/${encodeURIComponent(c.card_slug)}</loc>${lastmod ? `
    <lastmod>${lastmod}</lastmod>` : ''}
    <changefreq>weekly</changefreq>
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
      'Cache-Control': 'public, max-age=21600',  // 6h (하루 1회 변동이면 충분)
      'X-Card-Sitemap-Limit': String(limit),
      'X-Card-Sitemap-Count': String(cards.length)
    }
  });
}
