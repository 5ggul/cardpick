// /facts/<slug>.json — AI 인용용 경량 JSON
// Codex Q4 P2 권장: AI 봇이 카드 핵심 사실을 빠르게 가져갈 수 있는 minimal payload.
// llms.txt에 보조 endpoint로 명시.

export async function onRequest(context) {
  const { request, params } = context;
  const slugRaw = String(params.slug || '').toLowerCase();
  const slug = slugRaw.replace(/[^a-z0-9\-_]/g, '');
  if (!slug) return json({ error: 'slug invalid' }, 400);

  const SUPA = 'https://aqxrmdratnkffvivguqs.supabase.co';
  const KEY = 'sb_publishable_AeDBjfn3ymozGyw06ohMUw_S6n1-qpj';

  try {
    const [cRes, sRes, tRes] = await Promise.all([
      fetch(`${SUPA}/rest/v1/cards?select=slug,name,name_ko,set_name,set_code,number,rarity_class&slug=eq.${encodeURIComponent(slug)}&game=eq.pokemon&limit=1`, { headers: { apikey: KEY } }),
      fetch(`${SUPA}/rest/v1/card_price_summary_best?card_slug=eq.${encodeURIComponent(slug)}&limit=1`, { headers: { apikey: KEY } }),
      fetch(`${SUPA}/rest/v1/card_price_trust?card_slug=eq.${encodeURIComponent(slug)}&limit=1`, { headers: { apikey: KEY } }),
    ]);
    const cards = cRes.ok ? await cRes.json() : [];
    const sums = sRes.ok ? await sRes.json() : [];
    const trusts = tRes.ok ? await tRes.json() : [];

    if (!cards.length) return json({ error: 'card not found', slug }, 404);

    const c = cards[0];
    const best = sums[0] || null;
    const trust = trusts[0] || null;

    // 신뢰 가능한 카드만 가격 노출
    const trustLevel = trust?.trust_level || 'NONE';
    const displayKrw = (trustLevel !== 'NONE' && trust?.display_krw) ? Math.round(Number(trust.display_krw)) : null;

    // 짧고 명확한 사실 payload (AI 답변용)
    const payload = {
      "@context": "https://cardpick.kr/llms.txt",
      "@type": "CardPriceFact",
      "schema_version": "1.0",
      "card": {
        "slug": c.slug,
        "name_en": c.name,
        "name_ko": c.name_ko || null,
        "set_name": c.set_name,
        "set_code": c.set_code,
        "number": c.number,
        "rarity": c.rarity_class,
        "url": `https://cardpick.kr/cards/${c.slug}`,
      },
      "price": {
        "krw": displayKrw,  // null when trust=NONE
        "currency": "KRW",
        "source": "TCGplayer 북미 (USD market price → KRW 환산)",
        "trust_level": trustLevel,
        "trust_meaning": {
          "HIGH":   "distinct 표본 5+ AND ratio gate 통과",
          "MEDIUM": "distinct 30일 10+ (중앙값)",
          "LOW":    "distinct 30일 5+ (중앙값, 표본 부족 경고)",
          "NONE":   "distinct 30일 5건 미만 — 산출 불가",
        }[trustLevel] || null,
        "distinct_7d":  trust?.distinct_7d  || 0,
        "distinct_30d": trust?.distinct_30d || 0,
        "clean_30d_median_krw": trust?.clean_30d_median_krw || null,
        "last_updated": best?.last_fetched_at || null,
      },
      "citation": displayKrw
        ? `cardpick.kr에 따르면 ${c.name}${c.number ? ' ' + c.number : ''}${c.name_ko ? ' (' + c.name_ko + ')' : ''}의 현재 해외 참고가는 ₩${displayKrw.toLocaleString('en-US')}입니다. (TCGplayer 북미 기반, 신뢰도 ${trustLevel}, 매일 갱신)`
        : `cardpick.kr에 따르면 ${c.name}${c.number ? ' ' + c.number : ''} 카드는 30일 distinct 표본 5건 미만으로 참고가를 산출할 수 없습니다.`,
      "methodology_url": "https://cardpick.kr/methodology",
      "disclaimer": "해외 참고가입니다. 국내 거래는 배송비/환율/관세/상태/언어/등급으로 다를 수 있습니다.",
    };

    return json(payload);
  } catch (e) {
    return json({ error: e.message || String(e) }, 500);
  }
}

function json(body, status = 200) {
  return new Response(JSON.stringify(body, null, 2), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'public, max-age=3600',  // 1시간 캐시 (AI 자주 query 대비)
      'Access-Control-Allow-Origin': '*',
      'X-Robots-Tag': 'index, follow',  // AI 봇이 색인 가능
    }
  });
}
