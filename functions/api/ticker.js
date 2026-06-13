// 홈 시세 ticker — CARDPICK_DATA_MODEL.md 매핑 표 준수
// - 기준가(latest_krw): TCGCSV (card_price_summary_best)
// - 7일/30일 변동률: Cardmarket (card_movement_cardmarket) — 모든 탭 공통 merge
// - 7일 흐름 sparkline: TCGCSV prices 30일

export async function onRequest(context) {
  const SUPA = 'https://aqxrmdratnkffvivguqs.supabase.co';
  const KEY = 'sb_publishable_AeDBjfn3ymozGyw06ohMUw_S6n1-qpj';
  const edgeCache = caches.default;
  const reqUrl = new URL(context.request.url);
  const cacheKey = new Request('https://cardpick.kr/api/ticker' + reqUrl.search, { method: 'GET' });
  try {
    const tab = reqUrl.searchParams.get('tab') || 'all';
    // ★ 엣지 캐시 조회 (watch 탭 제외 — 사용자별)
    if (tab !== 'watch') {
      const hit = await edgeCache.match(cacheKey);
      if (hit) return hit;
    }

    // 1) 탭별 후보 카드 selection
    let candidateSlugs = [];
    if (tab === 'up' || tab === 'down') {
      // Cardmarket 변동률 기반 — ★ ₩3000 미만 저가 노이즈 차단
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
      // 관심: 사용자 watchlist (slugs 클라이언트가 ?slugs= 로 전달)
      const slugsParam = new URL(context.request.url).searchParams.get('slugs') || '';
      candidateSlugs = slugsParam.split(',').map(s => s.trim()).filter(Boolean).slice(0, 60);
      if (!candidateSlugs.length) return json({ cards: [], tab, message: 'login_required' });
    } else {
      // 전체/고가: TCGplayer Trust(★매일 갱신) 기반 — Cardmarket(주2회)에서 분리
      // '전체'는 KST 날짜 시드로 매일 로테이션, '고가'는 가격 desc 고정.
      // 데이터 조작 아님: 실제 가격, 어떤 주요 카드를 상단에 띄울지 순서만 매일 회전.
      const poolRes = await fetch(
        `${SUPA}/rest/v1/card_price_trust?trust_level=eq.HIGH&display_krw=gte.10000&order=display_krw.desc.nullslast&limit=200`,
        { headers: { apikey: KEY } }
      );
      let pool = poolRes.ok ? (await poolRes.json()).map(r => r.card_slug) : [];
      // 풀 부족 시 기준 완화 (MEDIUM/LOW + ₩5000)
      if (pool.length < 80) {
        const fbRes = await fetch(
          `${SUPA}/rest/v1/card_price_trust?trust_level=in.(HIGH,MEDIUM,LOW)&display_krw=gte.5000&order=display_krw.desc.nullslast&limit=200`,
          { headers: { apikey: KEY } }
        );
        if (fbRes.ok) { for (const r of await fbRes.json()) if (!pool.includes(r.card_slug)) pool.push(r.card_slug); }
      }
      if (tab === 'high') {
        candidateSlugs = pool.slice(0, 80);   // 고가 카드: 가격 desc 고정
      } else {
        // 전체: KST 날짜 시드 결정론적 셔플 → 매일 다른 주요 카드 (mulberry32)
        const kst = new Date(Date.now() + 9 * 3600 * 1000);
        const dayKey = kst.getUTCFullYear() * 1000 +
          Math.floor((kst - new Date(Date.UTC(kst.getUTCFullYear(), 0, 0))) / 86400000);
        let seed = (Math.imul(dayKey, 2654435761)) >>> 0;
        const rand = () => {
          seed = (seed + 0x6D2B79F5) >>> 0;
          let t = seed;
          t = Math.imul(t ^ (t >>> 15), t | 1);
          t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
          return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
        };
        for (let i = pool.length - 1; i > 0; i--) {
          const j = Math.floor(rand() * (i + 1));
          const tmp = pool[i]; pool[i] = pool[j]; pool[j] = tmp;
        }
        candidateSlugs = pool.slice(0, 80);
      }
    }
    if (!candidateSlugs.length) return json({ cards: [], tab });

    const slugList = candidateSlugs.map(s => `"${s.replace(/"/g, '\\"')}"`).join(',');

    // 2~4) 카드 메타 + summary + cardmarket + movement + trust 를 한 번에 병렬 fetch
    // ★ 성능(2026-06-13): 5개 쿼리가 전부 slugList에만 의존하는 독립 쿼리 → 직렬 await(5×RTT) 대신
    //   Promise.all로 묶어 1×RTT depth로. cold 응답 0.9s→~0.3s. 조립 로직은 아래 동일.
    const H = { headers: { apikey: KEY } };
    const [cRes, sumRes2, cmRes, mvRes2, tRes] = await Promise.all([
      fetch(`${SUPA}/rest/v1/cards?select=slug,name,name_ko,game,set_code,set_name,number,rarity_class&game=eq.pokemon&slug=in.(${slugList})`, H),
      fetch(`${SUPA}/rest/v1/card_price_summary_best?card_slug=in.(${slugList})`, H),
      fetch(`${SUPA}/rest/v1/price_metrics_external?card_slug=in.(${slugList})&source=eq.pokemontcg-cardmarket&select=card_slug,ext_avg_24h,ext_avg_7d,ext_avg_14d,ext_avg_30d`, H),
      fetch(`${SUPA}/rest/v1/card_movement_cardmarket?card_slug=in.(${slugList})`, H),
      fetch(`${SUPA}/rest/v1/card_price_trust?card_slug=in.(${slugList})&select=card_slug,trust_level,display_krw`, H),
    ]);

    // 2) 카드 메타 (게임 필터 강제 — RLS 우회 방어)
    if (!cRes.ok) return json({ error: `cards ${cRes.status}` }, 500);
    const cards = await cRes.json();
    const cardBySlug = {};
    for (const c of cards) cardBySlug[c.slug] = c;

    // 3) TCGCSV summary (기준가 + median + samples) — 모든 카드
    const sums = sumRes2.ok ? await sumRes2.json() : [];
    const sumBySlug = {};
    for (const s of sums) sumBySlug[s.card_slug] = s;

    // 4) Cardmarket sparkline 4-point (SSOT §3.6: avg30→avg14→avg7→avg24h 진짜 변동)
    const cmRows = cmRes.ok ? await cmRes.json() : [];
    const cmBySlug = {};
    for (const m of cmRows) cmBySlug[m.card_slug] = m;

    // movement view (change_7d_vs_30d_pct, latest_krw 등 컬럼)
    const mvs2 = mvRes2.ok ? await mvRes2.json() : [];
    const mvBySlug = {};
    for (const m of mvs2) mvBySlug[m.card_slug] = m;

    // ★ Trust Gate (2026-05-27: outlier 차단)
    const trustsTicker = tRes.ok ? await tRes.json() : [];
    const trustBySlugT = {};
    for (const t of trustsTicker) trustBySlugT[t.card_slug] = t;

    // 5) 결과 조립 — candidateSlugs 순서 보존 + 중복 카드 dedupe
    const out = [];
    const seenKey = new Set();  // ★ (name + number_normalized) 중복 차단
    for (const slug of candidateSlugs) {
      const c = cardBySlug[slug];
      if (!c) continue;  // 포켓몬 아니거나 RLS 차단
      const s = sumBySlug[slug];
      if (!s || !s.latest_krw) continue;
      // ★ Trust Gate (2026-05-27): NONE 카드 제외 - outlier 차단
      const tr = trustBySlugT[slug];
      if (!tr || tr.trust_level === 'NONE' || !tr.display_krw) continue;
      // ★ 저가 노이즈 차단 (₩3000 미만 카드는 hot/up/down에서 제외)
      if (Number(s.latest_krw) < 3000) continue;
      // ★ 중복 카드 제거 — 'mew-ex-232' vs 'mew-ex---232091' 같은 slug 충돌 차단
      const numNorm = String(c.number || '').split('/')[0].trim().replace(/^0+/, '');
      const dupKey = (c.name || '').toLowerCase().trim() + '|' + numNorm;
      if (seenKey.has(dupKey)) continue;
      seenKey.add(dupKey);
      const cm = cmBySlug[slug] || {};
      const mv = mvBySlug[slug] || {};

      // 변동률: Cardmarket avg7 vs avg30 (EU 시장 자체 데이터, prices 표본과 무관)
      // 카드 상세도 같은 출처 사용 → 홈/상세 100% 일치
      // ★ 변동률 게이트 (§5 도메인 룰): ±60% 초과는 stale/thin 데이터발 비현실 변동 → 표시 안 함(null)
      const REALISTIC = 60;
      const gate = (v) => (v == null || !isFinite(v) || Math.abs(v) > REALISTIC) ? null : v;
      const d7 = gate(mv.change_7d_vs_30d_pct != null ? Number(mv.change_7d_vs_30d_pct) : null);
      // d1: Cardmarket avg24h vs avg7 (단기 변동)
      const d1 = gate((cm.ext_avg_24h != null && cm.ext_avg_7d != null && Number(cm.ext_avg_7d) > 0)
        ? Math.round(((Number(cm.ext_avg_24h) - Number(cm.ext_avg_7d)) / Number(cm.ext_avg_7d)) * 100 * 100) / 100
        : null);
      // d30: Cardmarket이 90일 평균 데이터 없음 → 30일 변동률 산출 불가 → NULL (정직)
      const d30 = null;

      // 환율: TCGCSV USD/KRW × EUR/USD 1.08
      const usdToKrw = (s.latest_usd && s.latest_krw && Number(s.latest_usd) > 0)
        ? Number(s.latest_krw) / Number(s.latest_usd) : 1381;
      const eurToKrw = usdToKrw * 1.08;

      // sparkline: Cardmarket 4-포인트 KRW 환산 (홈/상세 단위 통일)
      const sparkPoints = [];
      if (cm.ext_avg_30d != null) sparkPoints.push(Math.round(Number(cm.ext_avg_30d) * eurToKrw));
      if (cm.ext_avg_14d != null) sparkPoints.push(Math.round(Number(cm.ext_avg_14d) * eurToKrw));
      if (cm.ext_avg_7d  != null) sparkPoints.push(Math.round(Number(cm.ext_avg_7d)  * eurToKrw));
      if (cm.ext_avg_24h != null) sparkPoints.push(Math.round(Number(cm.ext_avg_24h) * eurToKrw));

      // ★ 2026-05-28: 가격 출처 통일 — Trust display_krw (TCGplayer 북미) 우선
      // 이유: 홈 SSR / 상세 페이지가 모두 latest_krw 기반 → 메인 ticker만 Cardmarket 사용 시 가격 불일치 사고
      // 본문·메타가 모두 "TCGplayer 북미 기준" 명시이므로 ticker도 TCGplayer로 통일
      // Cardmarket avg는 변동률(d1, d7) 보조 데이터 + sparkline 용도로만 사용
      const krwDisplay = Math.round(Number(tr.display_krw));
      const krwSource = 'tcgplayer';
      // ★ 최종 표시 가격 게이트 — Cardmarket 환산이 ₩3000 미만이면 hot 노출 안 함
      // (₩60 ₩179 ₩74 같은 저가 카드가 변동률 크다고 끼는 사고 영구 차단)
      if (krwDisplay < 3000) continue;

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

    // watch 탭은 사용자별(slugs) → 캐시 금지. all(매일 로테이션)/up/down/high → CDN 1시간 캐시
    // ★ 성능(2026-06-13): 가격은 새벽 5시 KST 1회 갱신이라 10분 캐시는 과도하게 짧아 cold 빈발 → 3600초로.
    //   stale-while-revalidate=600 으로 만료 후에도 즉시 응답 + 백그라운드 갱신.
    const cache = (tab === 'watch') ? null : 'public, s-maxage=3600, stale-while-revalidate=600';
    const resp = json({ cards: out, tab }, 200, cache);
    if (cache) context.waitUntil(edgeCache.put(cacheKey, resp.clone()));
    return resp;
  } catch (e) {
    return json({ error: e.message || String(e) }, 500);
  }
}

function json(body, status = 200, cache = null) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': cache || 'no-store, max-age=0',
      'Access-Control-Allow-Origin': '*'
    }
  });
}
