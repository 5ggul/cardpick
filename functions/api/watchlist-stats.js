// /api/watchlist-stats — 관심 카드 합산 통계
//   - GET ?slugs=slug1,slug2,...
//   - 가격 있는 카드만 합산 (Trust HIGH/MEDIUM/LOW)
//   - 가격 없는 카드(NONE)는 0원 처리 X → unpriced_count로 분리 표시
//   - stale_count: 7일 이상 prices 갱신 안 된 카드
//
// 응답 예시:
// {
//   total_price_krw: 1234567,
//   priced_count: 5,
//   unpriced_count: 2,
//   coverage_percent: 71,
//   stale_count: 0,
//   last_updated: "2026-05-28T23:45:18Z",
//   cards: [
//     { slug, name, name_ko, set_name, number, price_krw, trust_level, last_updated, is_stale }
//   ]
// }
export async function onRequest(context) {
  const SUPA = 'https://aqxrmdratnkffvivguqs.supabase.co';
  const KEY  = 'sb_publishable_AeDBjfn3ymozGyw06ohMUw_S6n1-qpj';

  function json(body, status = 200) {
    return new Response(JSON.stringify(body), {
      status,
      headers: {
        'Content-Type': 'application/json; charset=utf-8',
        'Cache-Control': 'no-store, max-age=0',
        'Access-Control-Allow-Origin': '*'
      }
    });
  }

  try {
    const url = new URL(context.request.url);
    const slugsParam = url.searchParams.get('slugs') || '';
    const slugs = slugsParam.split(',').map(s => s.trim()).filter(Boolean).slice(0, 200);

    if (!slugs.length) {
      return json({
        total_price_krw: 0,
        priced_count: 0,
        unpriced_count: 0,
        coverage_percent: 0,
        stale_count: 0,
        last_updated: null,
        cards: []
      });
    }

    const slugList = slugs.map(s => `"${s.replace(/"/g, '\\"')}"`).join(',');

    // 카드 메타 (이름·세트·번호)
    const cardRes = await fetch(
      `${SUPA}/rest/v1/cards?select=slug,name,name_ko,set_name,number,rarity_class&game=eq.pokemon&slug=in.(${slugList})`,
      { headers: { apikey: KEY } }
    );
    const cardRows = cardRes.ok ? await cardRes.json() : [];
    const cardBy = {};
    for (const c of cardRows) cardBy[c.slug] = c;

    // Trust MV (가격·신뢰도)
    const trustRes = await fetch(
      `${SUPA}/rest/v1/card_price_trust?select=card_slug,trust_level,display_krw&card_slug=in.(${slugList})`,
      { headers: { apikey: KEY } }
    );
    const trustRows = trustRes.ok ? await trustRes.json() : [];
    const trustBy = {};
    for (const t of trustRows) trustBy[t.card_slug] = t;

    // 가격 fresh 여부 (last_fetched_at)
    const sumRes = await fetch(
      `${SUPA}/rest/v1/card_price_summary_best?select=card_slug,last_fetched_at&card_slug=in.(${slugList})`,
      { headers: { apikey: KEY } }
    );
    const sumRows = sumRes.ok ? await sumRes.json() : [];
    const sumBy = {};
    for (const s of sumRows) {
      const prev = sumBy[s.card_slug];
      const t = new Date(s.last_fetched_at).getTime();
      if (!prev || t > prev) sumBy[s.card_slug] = t;
    }

    const STALE_DAYS = 7;
    const STALE_MS = STALE_DAYS * 86400 * 1000;
    const now = Date.now();

    let total = 0;
    let priced = 0;
    let unpriced = 0;
    let stale = 0;
    let latestFetched = 0;

    const cards = slugs.map(slug => {
      const c = cardBy[slug];
      const tr = trustBy[slug];
      const lastMs = sumBy[slug] || 0;
      const hasPrice = !!(tr && tr.display_krw && tr.trust_level !== 'NONE');
      const isStale = hasPrice && lastMs && (now - lastMs > STALE_MS);

      if (hasPrice) {
        priced++;
        total += Number(tr.display_krw) || 0;
        if (isStale) stale++;
      } else {
        unpriced++;
      }
      if (lastMs > latestFetched) latestFetched = lastMs;

      return {
        slug,
        name: c?.name || null,
        name_ko: c?.name_ko || null,
        set_name: c?.set_name || null,
        number: c?.number || null,
        rarity_class: c?.rarity_class || null,
        price_krw: hasPrice ? Math.round(Number(tr.display_krw)) : null,
        trust_level: tr?.trust_level || 'NONE',
        last_updated: lastMs ? new Date(lastMs).toISOString() : null,
        is_stale: isStale
      };
    });

    const totalCount = slugs.length;
    const coverage = totalCount > 0 ? Math.round((priced / totalCount) * 100) : 0;

    return json({
      total_price_krw: Math.round(total),
      priced_count: priced,
      unpriced_count: unpriced,
      coverage_percent: coverage,
      stale_count: stale,
      stale_threshold_days: STALE_DAYS,
      last_updated: latestFetched ? new Date(latestFetched).toISOString() : null,
      cards
    });
  } catch (e) {
    return json({ error: e.message || String(e) }, 500);
  }
}
