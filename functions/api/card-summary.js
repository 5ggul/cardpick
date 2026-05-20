// 카드별 7/14/30 중앙값·평균·등락률·표본수 (단일 진실 원천)
export async function onRequest(context) {
  const SUPA = 'https://aqxrmdratnkffvivguqs.supabase.co';
  const KEY = 'sb_publishable_AeDBjfn3ymozGyw06ohMUw_S6n1-qpj';
  const url = new URL(context.request.url);
  const slug = url.searchParams.get('slug');
  if (!slug) return json({ error: 'slug required' }, 400);

  try {
    // 1) 카드 메타 — MVP는 포켓몬만. game=pokemon 강제 필터.
    const cRes = await fetch(`${SUPA}/rest/v1/cards?select=slug,name,name_ko,game,set_code,set_name,number,rarity,rarity_class&slug=eq.${encodeURIComponent(slug)}&game=eq.pokemon&limit=1`, { headers: { apikey: KEY } });
    if (!cRes.ok) return json({ error: `cards ${cRes.status}` }, 500);
    const cards = await cRes.json();
    if (!cards.length) return json({ error: 'card not found' }, 404);
    if (cards[0].game !== 'pokemon') return json({ error: 'not in scope' }, 404);

    // 2) 모든 variant summary + Cardmarket + ★ Trust MV 병렬 fetch
    const [sRes, cmRes, tRes] = await Promise.all([
      fetch(`${SUPA}/rest/v1/card_price_summary?card_slug=eq.${encodeURIComponent(slug)}&order=samples_30d.desc.nullslast`, { headers: { apikey: KEY } }),
      fetch(`${SUPA}/rest/v1/price_metrics_external?card_slug=eq.${encodeURIComponent(slug)}&source=eq.pokemontcg-cardmarket&select=ext_avg_24h,ext_avg_7d,ext_avg_14d,ext_avg_30d,ext_change_7d_pct,ext_change_30d_pct,ext_updated_at`, { headers: { apikey: KEY } }),
      fetch(`${SUPA}/rest/v1/card_price_trust?card_slug=eq.${encodeURIComponent(slug)}&limit=1`, { headers: { apikey: KEY } })
    ]);
    const variants = sRes.ok ? await sRes.json() : [];
    const cmRows = cmRes.ok ? await cmRes.json() : [];
    const cm = cmRows[0] || null;
    const trustRows = tRes.ok ? await tRes.json() : [];
    const trust = trustRows[0] || null;

    // 3) variant 선호 순서로 best 선택
    const rank = { normal: 1, holofoil: 2, reverseHolofoil: 3, unlimitedHolofoil: 4, '1stEditionHolofoil': 5, '1stEditionNormal': 6 };
    let best = variants.slice().sort((a,b) => (rank[a.variant]||9) - (rank[b.variant]||9))[0] || null;

    // 4) 가격 출처 통일: Cardmarket avg × KRW 환산이 있으면 best의 latest/median을 그것으로 덮어쓰기
    // 환율: usdToKrw (TCGCSV USD→KRW 비율) × EUR/USD 1.08 명시
    if (best && cm) {
      const usdToKrw = (best.latest_usd && best.latest_krw && Number(best.latest_usd) > 0)
        ? Number(best.latest_krw) / Number(best.latest_usd) : 1381;
      const eurToKrw = usdToKrw * 1.08;
      const round = v => v != null ? Math.round(Number(v) * eurToKrw) : null;
      best = {
        ...best,
        // 카드 상단 가격 = Cardmarket 24h 평균 KRW (있으면)
        latest_krw_cardmarket: round(cm.ext_avg_24h),
        // 7/14/30 평균을 KRW로 (Cardmarket 데이터)
        cm_avg_7d_krw:  round(cm.ext_avg_7d),
        cm_avg_14d_krw: round(cm.ext_avg_14d),
        cm_avg_30d_krw: round(cm.ext_avg_30d),
        cm_change_7d_pct:  cm.ext_change_7d_pct  != null ? Number(cm.ext_change_7d_pct)  : null,
        cm_change_30d_pct: cm.ext_change_30d_pct != null ? Number(cm.ext_change_30d_pct) : null,
        cm_updated_at: cm.ext_updated_at || null,
        usd_to_krw_rate: Math.round(usdToKrw),
        eur_to_krw_rate: Math.round(eurToKrw)
      };
    }

    // ★ Trust Gate 머지 — NONE 카드는 latest_krw=null (가격 안 보이게)
    if (best && trust) {
      best.trust_level = trust.trust_level;
      best.display_krw = trust.display_krw;
      best.distinct_7d = trust.distinct_7d;
      best.distinct_30d = trust.distinct_30d;
      best.clean_30d_n = trust.clean_30d_n;
      best.clean_30d_median_krw = trust.clean_30d_median_krw;
      if (trust.trust_level === 'NONE') {
        best.latest_krw = null;
      } else if (trust.display_krw) {
        // HIGH/MEDIUM/LOW: display_krw로 교체 (raw outlier 차단)
        best.latest_krw = trust.display_krw;
      }
    } else if (best && !trust) {
      best.trust_level = 'NONE';
      best.latest_krw = null;
    }

    return json({ card: cards[0], best, variants, cardmarket: cm, trust });
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
