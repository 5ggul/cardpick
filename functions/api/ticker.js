// 홈 시세 ticker — CARDPICK_DATA_MODEL.md 매핑 표 준수
// - 기준가(latest_krw): TCGCSV (card_price_summary_best)
// - 7일/30일 변동률: Cardmarket (card_movement_cardmarket) — 모든 탭 공통 merge
// - 7일 흐름 sparkline: TCGCSV prices 30일

export async function onRequest(context) {
  const SUPA = 'https://aqxrmdratnkffvivguqs.supabase.co';
  const KEY = 'sb_publishable_AeDBjfn3ymozGyw06ohMUw_S6n1-qpj';
  try {
    const tab = new URL(context.request.url).searchParams.get('tab') || 'all';

    // 1) 탭별 후보 카드 selection
    let candidateSlugs = [];
    if (tab === 'up' || tab === 'down') {
      // Cardmarket 변동률 기반 — ★ 저가 노이즈 차단 위해 latest_krw 게이트 추가
      const op = tab === 'up' ? 'gt' : 'lt';
      const sign = tab === 'up' ? '5' : '-5';  // 5% 이상 변동
      const order = tab === 'up' ? 'desc' : 'asc';
      const mvRes = await fetch(
        `${SUPA}/rest/v1/card_movement_cardmarket?change_7d_vs_30d_pct=${op}.${sign}&latest_krw=gte.3000&order=change_7d_vs_30d_pct.${order}&limit=80`,
        { headers: { apikey: KEY } }
      );
      if (mvRes.ok) {
        const rows = await mvRes.json();
        candidateSlugs = rows.map(r => r.card_slug);
      }
    } else if (tab === 'watch') {
      // 관심: 사용자 watchlist
      const slugsParam = new URL(context.request.url).searchParams.get('slugs') || '';
      candidateSlugs = slugsParam.split(',').map(s => s.trim()).filter(Boolean).slice(0, 60);
      if (!candidateSlugs.length) return json({ cards: [], tab, message: 'login_required' });
    } else if (tab === 'new') {
      // 신규 업데이트: 최근 prices 갱신 카드 (last_fetched_at desc)
      const newRes = await fetch(
        `${SUPA}/rest/v1/card_price_summary_best?latest_krw=gte.10000&order=last_fetched_at.desc.nullslast&limit=50`,
        { headers: { apikey: KEY } }
      );
      if (newRes.ok) {
        const rows = await newRes.json();
        candidateSlugs = rows.map(r => r.card_slug);
      }
    } else if (tab === 'high') {
      // 고가 카드: latest_krw desc (TCGCSV 기준)
      const hiRes = await fetch(
        `${SUPA}/rest/v1/card_price_summary_best?order=latest_krw.desc.nullslast&limit=50`,
        { headers: { apikey: KEY } }
      );
      if (hiRes.ok) {
        const rows = await hiRes.json();
        candidateSlugs = rows.map(r => r.card_slug);
      }
    } else {
      // 전체 (기본): Cardmarket 보유 + 기준가 desc, fallback TCGCSV 고가
      const cmFirst = await fetch(
        `${SUPA}/rest/v1/card_movement_cardmarket?order=latest_krw.desc.nullslast&limit=60`,
        { headers: { apikey: KEY } }
      );
      if (cmFirst.ok) {
        const rows = await cmFirst.json();
        candidateSlugs = rows.map(r => r.card_slug);
      }
      if (candidateSlugs.length < 50) {
        const sumRes = await fetch(
          `${SUPA}/rest/v1/card_price_summary_best?latest_krw=gte.3000&order=latest_krw.desc&limit=80`,
          { headers: { apikey: KEY } }
        );
        if (sumRes.ok) {
          const rows = await sumRes.json();
          for (const r of rows) {
            if (!candidateSlugs.includes(r.card_slug)) candidateSlugs.push(r.card_slug);
            if (candidateSlugs.length >= 80) break;
          }
        }
      }
    }
    if (!candidateSlugs.length) return json({ cards: [], tab });

    const slugList = candidateSlugs.map(s => `"${s.replace(/"/g, '\\"')}"`).join(',');

    // 2) 카드 메타 (게임 필터 강제 — RLS 우회 방어)
    const cRes = await fetch(
      `${SUPA}/rest/v1/cards?select=slug,name,name_ko,game,set_code,set_name,number,rarity_class&game=eq.pokemon&slug=in.(${slugList})`,
      { headers: { apikey: KEY } }
    );
    if (!cRes.ok) return json({ error: `cards ${cRes.status}` }, 500);
    const cards = await cRes.json();
    const cardBySlug = {};
    for (const c of cards) cardBySlug[c.slug] = c;

    // 3) TCGCSV summary (기준가 + median + samples) — 모든 카드
    const sumRes2 = await fetch(
      `${SUPA}/rest/v1/card_price_summary_best?card_slug=in.(${slugList})`,
      { headers: { apikey: KEY } }
    );
    const sums = sumRes2.ok ? await sumRes2.json() : [];
    const sumBySlug = {};
    for (const s of sums) sumBySlug[s.card_slug] = s;

    // 4) Cardmarket movement (변동률 + sparkline 4-point 진짜 데이터)
    //    SSOT §3.6: sparkline은 Cardmarket avg30→avg14→avg7→avg24h 4-포인트 (진짜 변동)
    const cmRes = await fetch(
      `${SUPA}/rest/v1/price_metrics_external?card_slug=in.(${slugList})&source=eq.pokemontcg-cardmarket&select=card_slug,ext_avg_24h,ext_avg_7d,ext_avg_14d,ext_avg_30d`,
      { headers: { apikey: KEY } }
    );
    const cmRows = cmRes.ok ? await cmRes.json() : [];
    const cmBySlug = {};
    for (const m of cmRows) cmBySlug[m.card_slug] = m;

    // movement view (change_7d_vs_30d_pct, latest_krw 등 컬럼용 추가 fetch)
    const mvRes2 = await fetch(
      `${SUPA}/rest/v1/card_movement_cardmarket?card_slug=in.(${slugList})`,
      { headers: { apikey: KEY } }
    );
    const mvs2 = mvRes2.ok ? await mvRes2.json() : [];
    const mvBySlug = {};
    for (const m of mvs2) mvBySlug[m.card_slug] = m;

    // 5) 결과 조립 — candidateSlugs 순서 보존
    const out = [];
    for (const slug of candidateSlugs) {
      const c = cardBySlug[slug];
      if (!c) continue;  // 포켓몬 아니거나 RLS 차단
      const s = sumBySlug[slug];
      if (!s || !s.latest_krw) continue;
      // ★ 저가 노이즈 차단 (₩3000 미만 카드는 변동률 크더라도 hot/up/down에서 제외)
      // 사고: ₩60, ₩179, ₩74 같은 카드가 상승 TOP에 끼는 문제
      if (Number(s.latest_krw) < 3000) continue;
      const cm = cmBySlug[slug] || {};
      const mv = mvBySlug[slug] || {};

      // 변동률 (Cardmarket avg 비교 — 시세 추이 시각화용 보조 데이터)
      // 메인 가격은 TCGplayer지만 7일 변화/sparkline은 EU Cardmarket 평균 변동률로 보완
      const d7 = mv.change_7d_vs_30d_pct != null ? Number(mv.change_7d_vs_30d_pct) : null;
      const d1 = (cm.ext_avg_24h != null && cm.ext_avg_7d != null && Number(cm.ext_avg_7d) > 0)
        ? Math.round(((Number(cm.ext_avg_24h) - Number(cm.ext_avg_7d)) / Number(cm.ext_avg_7d)) * 100 * 100) / 100
        : null;
      const d30 = null;

      // 환율: TCGCSV USD/KRW × EUR/USD 1.08
      const usdToKrw = (s.latest_usd && s.latest_krw && Number(s.latest_usd) > 0)
        ? Number(s.latest_krw) / Number(s.latest_usd) : 1381;
      const eurToKrw = usdToKrw * 1.08;

      // sparkline: Cardmarket 4-포인트 KRW 환산 (참고용 — Cardmarket stale 가능)
      const sparkPoints = [];
      if (cm.ext_avg_30d != null) sparkPoints.push(Math.round(Number(cm.ext_avg_30d) * eurToKrw));
      if (cm.ext_avg_14d != null) sparkPoints.push(Math.round(Number(cm.ext_avg_14d) * eurToKrw));
      if (cm.ext_avg_7d  != null) sparkPoints.push(Math.round(Number(cm.ext_avg_7d)  * eurToKrw));
      if (cm.ext_avg_24h != null) sparkPoints.push(Math.round(Number(cm.ext_avg_24h) * eurToKrw));

      // 카드 상단 가격: TCGplayer latest_krw (어제 갱신) — 카드 상세 Hero와 일치
      // Cardmarket은 stale (2025-11)이라 메인 가격으로 부적합
      const krwDisplay = Number(s.latest_krw);
      const krwSource = 'tcgplayer';

      out.push({
        slug: c.slug,
        name: c.name,
        name_ko: c.name_ko || '',
        game: c.game,
        set_code: (c.set_code || '').toUpperCase(),
        set_name: c.set_name || '',
        number: c.number || '',
        rarity: c.rarity_class || '',
        krw: krwDisplay,
        krw_source: krwSource,
        krw_tcgplayer: Number(s.latest_krw),
        variant: s.variant,
        // 최근 업데이트 — MV의 last_fetched_at (TCGCSV 갱신 시각)
        fetched_at: s.last_fetched_at || null,
        d1: d1,
        d7: d7,
        d14: null,  // Cardmarket에 14일 직접 메트릭 없음
        d30: d30,
        median_7d:  s.median_7d  != null ? Number(s.median_7d)  : null,
        median_14d: s.median_14d != null ? Number(s.median_14d) : null,
        median_30d: s.median_30d != null ? Number(s.median_30d) : null,
        samples_7d:  s.samples_7d  || 0,
        samples_14d: s.samples_14d || 0,
        samples_30d: s.samples_30d || 0,
        chg: d7,  // 대표 변동률
        spark: sparkPoints,  // Cardmarket 4-포인트 (30→14→7→24h)
        spark_source: sparkPoints.length >= 2 ? 'cardmarket_4pt' : null,
        change_source: d7 != null ? 'cardmarket' : null
      });
      if (out.length >= 50) break;
    }

    return json({ cards: out, tab });
  } catch (e) {
    return json({ error: e.message || String(e) }, 500);
  }
}

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
