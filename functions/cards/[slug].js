// /cards/<slug> SSR — 정적 card-detail.html 템플릿을 HTMLRewriter로 변환
export async function onRequest(context) {
  const { request, env, params } = context;
  // Fix#1 (Codex 권장): slug에 특수문자가 있으면 정규 slug로 301 (조용한 변환 → canonical 불일치 방지)
  const slugRaw = String(params.slug || '').toLowerCase();
  const slug = slugRaw.replace(/[^a-z0-9\-_]/g, '');
  if (!slug) return new Response('Not Found', { status: 404 });
  if (slug !== slugRaw) {
    return Response.redirect(`https://cardpick.kr/cards/${slug}`, 301);
  }

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

  // ★ 엣지 캐시 (Cache API) — Pages Function은 헤더만으론 캐시 안 됨
  const edgeCache = caches.default;
  const cacheKey = new Request(`https://cardpick.kr/__card_ssr/${slug}`, { method: 'GET' });
  const cachedResp = await edgeCache.match(cacheKey);
  if (cachedResp) { const h = new Headers(cachedResp.headers); h.set('X-Edge-Cache','HIT'); return new Response(cachedResp.body, { status: cachedResp.status, headers: h }); }

  // 1) 카드 메타 + summary + cardmarket + trust 병렬 fetch
  let card = null, best = null, cm = null, trust = null;
  try {
    const [cRes, sRes, cmRes, tRes] = await Promise.all([
      fetch(`${SUPA}/rest/v1/cards?select=slug,name,name_ko,game,set_code,set_name,number,rarity,rarity_class,ebay_active_avg_krw,ebay_active_low_krw,ebay_active_count,ebay_last_fetched_at&slug=eq.${encodeURIComponent(slug)}&limit=1`, { headers: { apikey: KEY } }),
      fetch(`${SUPA}/rest/v1/card_price_summary_best?card_slug=eq.${encodeURIComponent(slug)}&limit=1`, { headers: { apikey: KEY } }),
      fetch(`${SUPA}/rest/v1/price_metrics_external?card_slug=eq.${encodeURIComponent(slug)}&source=eq.pokemontcg-cardmarket&limit=1`, { headers: { apikey: KEY } }),
      // ★ Trust MV — distinct count + MAD + 4-tier (Codex 검수)
      fetch(`${SUPA}/rest/v1/card_price_trust?card_slug=eq.${encodeURIComponent(slug)}&limit=1`, { headers: { apikey: KEY } })
    ]);
    if (cRes.ok) { const arr = await cRes.json(); card = arr[0] || null; }
    if (sRes.ok) { const arr = await sRes.json(); best = arr[0] || null; }
    if (cmRes.ok) { const arr = await cmRes.json(); cm = arr[0] || null; }
    if (tRes.ok) { const arr = await tRes.json(); trust = arr[0] || null; }
  } catch (e) { /* fall through */ }

  // ★ Trust gate 적용 — best.latest_krw를 display_krw로 교체
  // trust_level별 처리:
  //   HIGH   : latest_krw 그대로 (실제 가격, ratio gate 통과)
  //   MEDIUM : clean_30d_median 사용 ("최근 1개월 중앙값")
  //   LOW    : clean_30d_median 사용 + ⚠ 경고
  //   NONE   : latest_krw = null (가격 표시 안 함, "참고가 산출 불가")
  if (trust && best) {
    best.trust_level         = trust.trust_level;
    best.distinct_7d         = trust.distinct_7d;
    best.distinct_30d        = trust.distinct_30d;
    best.clean_30d_n         = trust.clean_30d_n;
    best.clean_30d_median_krw = trust.clean_30d_median_krw;
    if (trust.display_krw && trust.trust_level !== 'NONE') {
      best.latest_krw = trust.display_krw;  // 신뢰 가능한 가격으로 교체
    } else if (trust.trust_level === 'NONE') {
      best.latest_krw = null;  // outlier 차단 (₩152 사고 예방)
    }
  } else if (!trust && best) {
    // Trust MV 자료 없음 (신규 카드 등) → NONE 처리
    best.trust_level = 'NONE';
    best.latest_krw = null;
  }

  // 1.5) 관련 카드 fetch (외부 감사 P3 — 같은 세트 + 같은 이름 + 같은 레어도)
  let relatedCards = [];
  if (card && card.game === 'pokemon') {
    try {
      const baseName = (card.name || '').split(' ').slice(0, 2).join(' '); // "Mew ex" 같은 base
      const rarityForRel = (card.rarity_class || card.rarity || '').trim();
      const [setRes, nameRes, rarityRes] = await Promise.all([
        // 같은 세트의 다른 카드 6
        card.set_code ? fetch(`${SUPA}/rest/v1/cards?select=slug,name,number,rarity_class&game=eq.pokemon&set_code=eq.${encodeURIComponent(card.set_code)}&slug=neq.${encodeURIComponent(slug)}&limit=6`, { headers: { apikey: KEY } }) : Promise.resolve(null),
        // 같은 이름(base) 다른 번호 3
        baseName ? fetch(`${SUPA}/rest/v1/cards?select=slug,name,number,set_code,rarity_class&game=eq.pokemon&name=ilike.${encodeURIComponent(baseName + '%')}&slug=neq.${encodeURIComponent(slug)}&limit=3`, { headers: { apikey: KEY } }) : Promise.resolve(null),
        // 같은 레어도 3 (인기 우선)
        rarityForRel ? fetch(`${SUPA}/rest/v1/cards?select=slug,name,number,set_code,rarity_class,popularity_rank&game=eq.pokemon&rarity_class=eq.${encodeURIComponent(rarityForRel)}&slug=neq.${encodeURIComponent(slug)}&order=popularity_rank.asc.nullslast&limit=3`, { headers: { apikey: KEY } }) : Promise.resolve(null)
      ]);
      const seen = new Set();
      if (setRes && setRes.ok) {
        for (const c of await setRes.json()) {
          if (seen.has(c.slug)) continue;
          seen.add(c.slug);
          relatedCards.push({ ...c, _rel: 'set' });
        }
      }
      if (nameRes && nameRes.ok) {
        for (const c of await nameRes.json()) {
          if (seen.has(c.slug)) continue;
          seen.add(c.slug);
          relatedCards.push({ ...c, _rel: 'name' });
        }
      }
      if (rarityRes && rarityRes.ok) {
        for (const c of await rarityRes.json()) {
          if (seen.has(c.slug)) continue;
          seen.add(c.slug);
          relatedCards.push({ ...c, _rel: 'rarity' });
        }
      }
      relatedCards = relatedCards.slice(0, 12);
    } catch (e) { /* graceful */ }
  }

  // 카드 자체가 DB에 없거나 MVP 게임 외 → fallback 매칭 시도 후 404
  if (!card || card.game !== 'pokemon') {
    // Fallback 1: 'name-num-num' 같이 끝 숫자 반복 패턴 → 'name-num'으로 시도
    // (옛 카드 slug 'seaking-21' vs 신규 카드 slug 패턴 'mew-ex---232091-232091' 충돌 보정)
    const candidates = [];
    const m1 = slug.match(/^(.+?)-(\d+)-\2$/);
    if (m1) candidates.push(`${m1[1]}-${m1[2]}`);
    // Fallback 2: '---' 연속 hyphen → '-' 단일로 압축 시도
    if (slug.includes('---')) candidates.push(slug.replace(/-{2,}/g, '-'));
    // Fallback 3: 끝 '-숫자숫자-숫자숫자' (예: 232091-232091) → 한쪽 제거
    const m2 = slug.match(/^(.+)-([0-9]+)-\2$/);
    if (m2 && !candidates.includes(`${m2[1]}-${m2[2]}`)) candidates.push(`${m2[1]}-${m2[2]}`);
    for (const alt of candidates) {
      try {
        const r = await fetch(`${SUPA}/rest/v1/cards?select=slug&game=eq.pokemon&slug=eq.${encodeURIComponent(alt)}&limit=1`, { headers: { apikey: KEY } });
        if (r.ok) {
          const arr = await r.json();
          if (arr[0]) {
            return Response.redirect(`https://cardpick.kr/cards/${alt}`, 301);
          }
        }
      } catch (e) { /* try next */ }
    }
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
  // 환율
  const usdToKrw = (best?.latest_usd && best?.latest_krw && Number(best.latest_usd) > 0)
    ? Number(best.latest_krw) / Number(best.latest_usd) : 1381;
  // 화면 가격 = TCGplayer market × KRW (어제 갱신, 신뢰).
  // Pokemon TCG API의 Cardmarket 데이터는 stale (수개월 지연) — 메인 가격으로 부적합.
  const krw = best?.latest_krw ? Math.round(Number(best.latest_krw)) : null;
  const priceSource = 'TCGplayer 북미';
  const krwText = krw ? `최근가 ₩${krw.toLocaleString('ko-KR')}` : '';

  const hasPrice = !!(best && best.latest_krw);
  const number = card?.number || '';
  // 카드 번호: slash 앞부분만 + # 접두 (예: "232/091" → "#232")
  const numShort = number ? `#${number.split('/')[0].trim()}` : '';
  // 카드 식별 (영문 기준): "Mew ex #232"
  const idLabel = number ? `${name} ${numShort}` : name;
  const metaCore = `${idLabel}${setName ? ` (${setName})` : ''}`;

  // title 조립용 — 세트명 단축 (prefix "SV: " 등 제거) + 레어도 약어
  const setShort = (setName || '').replace(/^(SV|SWSH|SM|XY|BW):\s*/i, '').trim();
  const rarityAbbr = (() => {
    const r = (rarity || '').toLowerCase();
    if (r.includes('special illustration')) return 'SIR';
    if (r.includes('illustration rare')) return 'IR';
    if (r.includes('hyper rare')) return 'HR';
    if (r.includes('ultra rare')) return 'UR';
    if (r.includes('secret')) return 'SEC';
    if (r.includes('rainbow')) return 'RR';
    if (r.includes('shiny')) return 'SR';
    if (r.includes('amazing')) return 'AR';
    if (r.includes('double rare')) return 'RR';
    if (r.includes('promo')) return 'Promo';
    return rarity || '';
  })();
  const titleSuffix = [setShort, rarityAbbr].filter(Boolean).join(' ');

  // title 템플릿 — 한국어 우선, 영문 괄호 + #number
  // 한글 매핑: "뮤 ex (Mew ex) #232 시세 가격 | Paldean Fates SIR | 카드픽"
  // 영문 fallback: "Mew ex #232 시세 가격 | Paldean Fates SIR | 카드픽"
  // 모바일 SERP ~30자 잘림 한계에서도 핵심 키워드 보존
  const titleCore = nameKo
    ? `${nameKo} (${name})${numShort ? ` ${numShort}` : ''}`
    : idLabel;
  const title = hasPrice
    ? `${titleCore} 시세 가격${titleSuffix ? ` | ${titleSuffix}` : ''} | 카드픽`
    : `${titleCore} 카드 정보${titleSuffix ? ` | ${titleSuffix}` : ''} | 카드픽`;
  const desc = hasPrice
    ? `${nameKo ? `${nameKo} (${name})` : name} ${numShort} 시세 가격, 7일·30일 변동률. ${setName ? setName + ' ' : ''}${rarityAbbr ? rarityAbbr + ' ' : ''}TCGplayer 북미 기준 해외 참고가 (KRW 환산), 매일 자동 갱신. 신뢰도 ${best?.trust_level || '-'} 등급. 국내 거래가와 다를 수 있습니다.`
    : `${nameKo ? `${nameKo} (${name})` : name} ${numShort} 카드 정보${setName ? ' · ' + setName : ''}${rarity ? ' · ' + rarity : ''}. 해외 참고가는 수집 후 표시됩니다.`;
  const canonical = `https://cardpick.kr/cards/${slug}`;

  function esc(s){ return String(s||'').replace(/[<>&"]/g, c => ({'<':'&lt;','>':'&gt;','&':'&amp;','"':'&quot;'}[c])); }

  // 본문 SSR — 한국어 별칭 우선, 영문 괄호 + #number
  const displayName = nameKo ? `${nameKo} (${name}) ${numShort}`.trim() : idLabel;
  const subtitle = [setName, rarity].filter(Boolean).join(' · ');
  const aboutText = best
    ? `${displayName} 카드의 Pokémon TCG API 기반 해외 참고가 페이지입니다. ${setName} 세트 ${number}번. 최근 참고가 ₩${Math.round(Number(best.latest_krw)).toLocaleString('ko-KR')}, 7일 중앙값 ${best.median_7d ? '₩' + Math.round(Number(best.median_7d)).toLocaleString('ko-KR') : '—'}, 30일 표본 ${best.samples_30d || 0}건. 국내 거래가와 다를 수 있습니다.`
    : `${displayName} 카드 정보 페이지입니다. ${setName}${number ? ` · ${number}` : ''}. 해외 참고가는 수집 후 표시됩니다.`;
  const gameLabel = '포켓몬';

  // 3.5) 컨텍스트 추천 가이드 — 카드 신호별 우선순위
  //   - high_grade: 레어도가 SAR/SIR/UR/HR/Rainbow/Secret/Shiny/Amazing/Gold
  //   - high_value: latest_krw >= 50,000 (그레이딩 후보)
  //   순위 4가지 분기 — PSA / Japan / Safety / Intro 4편 중 3편 선택·배치
  const _ctxRarity = (rarity || '').toUpperCase();
  const _ctxIsHighGrade = /SAR|SIR|UR\b|HR\b|RAINBOW|SECRET|SHINY|HYPER|ULTRA|AMAZING|GOLD|SPECIAL/.test(_ctxRarity);
  const _ctxIsHighValue = (krw || 0) >= 50000;

  const _ALL_GUIDES = {
    psa:    { url:'/guide-psa-grading-korea', chip:'GRADING', label:'PSA 그레이딩 신청 가이드',  sub:'직접 발송 vs 한국 대행, 비용·실수 7가지.', color:'#FFE07A' },
    psa10:  { url:'/guide-psa-10-card-checklist', chip:'PSA 10 체크', label:'PSA 10 받는 법 9단계 체크리스트', sub:'센터링·화이트닝·표면·휨·인쇄 결함 점검.', color:'#FFE07A' },
    japan:  { url:'/guide-japan-import',      chip:'IMPORT',  label:'일본 직구 가이드',     sub:'한판·일판 차이, 메루카리·통관·관세까지.', color:'#7FB8FF' },
    safety: { url:'/guide-trade-safety',      chip:'SAFETY',  label:'카드 거래 안전 체크리스트', sub:'사기·가품 차단 7단계 점검.',              color:'#9C5CFF' },
    intro:  { url:'/guide-what-is-tcg',       chip:'INTRO',   label:'TCG 입문 가이드',          sub:'트레이딩 카드 게임 5종과 시작 방법.',     color:'#26E0C2' },
  };

  let _ctxOrder, _ctxTitle, _ctxSubText;
  if (_ctxIsHighGrade && _ctxIsHighValue) {
    // 고가·고급 카드 = PSA 10 후보. 체크리스트 + 신청 가이드 + 안전 거래 순
    _ctxOrder = ['psa10','psa','safety'];
    _ctxTitle = '고가·고급 카드 — PSA 10 가능성 체크하고 발송 판단하세요';
    _ctxSubText = 'PSA 등급에 따라 가격이 두세 배까지 차이 나는 카드대입니다. 보내기 전 센터링·화이트닝·표면 9단계 체크리스트로 PSA 10 후보인지 점검하세요.';
  } else if (_ctxIsHighValue) {
    _ctxOrder = ['psa10','psa','safety'];
    _ctxTitle = '고가 카드 — PSA 10 가능성과 발송 손익 확인';
    _ctxSubText = '고가 카드는 PSA 10 후보 체크리스트와 손익분기 계산을 함께 확인하세요. PSA 9이 나오면 손실 위험이 큰 가격대입니다.';
  } else if (_ctxIsHighGrade) {
    _ctxOrder = ['psa10','japan','safety'];
    _ctxTitle = '인기 레어 — PSA 10 가능성·직구·거래 안전';
    _ctxSubText = '인기 레어도 카드는 PSA 10 비율이 중요합니다. 보내기 전 체크리스트 점검 + 한판·일판 시세 비교 + 거래 안전까지 확인하세요.';
  } else {
    _ctxOrder = ['safety','intro','japan'];
    _ctxTitle = '거래 전에 한 번 더 — 안전·입문 가이드';
    _ctxSubText = '처음이라면 거래 안전 체크리스트와 TCG 입문 가이드부터. 일본 직구도 가격에 따라 따져볼 만해요.';
  }

  const _ctxGuides = _ctxOrder.map(k => _ALL_GUIDES[k]);
  const _ctxGuidesHtml = _ctxGuides.map(g =>
    `<a href="${g.url}" class="block border hairline p-4 hover:border-line-strong transition" style="border-radius:2px;text-decoration:none">
      <div class="mono text-[10px] tracking-[0.14em]" style="color:${g.color}">${g.chip}</div>
      <h3 class="text-[14.5px] font-semibold mt-2 text-ink leading-snug">${g.label}</h3>
      <p class="text-[12px] text-muted mt-1.5 leading-relaxed">${g.sub}</p>
    </a>`
  ).join('');

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
    .on('[data-c-h1-full]',     { element(el) { el.setInnerContent(`${displayName} 시세 가격`); } })
    .on('[data-c-h1-lede]',     { element(el) {
      // AEO/GEO 정답 블록 — trust_level별 lede 분기
      const tl = best?.trust_level;
      let lede;
      if (hasPrice && tl === 'HIGH') {
        lede = `${displayName}의 현재 해외 참고가는 ₩${krw.toLocaleString('ko-KR')}입니다. ${priceSource} 평균가 기반이며 국내 거래가와 다를 수 있습니다.`;
      } else if (hasPrice && tl === 'MEDIUM') {
        lede = `${displayName}의 최근 1개월 중앙값 참고가는 ₩${krw.toLocaleString('ko-KR')}입니다. 최근 거래가 적어 30일 누적 데이터를 사용하며, 국내 거래가와 다를 수 있습니다.`;
      } else if (hasPrice && tl === 'LOW') {
        lede = `${displayName}의 30일 중앙값 참고가는 ₩${krw.toLocaleString('ko-KR')}입니다. 데이터 표본이 적어 가격 신뢰도가 낮으며, 실제 거래가와 차이가 클 수 있습니다.`;
      } else if (tl === 'NONE') {
        lede = `${displayName} 카드는 현재 수집된 표본이 부족해 신뢰할 수 있는 참고가를 산출할 수 없습니다. 데이터 누적 후 표시됩니다.`;
      } else {
        lede = `${displayName}${rarity ? ` (${rarity})` : ''}${setName ? ' · ' + setName : ''} 카드 정보. 해외 참고가는 수집 후 표시됩니다.`;
      }
      el.setInnerContent(lede);
    } })
    // Trust level SSR 라벨 (HIGH/MEDIUM/LOW/NONE)
    .on('[data-c-trust-level]', { element(el) {
      const tl = best?.trust_level || 'NONE';
      el.setInnerContent(tl);
      el.setAttribute('data-level', tl);
    } })
    // ★ AI Citation Box — Codex 권장 (시세 요약 3줄 + 출처표 + 업데이트 + 신뢰등급)
    .on('[data-c-citation-1]', { element(el) {
      const tl = best?.trust_level;
      if (hasPrice && (tl === 'HIGH' || tl === 'MEDIUM' || tl === 'LOW')) {
        el.setInnerContent(`· cardpick.kr 기준 ${idLabel}의 현재 해외 참고가는 ₩${krw.toLocaleString('ko-KR')}입니다.`);
      } else {
        el.setInnerContent(`· ${idLabel}: 수집된 데이터 부족 — 참고가 산출 불가 (distinct 30일 표본 5건 미만)`);
      }
    } })
    .on('[data-c-citation-2]', { element(el) {
      const d7 = cm?.ext_change_7d_pct;
      const d30 = cm?.ext_change_30d_pct;
      const fmt = v => v == null ? '—' : (v >= 0 ? '+' : '') + Number(v).toFixed(1) + '%';
      el.setInnerContent(`· 7일 변동 ${fmt(d7)} / 30일 변동 ${fmt(d30)} (Cardmarket EU 평균 비교)`);
    } })
    .on('[data-c-citation-3]', { element(el) {
      const tl = best?.trust_level || 'NONE';
      const d30 = best?.distinct_30d || 0;
      const labels = { HIGH:'높음', MEDIUM:'중간', LOW:'낮음(표본 부족)', NONE:'산출 불가' };
      el.setInnerContent(`· 신뢰도 ${tl} (${labels[tl] || '—'}) · 30일 distinct 표본 ${d30}건 · 매일 새벽 5시 KST 갱신`);
    } })
    // 출처별 가격표
    .on('[data-c-src-tcg]', { element(el) {
      const usd = best?.latest_usd;
      if (best?.trust_level === 'NONE' || !usd) { el.setInnerContent('—'); return; }
      el.setInnerContent(`$${Number(usd).toFixed(2)} (raw)`);
    } })
    .on('[data-c-src-cm]', { element(el) {
      const eur = cm?.ext_avg_24h;
      if (!eur) { el.setInnerContent('—'); return; }
      el.setInnerContent(`€${Number(eur).toFixed(2)}`);
    } })
    .on('[data-c-src-ebay]', { element(el) {
      const v = card?.ebay_active_avg_krw;
      el.setInnerContent(v ? `₩${Math.round(Number(v)).toLocaleString('ko-KR')}` : '—');
    } })
    .on('[data-c-updated-at]', { element(el) {
      const t = best?.last_fetched_at;
      if (!t) { el.setInnerContent('—'); return; }
      try {
        const d = new Date(t);
        const yy = d.getFullYear(), mm = String(d.getMonth()+1).padStart(2,'0'), dd = String(d.getDate()).padStart(2,'0');
        el.setInnerContent(`${yy}.${mm}.${dd}`);
      } catch (e) { el.setInnerContent('—'); }
    } })
    .on('[data-c-trust-badge]', { element(el) {
      const tl = best?.trust_level || 'NONE';
      el.setInnerContent(tl);
      const colors = { HIGH:'#26E0C2', MEDIUM:'#7FB8FF', LOW:'#E0B84A', NONE:'#FF4D6D' };
      el.setAttribute('style', `color:${colors[tl] || '#FF4D6D'}`);
    } })
    .on('[data-c-trust-label]', { element(el) {
      const tl = best?.trust_level;
      const labels = {
        HIGH:   '신뢰도 높음 · 최근 거래 데이터',
        MEDIUM: '30일 중앙값 · 최근 거래 적음',
        LOW:    '⚠ 표본 부족 · 참고만',
        NONE:   '⚠ 산출 불가 · 데이터 부족',
      };
      el.setInnerContent(labels[tl] || '신뢰도: —');
    } })
    .on('[data-c-trust-basis]', { element(el) {
      const tl = best?.trust_level;
      const d7  = best?.distinct_7d  || 0;
      const d30 = best?.distinct_30d || 0;
      if (tl === 'HIGH')   el.setInnerContent(`최근 7일 표본 ${d7}건 + 30일 ${d30}건`);
      else if (tl === 'MEDIUM') el.setInnerContent(`30일 누적 ${d30}건 (7일은 ${d7}건)`);
      else if (tl === 'LOW') el.setInnerContent(`30일 표본 ${d30}건 — 부족`);
      else if (tl === 'NONE') el.setInnerContent(`수집 데이터 ${d30}건 미만`);
      else el.setInnerContent('');
    } })
    // FAQ — 카드 번호로 식별 (같은 이름 다른 번호 카드 차별화)
    .on('[data-c-faq-q1]',      { element(el) { el.setInnerContent(`${idLabel} 카드의 가격은 어디 기준인가요?`); } })
    .on('[data-c-faq-a1]',      { element(el) { el.setInnerContent(`TCGplayer 북미 market price 기준 해외 참고가입니다. 국내 거래가와 다를 수 있으며 카드 상태·언어·등급·배송비·환율에 따라 실제 거래가는 달라질 수 있습니다.`); } })
    .on('[data-c-faq-q2]',      { element(el) { el.setInnerContent(`${idLabel} 카드는 어디서 살 수 있나요?`); } })
    .on('[data-c-faq-a2]',      { element(el) { el.setInnerContent(`국내는 중고거래 플랫폼과 카드 전문몰에서, 해외는 일본 개인 마켓과 미국 카드 마켓에서 구할 수 있습니다.`); } })
    .on('[data-c-faq-q3]',      { element(el) { el.setInnerContent(`국내 거래가와 왜 다른가요?`); } })
    .on('[data-c-faq-a3]',      { element(el) { el.setInnerContent(`표시 가격은 TCGplayer 북미 시장의 market price이며, 국내 거래는 배송비·환율·관세·카드 상태·언어판·등급에 따라 가격이 달라집니다. 시점에 따라 한국 시세가 더 높거나 낮을 수 있어 참고용으로만 보세요.`); } })
    .on('[data-c-faq-q4]',      { element(el) { el.setInnerContent(`가품 구별 포인트는 무엇인가요?`); } })
    .on('[data-c-faq-a4]',      { element(el) { el.setInnerContent(`인쇄 결, 홀로 패턴, 모서리 절단면, 카드 뒷면 잉크 두께를 확인합니다. 확신이 어려우면 PSA·BGS 그레이딩을 통해 확정합니다.`); } })
    .on('[data-c-faq-q5]',      { element(el) { el.setInnerContent(`PSA 등급별 가격 차이가 큰가요?`); } })
    .on('[data-c-faq-a5]',      { element(el) { el.setInnerContent(`인기 카드는 PSA 10과 9 사이에 큰 차이가 나는 편입니다. 다만 표본이 적으면 가격이 불안정할 수 있습니다.`); } })
    .on('[data-c-faq-q6]',      { element(el) { el.setInnerContent(`같은 카드 다른 버전과 차이는 무엇인가요?`); } })
    .on('[data-c-faq-a6]',      { element(el) { el.setInnerContent(`홀로 처리, 일러스트 구성, 발매 세트에 따라 참고가가 다릅니다. 버전마다 일러스트 또는 인쇄가 다를 수 있습니다.`); } })
    .on('[data-c-faq-q7]',      { element(el) { el.setInnerContent(`${idLabel} 가격 알림은 어떻게 받나요?`); } })
    .on('[data-c-faq-a7]',      { element(el) { el.setInnerContent(`회원 가입 후 카드를 관심 목록에 추가하면 가격이 일정 비율 이상 변동할 때 알림을 받을 수 있습니다. (가격 알림 기능은 준비 중이며 단계적으로 공개됩니다.)`); } })
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
    // 표본 수 — 데이터 신뢰도 정직 노출 (samples_7d 기준)
    .on('[data-c-samples]',     { element(el) {
        const n = (best && Number(best.samples_7d)) || 0;
        el.setInnerContent(n > 0 ? `표본 ${n}건 (7일)` : '표본 수집 중');
    } })
    // eBay active listing 데이터 SSR (저신뢰 fallback / 정직 라벨 "현재 listing · sold 아님")
    .on('[data-c-ebay-avg]',    { element(el) {
        const v = card?.ebay_active_avg_krw;
        el.setInnerContent(v ? `₩${Math.round(Number(v)).toLocaleString('ko-KR')}` : '—');
    } })
    .on('[data-c-ebay-low]',    { element(el) {
        const v = card?.ebay_active_low_krw;
        el.setInnerContent(v ? `₩${Math.round(Number(v)).toLocaleString('ko-KR')}` : '—');
    } })
    .on('[data-c-ebay-count]',  { element(el) {
        const n = (card && Number(card.ebay_active_count)) || 0;
        el.setInnerContent(n > 0 ? `${n}건` : '—');
    } })
    .on('[data-c-ebay-fetched]',{ element(el) {
        const t = card?.ebay_last_fetched_at;
        if (!t) { el.setInnerContent('수집 전'); return; }
        try {
          const d = new Date(t);
          const yy = d.getFullYear(), mm = String(d.getMonth()+1).padStart(2,'0'), dd = String(d.getDate()).padStart(2,'0');
          el.setInnerContent(`${yy}.${mm}.${dd}`);
        } catch (e) { el.setInnerContent('—'); }
    } })
    // eBay 박스 — 저신뢰 카드 (TCGplayer 표본<2 OR 가격<₩1000) 일 때 강조 클래스 부여
    .on('[data-c-ebay-box]',    { element(el) {
        const lowTrust = !best || !best.samples_7d || Number(best.samples_7d) < 2 || (Number(best.latest_krw) || 0) < 1000;
        const hasEbay = !!(card && card.ebay_active_avg_krw);
        if (!hasEbay) {
          // eBay 데이터 없으면 박스 숨김
          el.setAttribute('class', (el.getAttribute('class') || '') + ' hidden');
        } else if (lowTrust) {
          // 저신뢰 — 강조 (warn 보더)
          el.setAttribute('data-low-trust', '1');
        }
    } })
    // 컨텍스트 추천 가이드 SSR — 카드 신호별 우선순위 분기
    .on('[data-c-guides-h2]', { element(el) { el.setInnerContent(_ctxTitle); } })
    .on('[data-c-guides-sub]', { element(el) { el.setInnerContent(_ctxSubText); } })
    .on('[data-c-context-guides]', {
      element(el) {
        el.setInnerContent(_ctxGuidesHtml, { html: true });
      }
    })
    // 관련 카드 SSR (외부 감사 P3 — 내부 링크 + 카드 페이지 발견)
    .on('ul#related-cards', {
      element(el) {
        if (!relatedCards.length) return;
        const items = relatedCards.map(rc => {
          const setBadge = rc.set_code && rc.set_code !== card.set_code
            ? `<span class="mono text-[10px] text-muted ml-2">${esc(rc.set_code)}</span>` : '';
          return `<li class="py-2.5 px-4 hover:bg-panel2">
            <a href="/cards/${encodeURIComponent(rc.slug)}" class="flex items-center justify-between gap-3">
              <span class="text-[13.5px] text-ink truncate">${esc(rc.name)}${rc.number ? ` <span class="mono text-[11px] text-muted">#${esc(rc.number)}</span>` : ''}${setBadge}</span>
              <span class="mono text-[10.5px] text-muted shrink-0">${esc(rc.rarity_class || '')}</span>
            </a>
          </li>`;
        }).join('');
        el.setInnerContent(items, { html: true });
      }
    })
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

        // FAQPage — 화면 FAQ와 일치하는 7문항 (카드 번호로 식별)
        const faqList = [
          { q: `${idLabel} 카드의 가격은 어디 기준인가요?`,
            a: `TCGplayer 북미 market price 기준 해외 참고가입니다. 국내 거래가와 다를 수 있으며 카드 상태·언어·등급·배송비·환율에 따라 실제 거래가는 달라질 수 있습니다.` },
          { q: `${idLabel} 카드는 어디서 살 수 있나요?`,
            a: `국내는 중고거래 플랫폼과 카드 전문몰에서, 해외는 일본 개인 마켓과 미국 카드 마켓에서 구할 수 있습니다.` },
          { q: `국내 거래가와 왜 다른가요?`,
            a: `표시 가격은 TCGplayer 북미 시장의 market price이며, 국내 거래는 배송비·환율·관세·카드 상태·언어판·등급에 따라 가격이 달라집니다. 시점에 따라 한국 시세가 더 높거나 낮을 수 있어 참고용으로만 보세요.` },
          { q: `가품 구별 포인트는 무엇인가요?`,
            a: `인쇄 결, 홀로 패턴, 모서리 절단면, 카드 뒷면 잉크 두께를 확인합니다. 확신이 어려우면 PSA·BGS 그레이딩을 통해 확정합니다.` },
          { q: `PSA 등급별 가격 차이가 큰가요?`,
            a: `인기 카드는 PSA 10과 9 사이에 큰 차이가 나는 편입니다. 다만 표본이 적으면 가격이 불안정할 수 있습니다.` },
          { q: `같은 카드 다른 버전과 차이는 무엇인가요?`,
            a: `홀로 처리, 일러스트 구성, 발매 세트에 따라 참고가가 다릅니다. 버전마다 일러스트 또는 인쇄가 다를 수 있습니다.` },
          { q: `${idLabel} 가격 알림은 어떻게 받나요?`,
            a: `회원 가입 후 카드를 관심 목록에 추가하면 가격이 일정 비율 이상 변동할 때 알림을 받을 수 있습니다. (가격 알림 기능은 준비 중이며 단계적으로 공개됩니다.)` }
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

        // ★ AggregateOffer — Codex 권장 (Q4 P1) — AI/검색이 가격 데이터 신호로 인식
        // Offer 단독 X, AggregateOffer로 다출처 가격 + priceSpecification 명시
        if (hasPrice && (best?.trust_level === 'HIGH' || best?.trust_level === 'MEDIUM' || best?.trust_level === 'LOW')) {
          // ★ Product 최상위 + offers 속성 (이전: AggregateOffer 최상위 + itemOffered Product
          //   → Google이 안쪽 Product를 "offers 없는 Product"로 보고 무효 처리. GSC 오류 수정 2026-06-03)
          const product = {
            "@context": "https://schema.org",
            "@type": "Product",
            "name": idLabel,
            "category": "Trading Card Game / Pokemon TCG",
            ...(setName ? { "isPartOf": { "@type":"CreativeWork", "name": setName } } : {}),
            ...(rarity ? { "additionalProperty": { "@type":"PropertyValue", "name":"rarity", "value": rarity } } : {}),
            "offers": {
              "@type": "AggregateOffer",
              "offerCount": Math.max(Number(best?.distinct_30d) || 1, 1),
              "lowPrice": Math.round(Number(best?.clean_30d_median_krw || krw) * 0.85),
              "highPrice": Math.round(Number(best?.clean_30d_median_krw || krw) * 1.15),
              "price": krw,
              "priceCurrency": "KRW",
              "availability": "https://schema.org/InStock",
              "url": canonical,
              "seller": { "@type": "Organization", "name": "TCGplayer (북미 시장)", "url": "https://www.tcgplayer.com" },
              "priceSpecification": {
                "@type": "PriceSpecification",
                "price": krw,
                "priceCurrency": "KRW",
                "valueAddedTaxIncluded": false,
                "description": `TCGplayer 북미 market price 기반, 매일 새벽 5시 KST 갱신, 신뢰도 ${best?.trust_level || 'NONE'}`
              }
            }
          };
          el.append(`\n<script type="application/ld+json">${JSON.stringify(product)}</script>`, { html: true });
        }

        // Dataset — 가격 데이터 출처·갱신 주기 명시 (AEO 강화)
        if (hasPrice) {
          const lastFetched = best?.last_fetched_at ? String(best.last_fetched_at).slice(0, 10) : null;
          const dataset = {
            "@context": "https://schema.org",
            "@type": "Dataset",
            "name": `${idLabel} 해외 참고가 데이터`,
            "description": `${idLabel} 카드의 TCGplayer 북미 기준 해외 참고가 (USD market price → KRW 환산). 매일 1회 자동 갱신.`,
            "url": canonical,
            "creator": { "@type": "Organization", "name": "카드픽", "url": "https://cardpick.kr/" },
            "license": "https://cardpick.kr/license",
            "isAccessibleForFree": true,
            ...(lastFetched ? { "dateModified": lastFetched } : {}),
            "variableMeasured": [
              { "@type": "PropertyValue", "name": "latest_krw", "description": "현재 해외 참고가 (KRW 환산)", "unitText": "KRW", "value": krw },
              { "@type": "PropertyValue", "name": "latest_usd", "description": "TCGplayer market price (USD)", "unitText": "USD", "value": Number(best.latest_usd) || null },
              ...(card?.ebay_active_avg_krw ? [
                { "@type": "PropertyValue", "name": "ebay_active_avg_krw", "description": "eBay US active listing 평균가 (KRW 환산, sold 아님)", "unitText": "KRW", "value": Math.round(Number(card.ebay_active_avg_krw)) },
                { "@type": "PropertyValue", "name": "ebay_active_low_krw", "description": "eBay US active listing 최저가 (KRW 환산)", "unitText": "KRW", "value": Math.round(Number(card.ebay_active_low_krw || 0)) || null },
                { "@type": "PropertyValue", "name": "ebay_active_count", "description": "eBay US active listing 표본수", "value": Number(card.ebay_active_count) || 0 }
              ] : [])
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

  // Fix#2 (Codex 권장): HTMLRewriter 변환 단계 try/catch — 실패 시 정적 fallback
  try {
    const transformed = rewriter.transform(new Response(tplRes.body, tplRes));
    const resp = new Response(transformed.body, {
      status: 200,
      headers: {
        'Content-Type': 'text/html; charset=utf-8',
        'Cache-Control': 'public, s-maxage=600, stale-while-revalidate=120',
        'X-Cardpick-SSR': 'cards/' + slug,
        'X-Edge-Cache': 'MISS'
      }
    });
    context.waitUntil(edgeCache.put(cacheKey, resp.clone()));
    return resp;
  } catch (e) {
    // 변환 실패 → 정적 템플릿 그대로 응답 (JS가 클라이언트에서 카드 데이터 fetch함, 화면 깨지지 않음)
    console.warn('HTMLRewriter transform failed:', e && e.message);
    return new Response(tplRes.body, {
      status: 200,
      headers: {
        'Content-Type': 'text/html; charset=utf-8',
        'Cache-Control': 'public, s-maxage=60',
        'X-Cardpick-SSR': 'cards/' + slug + '/fallback'
      }
    });
  }
}
