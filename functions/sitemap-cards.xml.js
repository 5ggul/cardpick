// /sitemap-cards.xml — 최상급 품질 카드만 노출 (사이트 평판 회복 모드, 2026-08-30 개편)
//
// 배경: 2026-06-12 이후 GSC 색인 지속 하락 (~12장 → 8장). Google이 사이트 전체를
// thin content 로 판정하고 능동적으로 de-index 중. 이전 게이트(HIGH+MEDIUM + name_ko/₩5,000)
// 로 580장 노출했으나 대부분이 얇은 신호. 이 상태에서 sitemap 확대 = 자숙 심화.
//
// 새 정책 (평판 회복 우선):
// - HIGH trust만 (MEDIUM 도 제외 — 신뢰도 최상만)
// - display_krw ≥ ₩20,000 (실제 가치 있는 카드)
// - name_ko 있는 것 우선 (한국어 검색 대응 + 편집 가치)
// - Ramp 로직 제거 (품질 조건이 이미 강력한 필터)
// - 예상 노출: 100~200장 (기존 580 → 대폭 축소, 신호 밀도 상승)
//
// 목적: Google 크롤 예산을 최상급 페이지에 집중 → "이 사이트에는 진짜 가치 있는 카드가
// 이만큼 있다" 명확한 신호. 나머지 카드 상세 페이지는 여전히 접근 가능 (robots index)
// 하되 sitemap 에서 배제해 크롤 우선순위 낮춤.
export async function onRequest() {
  const SUPA = 'https://aqxrmdratnkffvivguqs.supabase.co';
  const KEY = 'sb_publishable_AeDBjfn3ymozGyw06ohMUw_S6n1-qpj';

  // HIGH trust + 가치 있는 카드만. 가격 높은 순. 최대 300 (안전 상한).
  let rows = [];
  try {
    const r = await fetch(
      `${SUPA}/rest/v1/card_price_trust?select=card_slug,computed_at,display_krw,trust_level&trust_level=eq.HIGH&display_krw=gte.20000&order=display_krw.desc&limit=300`,
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
        // ★ P0-F: name_ko 추가 SELECT — sitemap 게이트에서 name_ko 여부 확인용
        const r = await fetch(
          `${SUPA}/rest/v1/cards?select=slug,set_id,name,name_ko,number&game=eq.pokemon&slug=in.(${slugs})`,
          { headers: { apikey: KEY } }
        );
        if (r.ok) (await r.json()).forEach(c => meta.set(c.slug, c));
      } catch (e) { /* graceful */ }
    }
  }

  // ★ slug 중복 dedup: 같은 카드가 clean slug + ugly('--'/'---') slug 2개로 중복 적재됨.
  //   ex) caterpie-10 (num="10") + caterpie---010165-010165 (num="010/165") = 같은 MEW 10번 카드.
  //   ex) mimikyu-160 + mimikyu--160091-160091 (2026-08-27 진단으로 발견, dash 2개 형태)
  //   이름 + normalized 인쇄번호(leading zero 제거)로 같은 카드 식별.
  //   같은 카드일 때만 clean 우선·ugly 제외. 단일 slug 카드는 보존.
  //   ★ 2026-08-18: 이전 로직은 "010" != "10" 정규화 안 돼서 dedup 실패했음.
  //     display_krw 도 두 slug 간 미묘하게 달라 key 불일치 → 제거.
  //   ★ 2026-08-27: dash 2개(name--NNNNNN-NNNNNN) malformed 추가 검출.
  const norm = s => String(s || '').toLowerCase().replace(/[^a-z0-9가-힣]/g, '');
  const printedNum = n => (String(n || '').split('/')[0].trim().replace(/^0+/, '') || '0');
  // 정상 slug 는 연속된 dash 없음 (slugify collapse). '--' 이상 = malformed.
  const isClean = s => !/-{2,}/.test(s);
  const keyOf = (m, slug) => (m && m.name)
    ? `${norm(m.name)}|${printedNum(m.number)}`
    : `__solo__|${slug}`;  // 메타 없으면 dedup 안 함(보존)

  const best = new Map();  // key -> 대표 slug
  for (const r of rows) {
    const slug = r.card_slug;
    if (!meta.has(slug)) continue;  // pokemon 아님
    const k = keyOf(meta.get(slug), slug);
    if (!best.has(k)) best.set(k, slug);
    else if (!isClean(best.get(k)) && isClean(slug)) best.set(k, slug);  // ugly→clean 교체
  }
  const chosen = new Set(best.values());
  // 평판 회복 모드 (2026-08-30): 이미 상단 SQL 필터 (HIGH + ₩20,000+) 로 강한 gate.
  // 여기서는 dedup + name_ko 우선 정렬 정도만. name_ko 있는 카드 우선 노출.
  const cards = rows.filter(r => meta.has(r.card_slug) && chosen.has(r.card_slug));
  cards.sort((a, b) => {
    const ma = meta.get(a.card_slug), mb = meta.get(b.card_slug);
    const kA = !!(ma?.name_ko && String(ma.name_ko).trim());
    const kB = !!(mb?.name_ko && String(mb.name_ko).trim());
    if (kA !== kB) return kA ? -1 : 1;   // 한국어명 있는 카드 우선
    return Number(b.display_krw || 0) - Number(a.display_krw || 0); // 그다음 가격 순
  });

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
