// /cards/<slug> SSR — 정적 card-detail.html 템플릿을 HTMLRewriter로 변환
export async function onRequest(context) {
  const { request, env, params } = context;
  const slug = String(params.slug || '').toLowerCase().replace(/[^a-z0-9\-_]/g, '');
  if (!slug) return new Response('Not Found', { status: 404 });

  const SUPA = 'https://aqxrmdratnkffvivguqs.supabase.co';
  const KEY = 'sb_publishable_AeDBjfn3ymozGyw06ohMUw_S6n1-qpj';

  // 0) 구형 slug → 실제 slug 301 매핑
  const SLUG_REMAP = {
    'charizard-ex-sar':  'charizard-ex-sv3-223',
    'sv4a-zard-sar':     'charizard-ex-sv3-223',
    'mirai-don-ex-sar':  'miraidon-ex-sv1-244',
    'miraidon-ex-sar':   'miraidon-ex-sv1-244',
    'koraidon-ex-sar':   'koraidon-ex-sv1-247',
    'pikachu-ex-sar':    'pikachu-ex-sv8-238'
  };
  if (SLUG_REMAP[slug]) {
    return Response.redirect(`https://cardpick.kr/cards/${SLUG_REMAP[slug]}`, 301);
  }

  // 1) 카드 메타 + summary + cardmarket 병렬 fetch
  let card = null, best = null, cm = null;
  try {
    const [cRes, sRes, cmRes] = await Promise.all([
      fetch(`${SUPA}/rest/v1/cards?select=slug,name,name_ko,game,set_code,set_name,number,rarity,rarity_class&slug=eq.${encodeURIComponent(slug)}&limit=1`, { headers: { apikey: KEY } }),
      fetch(`${SUPA}/rest/v1/card_price_summary_best?card_slug=eq.${encodeURIComponent(slug)}&limit=1`, { headers: { apikey: KEY } }),
      fetch(`${SUPA}/rest/v1/price_metrics_external?card_slug=eq.${encodeURIComponent(slug)}&source=eq.pokemontcg-cardmarket&limit=1`, { headers: { apikey: KEY } })
    ]);
    if (cRes.ok) { const arr = await cRes.json(); card = arr[0] || null; }
    if (sRes.ok) { const arr = await sRes.json(); best = arr[0] || null; }
    if (cmRes.ok) { const arr = await cmRes.json(); cm = arr[0] || null; }
  } catch (e) { /* fall through */ }

  // 카드 자체가 DB에 없거나 MVP 게임 외 → 404 (SEO 정상화). MVP는 포켓몬만 노출.
  if (!card || card.game !== 'pokemon') {
    return new Response('Card not found', {
      status: 404,
      headers: { 'Content-Type': 'text/plain; charset=utf-8' }
    });
  }

  // 2) 정적 템플릿 불러오기
  const tplUrl = new URL('/card-detail', request.url);
  const tplRes = await env.ASSETS.fetch(tplUrl.toString());
  if (!tplRes.ok) return tplRes;

  // 3) 메타 조립
  const name = card?.name || slug;
  const nameKo = card?.name_ko || '';
  const setName = card?.set_name || (card?.set_code || '').toUpperCase();
  const rarity = card?.rarity_class || card?.rarity || '';
  // 환율: TCGCSV USD/KRW × EUR/USD 1.08
  const usdToKrw = (best?.latest_usd && best?.latest_krw && Number(best.latest_usd) > 0)
    ? Number(best.latest_krw) / Number(best.latest_usd) : 1381;
  const eurToKrw = usdToKrw * 1.08;
  // 화면 가격 = Cardmarket avg24h × KRW 우선, 없으면 TCGCSV latest_krw fallback
  const krwCardmarket = cm?.ext_avg_24h != null ? Math.round(Number(cm.ext_avg_24h) * eurToKrw) : null;
  const krw = krwCardmarket != null ? krwCardmarket
            : (best?.latest_krw ? Math.round(Number(best.latest_krw)) : null);
  const priceSource = krwCardmarket != null ? 'Cardmarket EU' : 'TCGplayer 북미';
  const krwText = krw ? `최근가 ₩${krw.toLocaleString('ko-KR')}` : '';

  const hasPrice = !!(best && best.latest_krw);
  const number = card?.number || '';
  // 카드 식별: 외부 감사 권장 "Mew ex 232/091" (# 없이)
  const idLabel = number ? `${name} ${number}` : name;
  const metaCore = `${idLabel}${setName ? ` (${setName})` : ''}`;

  // 외부 감사 권장 title: "Mew ex 232/091 가격 참고가 · Cardmarket 시세 추이 | 카드픽"
  const title = hasPrice
    ? `${idLabel} 가격 참고가 · Cardmarket 시세 추이 | 카드픽`
    : `${idLabel} 카드 정보 | 카드픽`;
  const desc = hasPrice
    ? `${idLabel} 카드의 해외 참고가, 7일·30일 가격 변화, Cardmarket 기반 시세 추이와 세트·레어도 정보를 확인하세요.`
    : `${idLabel}${rarity ? ` (${rarity})` : ''}${setName ? ' · ' + setName : ''} 카드 정보. 해외 참고가는 수집 후 표시됩니다.`;
  const canonical = `https://cardpick.kr/cards/${slug}`;

  function esc(s){ return String(s||'').replace(/[<>&"]/g, c => ({'<':'&lt;','>':'&gt;','&':'&amp;','"':'&quot;'}[c])); }

  // 본문 SSR용 카드별 텍스트 — idLabel 기준으로 모든 위치 통일
  const displayName = idLabel + (nameKo ? ` (${nameKo})` : '');
  const subtitle = [setName, rarity].filter(Boolean).join(' · ');
  const aboutText = best
    ? `${displayName} 카드의 Pokémon TCG API 기반 해외 참고가 페이지입니다. ${setName} 세트 ${card?.number || ''}번. 최근 참고가 ₩${Math.round(Number(best.latest_krw)).toLocaleString('ko-KR')}, 7일 중앙값 ${best.median_7d ? '₩' + Math.round(Number(best.median_7d)).toLocaleString('ko-KR') : '—'}, 30일 표본 ${best.samples_30d || 0}건. 국내 거래가와 다를 수 있습니다.`
    : `${displayName} 카드 정보 페이지입니다. ${setName}${card?.number ? ` · ${card.number}` : ''}. 해외 참고가는 수집 후 표시됩니다.`;
  const gameLabel = '포켓몬';

  // 4) HTMLRewriter로 메타 + 본문 주입
  const rewriter = new HTMLRewriter()
    .on('title', { element(el) { el.setInnerContent(title); } })
    .on('meta[name="description"]', { element(el) { el.setAttribute('content', desc); } })
    .on('meta[property="og:title"]',       { element(el) { el.setAttribute('content', title); } })
    .on('meta[property="og:description"]', { element(el) { el.setAttribute('content', desc); } })
    .on('meta[property="og:url"]',         { element(el) { el.setAttribute('content', canonical); } })
    .on('meta[name="twitter:title"]',      { element(el) { el.setAttribute('content', title); } })
    .on('meta[name="twitter:description"]',{ element(el) { el.setAttribute('content', desc); } })
    .on('link[rel="canonical"]',           { element(el) { el.setAttribute('href', canonical); } })
    // SSR로 들어온 /cards/<slug>는 가격 데이터 있을 때만 index 허용 (얇은 페이지 방지)
    .on('meta[name="robots"]',             { element(el) { el.setAttribute('content', hasPrice ? 'index,follow,max-image-preview:large,max-snippet:-1' : 'noindex,follow'); } })
    // 본문 SSR (data-c-* 앵커)
    .on('[data-c-name]',        { element(el) { el.setInnerContent(displayName); } })
    .on('[data-c-subtitle]',    { element(el) { el.setInnerContent(subtitle); } })
    .on('[data-c-h1-full]',     { element(el) { el.setInnerContent(`${idLabel} 가격 참고가`); } })
    .on('[data-c-h1-lede]',     { element(el) {
      // AEO/GEO 정답 블록 — Cardmarket 우선 가격
      let lede;
      if (hasPrice) {
        lede = `${idLabel}의 현재 해외 참고가는 ₩${krw.toLocaleString('ko-KR')}입니다. ${priceSource} 평균가 기반이며 국내 거래가와 다를 수 있습니다.`;
      } else {
        lede = `${idLabel}${rarity ? ` (${rarity})` : ''}${setName ? ' · ' + setName : ''} 카드 정보. 해외 참고가는 수집 후 표시됩니다.`;
      }
      el.setInnerContent(lede);
    } })
    // FAQ — 카드 번호로 식별 (같은 이름 다른 번호 카드 차별화)
    .on('[data-c-faq-q1]',      { element(el) { el.setInnerContent(`${idLabel} 카드의 가격은 어디 기준인가요?`); } })
    .on('[data-c-faq-a1]',      { element(el) { el.setInnerContent(`Pokémon TCG API 기반 TCGplayer 북미 평균가 및 Cardmarket EU 평균가 참고값입니다. 국내 거래가와 다를 수 있습니다.`); } })
    .on('[data-c-faq-q2]',      { element(el) { el.setInnerContent(`${idLabel} 카드는 어디서 살 수 있나요?`); } })
    .on('[data-c-faq-a2]',      { element(el) { el.setInnerContent(`국내는 중고거래 플랫폼과 카드 전문몰에서, 해외는 일본 개인 마켓과 미국 카드 마켓에서 구할 수 있습니다.`); } })
    .on('[data-c-faq-q3]',      { element(el) { el.setInnerContent(`한국과 일본 가격 차이는 얼마나 나나요?`); } })
    .on('[data-c-faq-a3]',      { element(el) { el.setInnerContent(`환율과 배송비, 관세 면제 한도에 따라 달라집니다. 차이가 줄거나 역전되는 경우도 있어 비교 시점이 중요합니다.`); } })
    .on('[data-c-faq-q4]',      { element(el) { el.setInnerContent(`가품 구별 포인트는 무엇인가요?`); } })
    .on('[data-c-faq-a4]',      { element(el) { el.setInnerContent(`인쇄 결, 홀로 패턴, 모서리 절단면, 카드 뒷면 잉크 두께를 확인합니다. 확신이 어려우면 PSA·BGS 그레이딩을 통해 확정합니다.`); } })
    .on('[data-c-faq-q5]',      { element(el) { el.setInnerContent(`PSA 등급별 가격 차이가 큰가요?`); } })
    .on('[data-c-faq-a5]',      { element(el) { el.setInnerContent(`인기 카드는 PSA 10과 9 사이에 큰 차이가 나는 편입니다. 다만 표본이 적으면 가격이 불안정할 수 있습니다.`); } })
    .on('[data-c-faq-q6]',      { element(el) { el.setInnerContent(`같은 카드 다른 버전과 차이는 무엇인가요?`); } })
    .on('[data-c-faq-a6]',      { element(el) { el.setInnerContent(`홀로 처리, 일러스트 구성, 발매 세트에 따라 참고가가 다릅니다. 버전마다 일러스트 또는 인쇄가 다를 수 있습니다.`); } })
    .on('[data-c-info-h2]',     { element(el) { el.setInnerContent(`${name} 카드 정보`); } })
    .on('[data-c-about]',       { element(el) { el.setInnerContent(aboutText); } })
    .on('[data-c-game-chip]',   { element(el) { el.setInnerContent(gameLabel); } })
    .on('[data-c-rarity-chip]', { element(el) { el.setInnerContent(rarity || '—'); } })
    .on('[data-c-set-chip]',    { element(el) { el.setInnerContent(setName + (card?.game === 'pokemon' ? ' · 영문판' : '')); } })
    .on('[data-c-set-en]',      { element(el) { el.setInnerContent(setName); } })
    .on('[data-c-set-en-short]',{ element(el) { el.setInnerContent(setName); } })
    .on('[data-c-set-jp]',      { element(el) { el.setInnerContent(setName); } })
    .on('[data-c-set-link]',    { element(el) { el.setInnerContent(setName); } })
    .on('[data-c-name-en]',     { element(el) { el.setInnerContent(name); } })
    .on('[data-c-number]',      { element(el) { el.setInnerContent(card?.number || '—'); } })
    .on('[data-c-rarity-full]', { element(el) { el.setInnerContent(rarity || '—'); } })
    .on('[data-c-game-name]',   { element(el) { el.setInnerContent(gameLabel + ' 카드 게임'); } })
    .on('head', {
      element(el) {
        el.append(`\n<script>window.CARDPICK_SLUG=${JSON.stringify(slug)};window.CARDPICK_CARD=${JSON.stringify(card || {})};window.CARDPICK_BEST=${JSON.stringify(best || null)};</script>`, { html: true });

        // BreadcrumbList — 카드 식별: 마지막에 "Name #Number"
        const bc = {
          "@context":"https://schema.org",
          "@type":"BreadcrumbList",
          "itemListElement":[
            {"@type":"ListItem","position":1,"name":"카드픽","item":"https://cardpick.kr/"},
            {"@type":"ListItem","position":2,"name":"포켓몬","item":"https://cardpick.kr/"},
            ...(setName ? [{"@type":"ListItem","position":3,"name":setName,"item":canonical}] : []),
            {"@type":"ListItem","position":setName ? 4 : 3,"name":idLabel,"item":canonical}
          ]
        };
        el.append(`\n<script type="application/ld+json">${JSON.stringify(bc)}</script>`, { html: true });

        // FAQPage — 화면 FAQ와 일치하는 6문항 (카드 번호로 식별)
        const faqList = [
          { q: `${idLabel} 카드의 가격은 어디 기준인가요?`,
            a: `Pokémon TCG API 기반 TCGplayer 북미 평균가 및 Cardmarket EU 평균가 참고값입니다. 국내 거래가와 다를 수 있습니다.` },
          { q: `${idLabel} 카드는 어디서 살 수 있나요?`,
            a: `국내는 중고거래 플랫폼과 카드 전문몰에서, 해외는 일본 개인 마켓과 미국 카드 마켓에서 구할 수 있습니다.` },
          { q: `한국과 일본 가격 차이는 얼마나 나나요?`,
            a: `환율과 배송비, 관세 면제 한도에 따라 달라집니다. 차이가 줄거나 역전되는 경우도 있어 비교 시점이 중요합니다.` },
          { q: `가품 구별 포인트는 무엇인가요?`,
            a: `인쇄 결, 홀로 패턴, 모서리 절단면, 카드 뒷면 잉크 두께를 확인합니다. 확신이 어려우면 PSA·BGS 그레이딩을 통해 확정합니다.` },
          { q: `PSA 등급별 가격 차이가 큰가요?`,
            a: `인기 카드는 PSA 10과 9 사이에 큰 차이가 나는 편입니다. 다만 표본이 적으면 가격이 불안정할 수 있습니다.` },
          { q: `같은 카드 다른 버전과 차이는 무엇인가요?`,
            a: `홀로 처리, 일러스트 구성, 발매 세트에 따라 참고가가 다릅니다. 버전마다 일러스트 또는 인쇄가 다를 수 있습니다.` }
        ];
        const faq = {
          "@context":"https://schema.org",
          "@type":"FAQPage",
          "mainEntity": faqList.map(f => ({
            "@type":"Question", "name": f.q,
            "acceptedAnswer": { "@type":"Answer", "text": f.a }
          }))
        };
        el.append(`\n<script type="application/ld+json">${JSON.stringify(faq)}</script>`, { html: true });

        // WebPage + 카드 식별 (외부 감사 권장: 판매 페이지 아니므로 Offer X)
        const webpage = {
          "@context": "https://schema.org",
          "@type": "WebPage",
          "name": `${idLabel} 가격 참고가`,
          "description": desc,
          "url": canonical,
          "inLanguage": "ko",
          "isPartOf": { "@type": "WebSite", "name": "카드픽", "url": "https://cardpick.kr/" },
          "about": {
            "@type": "Thing",
            "name": idLabel,
            "description": `${name}${rarity ? ' · ' + rarity : ''}${setName ? ' · ' + setName : ''}${number ? ' · ' + number : ''}`,
            ...(number ? { "identifier": { "@type":"PropertyValue", "propertyID":"cardNumber", "value": number } } : {})
          }
        };
        el.append(`\n<script type="application/ld+json">${JSON.stringify(webpage)}</script>`, { html: true });

        // Dataset — 가격 데이터 출처·갱신 주기 명시 (AEO 강화)
        if (hasPrice) {
          const dataset = {
            "@context": "https://schema.org",
            "@type": "Dataset",
            "name": `${idLabel} 해외 참고가 데이터`,
            "description": `${idLabel} 카드의 Pokémon TCG API 기반 TCGplayer 북미 평균가 및 Cardmarket EU 평균가 시계열 데이터. 매일 1회 자동 갱신.`,
            "url": canonical,
            "creator": { "@type": "Organization", "name": "카드픽", "url": "https://cardpick.kr/" },
            "license": "https://cardpick.kr/license",
            "isAccessibleForFree": true,
            "variableMeasured": [
              { "@type": "PropertyValue", "name": "30일 평균가", "unitText": "EUR / KRW" },
              { "@type": "PropertyValue", "name": "7일 평균가",  "unitText": "EUR / KRW" },
              { "@type": "PropertyValue", "name": "24시간 평균가", "unitText": "EUR / KRW" }
            ],
            "distribution": [{
              "@type": "DataDownload",
              "encodingFormat": "text/html",
              "contentUrl": canonical
            }]
          };
          el.append(`\n<script type="application/ld+json">${JSON.stringify(dataset)}</script>`, { html: true });
        }
      }
    });

  const transformed = rewriter.transform(new Response(tplRes.body, tplRes));
  return new Response(transformed.body, {
    status: 200,
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'no-store, max-age=0',
      'X-Cardpick-SSR': 'cards/' + slug
    }
  });
}
