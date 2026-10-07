// /cards/<slug> SSR — 정적 card-detail.html 템플릿을 HTMLRewriter로 변환
import { buildCardPriceDisplay, createJsonDeadline, validateSummaryRows, validateTrustRows, CARD_PRICE_FIELDS } from '../_lib/card-price-display.js';

export async function onRequest(context) {
  const { request, env, params } = context;
  // Fix#1 (Codex 권장): slug에 특수문자가 있으면 정규 slug로 301 (조용한 변환 → canonical 불일치 방지)
  // ★ 2026-07-19: toLowerCase 제거 — DB 슬러그에 대문자 존재(umbreon-H30 등). 소문자화가 조회 실패 → 홈 SSR 링크 404 유발했음.
  //   대소문자 어긋난 요청은 아래 not-found fallback의 ilike 조회로 정규 슬러그에 301.
  const slugRaw = String(params.slug || '');
  const slug = slugRaw.replace(/[^a-zA-Z0-9\-_]/g, '');
  if (!slug) return new Response('Not Found', { status: 404 });
  if (slug !== slugRaw) {
    return Response.redirect(`https://cardpick.kr/cards/${slug}`, 301);
  }

  const SUPA = 'https://aqxrmdratnkffvivguqs.supabase.co';
  const KEY = 'sb_publishable_AeDBjfn3ymozGyw06ohMUw_S6n1-qpj';

  const upstream = createJsonDeadline({ fetchImpl: fetch });
  const readRows = url => upstream.fetchJson(url, { headers: { apikey: KEY } });
  const unavailable = () => new Response('카드 정보를 일시적으로 조회할 수 없습니다. 잠시 후 다시 확인해 주세요.', {
    status: 503,
    headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store, max-age=0', 'Retry-After': '60' }
  });
  try {
  // 0) 구형 slug → 실제 slug 301 매핑
  const SLUG_REMAP = {
    'charizard-ex-sar':  'charizard-ex-sv3-223',
    'sv4a-zard-sar':     'charizard-ex-sv3-223',
    'mirai-don-ex-sar':  'miraidon-ex-sv1-244',
    'miraidon-ex-sar':   'miraidon-ex-sv1-244',
    'koraidon-ex-sar':   'koraidon-ex-sv1-247',
    'pikachu-ex-sar':    'pikachu-ex-sv8-238',
    // Search Console 2026-09-21: 같은 BLK #28 카드의 구형 전체번호 slug를 정규 slug로 통합
    'kyurem-ex-028086':  'kyurem-ex-28'
  };
  if (SLUG_REMAP[slug]) {
    return Response.redirect(`https://cardpick.kr/cards/${SLUG_REMAP[slug]}`, 301);
  }

  // ★ P0-C: malformed slug ('name--NNNNNN-NNNNNN' or 'name---NNNNNN-NNNNNN') 감지 → clean slug 있으면 301.
  //   ex) caterpie---010165-010165 → caterpie-10 (dash 3개, 초기 seed 사고)
  //   ex) mimikyu--160091-160091   → mimikyu-160  (dash 2개, 2026-08-27 진단으로 발견)
  //   DB에 두 슬러그 모두 존재하는 경우, clean 을 canonical로 통합해 중복 콘텐츠 신호 제거.
  //   ★ 캐시 조회 전에 처리해야 함 (301은 캐시 대상 아님).
  //   ★ 정상 slug 는 dash 1개만 사용(slugify가 multi-dash collapse) → -{2,} 는 malformed 지표.
  const uglyMatch = slug.match(/^(.+?)-{2,}\d+-\d+$/);
  if (uglyMatch) {
    const stem = uglyMatch[1];  // 'caterpie', 'umbreon-ex', 'mimikyu' 등
    // ugly 마지막 숫자 그룹 뒤 6자리 or ugly에서 인쇄번호 추정: '---010165-010165' → '10' (앞 3자리 leading zero 제거)
    const numTail = slug.match(/-{2,}(\d{3,})-\d+$/);
    let cleanCandidates = [];
    if (numTail) {
      const raw = numTail[1];
      // raw='010165'이면 앞 3자리(010)가 인쇄번호일 가능성 큼. leading zero 제거.
      const printedNum = String(parseInt(raw.slice(0, raw.length >> 1) || raw.slice(0, 3), 10) || raw);
      cleanCandidates.push(`${stem}-${printedNum}`);
      // 안전망: 첫 1~3자리로도 시도
      for (let n = 1; n <= 3; n++) {
        const p = String(parseInt(raw.slice(0, n), 10) || 0);
        if (p !== '0' && !cleanCandidates.includes(`${stem}-${p}`)) cleanCandidates.push(`${stem}-${p}`);
      }
    }
    for (const cand of cleanCandidates) {
      try {
        const arr = await readRows(`${SUPA}/rest/v1/cards?select=slug,name&game=eq.pokemon&slug=eq.${encodeURIComponent(cand)}&limit=1`);
        if (arr[0]) return Response.redirect(`https://cardpick.kr/cards/${cand}`, 301);
      } catch (e) { /* try next */ }
    }
    // clean 후보가 DB에 없으면 self-canonical 유지하되 noindex로 (검색에서 중복 노출 방지)
    // (이 케이스는 SSR 응답에서 robots를 noindex로 설정하도록 아래 로직에서 처리)
  }

  // ★ 엣지 캐시 (Cache API) — Pages Function은 헤더만으론 캐시 안 됨
  // Local previews must reflect file edits; production keeps the same edge cache.
  const isLocalPreview = ['localhost', '127.0.0.1', '[::1]'].includes(new URL(request.url).hostname);
  const edgeCache = isLocalPreview ? null : globalThis.caches?.default;
  const cacheKey = new Request(`https://cardpick.kr/__card_ssr_v30_deferred_ui/${slug}`, { method: 'GET' });
  let cachedResp;
  try { cachedResp = await edgeCache?.match(cacheKey); } catch { /* 캐시 장애와 카드 존재 여부는 별개다. */ }
  if (cachedResp) { const h = new Headers(cachedResp.headers); h.set('X-Edge-Cache','HIT'); return new Response(cachedResp.body, { status: cachedResp.status, headers: h }); }

  // 새 메타 컬럼 배포 전후를 모두 지원한다. 확장 SELECT가 실패하면 기존 컬럼으로 즉시 폴백한다.
  async function fetchCardMeta() {
    const baseFields = 'slug,name,name_ko,game,set_code,set_name,number,rarity,rarity_class,type,artist,ebay_active_avg_krw,ebay_active_low_krw,ebay_active_count,ebay_last_fetched_at';
    try {
      return await readRows(`${SUPA}/rest/v1/cards?select=${baseFields},hp,supertype,subtypes&slug=eq.${encodeURIComponent(slug)}&limit=1`);
    } catch (error) {
      if (error.status !== 400) throw error;
      return readRows(`${SUPA}/rest/v1/cards?select=${baseFields}&slug=eq.${encodeURIComponent(slug)}&limit=1`);
    }
  }

  // 1) 카드 메타 + summary + cardmarket + trust 병렬 fetch
  let card = null, best = null, cm = null, trust = null;
  try {
    const [cards, summaries, market, trusts] = await Promise.all([
      fetchCardMeta(),
      readRows(`${SUPA}/rest/v1/card_price_summary_best?card_slug=eq.${encodeURIComponent(slug)}&limit=1`).then(rows => validateSummaryRows(rows, slug)),
      readRows(`${SUPA}/rest/v1/price_metrics_external?card_slug=eq.${encodeURIComponent(slug)}&source=eq.pokemontcg-cardmarket&limit=1`).catch(() => []),
      // ★ Trust MV — distinct count + MAD + 4-tier (Codex 검수)
      readRows(`${SUPA}/rest/v1/card_price_trust?card_slug=eq.${encodeURIComponent(slug)}&limit=1`).then(validateTrustRows)
    ]);
    if (cards.length > 1 || cards.some(row => !row || row.slug !== slug || typeof row.name !== 'string' || !row.name.trim() || !row.game)) return unavailable();
    card = cards[0] || null;
    best = summaries[0] || null;
    cm = market[0] || null;
    trust = trusts[0] || null;
  } catch { return unavailable(); }

  // 원본 스냅샷은 변경하지 않고 API와 동일한 표시 계약을 만든다.
  const priceDisplay = buildCardPriceDisplay(best, trust);
  best = best ? {
    ...best,
    ...(priceDisplay.basis === 'unavailable' ? Object.fromEntries(CARD_PRICE_FIELDS.map(key => [key, null])) : {}),
    latest_krw: priceDisplay.amountKrw,
    latest_usd: priceDisplay.sourceUsd,
    trust_level: priceDisplay.trustLevel,
    distinct_7d: trust?.distinct_7d ?? 0,
    distinct_30d: trust?.distinct_30d ?? 0,
    clean_30d_n: trust?.clean_30d_n ?? 0,
    clean_30d_median_krw: priceDisplay.basis === 'unavailable' ? null : (trust?.clean_30d_median_krw ?? null),
    price_display: priceDisplay
  } : null;

  // 1.5) 관련 카드 fetch (외부 감사 P3 — 같은 세트 + 같은 이름 + 같은 레어도)
  let relatedCards = [];
  if (card && card.game === 'pokemon') {
    try {
      const baseName = (card.name || '').split(' ').slice(0, 2).join(' '); // "Mew ex" 같은 base
      const rarityForRel = (card.rarity_class || card.rarity || '').trim();
      const [setRows, nameRows, rarityRows] = await Promise.all([
        // 같은 세트의 다른 카드 6
        card.set_code ? readRows(`${SUPA}/rest/v1/cards?select=slug,name,number,rarity_class&game=eq.pokemon&set_code=eq.${encodeURIComponent(card.set_code)}&slug=neq.${encodeURIComponent(slug)}&limit=6`).catch(() => []) : [],
        // 같은 이름(base) 다른 번호 3
        baseName ? readRows(`${SUPA}/rest/v1/cards?select=slug,name,number,set_code,rarity_class&game=eq.pokemon&name=ilike.${encodeURIComponent(baseName + '%')}&slug=neq.${encodeURIComponent(slug)}&limit=3`).catch(() => []) : [],
        // 같은 레어도 3 (인기 우선)
        rarityForRel ? readRows(`${SUPA}/rest/v1/cards?select=slug,name,number,set_code,rarity_class,popularity_rank&game=eq.pokemon&rarity_class=eq.${encodeURIComponent(rarityForRel)}&slug=neq.${encodeURIComponent(slug)}&order=popularity_rank.asc.nullslast&limit=3`).catch(() => []) : []
      ]);
      const seen = new Set();
      if (setRows.length) {
        for (const c of setRows) {
          if (seen.has(c.slug)) continue;
          seen.add(c.slug);
          relatedCards.push({ ...c, _rel: 'set' });
        }
      }
      if (nameRows.length) {
        for (const c of nameRows) {
          if (seen.has(c.slug)) continue;
          seen.add(c.slug);
          relatedCards.push({ ...c, _rel: 'name' });
        }
      }
      if (rarityRows.length) {
        for (const c of rarityRows) {
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
    let aliasLookupFailed = false;
    // Fallback 1: 'name-num-num' 같이 끝 숫자 반복 패턴 → 'name-num'으로 시도
    // (옛 카드 slug 'seaking-21' vs 신규 카드 slug 패턴 'mew-ex---232091-232091' 충돌 보정)
    const candidates = [];
    const m1 = slug.match(/^(.+?)-(\d+)-\2$/);
    if (m1) candidates.push(`${m1[1]}-${m1[2]}`);
    // Fallback 2: 연속 hyphen('--' 이상) → '-' 단일로 압축 시도
    if (/-{2,}/.test(slug)) candidates.push(slug.replace(/-{2,}/g, '-'));
    // Fallback 3: 끝 '-숫자숫자-숫자숫자' (예: 232091-232091) → 한쪽 제거
    const m2 = slug.match(/^(.+)-([0-9]+)-\2$/);
    if (m2 && !candidates.includes(`${m2[1]}-${m2[2]}`)) candidates.push(`${m2[1]}-${m2[2]}`);
    for (const alt of candidates) {
      try {
        const arr = await readRows(`${SUPA}/rest/v1/cards?select=slug&game=eq.pokemon&slug=eq.${encodeURIComponent(alt)}&limit=1`);
        if (arr[0]) return Response.redirect(`https://cardpick.kr/cards/${alt}`, 301);
      } catch { aliasLookupFailed = true; }
    }
    // Fallback 4: 대소문자 무시 조회 (ilike, % 없이 = case-insensitive 정확 일치)
    // 예: /cards/umbreon-h30 요청 → DB 'umbreon-H30' 발견 → 정규 슬러그로 301
    try {
      const arr = await readRows(`${SUPA}/rest/v1/cards?select=slug&game=eq.pokemon&slug=ilike.${encodeURIComponent(slug)}&limit=1`);
      if (arr[0] && arr[0].slug !== slug) return Response.redirect(`https://cardpick.kr/cards/${arr[0].slug}`, 301);
    } catch { aliasLookupFailed = true; }
    if (aliasLookupFailed) return unavailable();
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
  // 공식 한국명이 원본 카드 테이블에 아직 비어 있는 GSC 실노출 카드만 편집 검수값으로 보완한다.
  const REVIEWED_KO_ALIASES = { 'phanpy-205': '코코리' };
  const nameKo = card?.name_ko || REVIEWED_KO_ALIASES[slug] || '';
  const setName = card?.set_name || (card?.set_code || '').toUpperCase();
  const rarity = card?.rarity_class || card?.rarity || '';
  // 중앙값과 최신 USD를 섞어 환율을 역산하지 않는다.
  const krw = priceDisplay.amountKrw;
  // ★ SSR 완성도 (P0-E): 초기 HTML에 가격 즉시 렌더 (JS 대기 없이 크롤러 완전 콘텐츠 확인)
  const heroPriceText = priceDisplay.priceText;
  const heroSecondaryText = priceDisplay.secondaryText;
  const lastFetched = priceDisplay.sourceDate;
  const heroUpdatedText = lastFetched
    ? lastFetched.slice(0, 10).replace(/-/g, '.')
    : '—';

  const hasPrice = krw !== null;
  const number = card?.number || '';
  // ★ 색인 정책 강화 (브리핑 #3, 2026-07 활성): "고유 데이터 충분" 카드만 index.
  //   HIGH(distinct_7d>=5 + ratio gate = 표본·이력·신뢰 충분) + 세트·번호 완비만 색인.
  //   MEDIUM/LOW/NONE·무데이터·번호결측은 noindex(검색 기능 전용). sitemap-cards(HIGH-only)와 일치.
  //   저품질 대량 색인 축소 + "얇은 페이지 안 민다" 품질 신호.
  // ★ P0-C·F: malformed slug ('---NNN-NNN') 는 clean 후보 없이 여기 도달한 경우 = 진짜 유니크 카드.
  //   그래도 slug 자체가 SEO 부적합(중복 판정 리스크)이라 색인 제외.
  const isUglySlug = /^.+?---\d+-\d+$/.test(slug);
  // ★ P0-F (2026-08-18): 색인 게이트 강화 (v2).
  //   Trust HIGH || MEDIUM 모두 허용 (LOW/NONE 은 경고 상태라 제외).
  //   추가 필터: 한국어 이름 매핑 있음 (편집 가치) OR 유의미 가격 (krw >= 5,000).
  //   → charizard-ex-215 (MEDIUM ₩30k + name_ko), samurott-107 (MEDIUM ₩73k) 등
  //     실제 사용자 관심 카드가 MEDIUM 이라도 index 되도록 조정.
  //   MEDIUM 은 display_krw = clean_30d_median_krw (30일 중앙값 근사) 라 신뢰 수준 충분.
  const hasKorean = !!(card?.name_ko && String(card.name_ko).trim());
  const isValuable = (krw || 0) >= 5000;
  const trustOK = best?.trust_level === 'HIGH' || best?.trust_level === 'MEDIUM';
  const indexable = hasPrice
    && trustOK
    && !!number && !!setName
    && !isUglySlug
    && (hasKorean || isValuable);
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
    ? `${nameKo ? `${nameKo} (${name})` : name} ${numShort} 시세 가격. ${setName ? setName + ' ' : ''}${rarityAbbr ? rarityAbbr + ' ' : ''}${priceDisplay.label} ${priceDisplay.priceText}. ${priceDisplay.sourceDescription} 신뢰도 ${priceDisplay.trustLevel}. 국내 거래가와 다를 수 있습니다.`
    : `${nameKo ? `${nameKo} (${name})` : name} ${numShort} 카드 정보${setName ? ' · ' + setName : ''}${rarity ? ' · ' + rarity : ''}. 해외 참고가는 수집 후 표시됩니다.`;
  const canonical = `https://cardpick.kr/cards/${slug}`;

  function esc(s){ return String(s||'').replace(/[<>&"]/g, c => ({'<':'&lt;','>':'&gt;','&':'&amp;','"':'&quot;'}[c])); }

  // 본문 SSR — 한국어 별칭 우선, 영문 괄호 + #number
  const displayName = nameKo ? `${nameKo} (${name}) ${numShort}`.trim() : idLabel;
  const subtitle = [setName, rarity].filter(Boolean).join(' · ');

  const TYPE_KR = {
    'Grass':'풀', 'Fire':'불꽃', 'Water':'물', 'Lightning':'번개',
    'Psychic':'초', 'Fighting':'격투', 'Darkness':'악',
    'Metal':'강철', 'Dragon':'드래곤', 'Fairy':'페어리', 'Colorless':'무색'
  };
  const _typeStr = card?.type ? (TYPE_KR[String(card.type).trim()] || String(card.type).trim()) : null;
  const _supertype = String(card?.supertype || '').trim();
  const _isPokemon = _supertype === 'Pokémon' || _supertype === 'Pokemon' || (!_supertype && !!_typeStr);
  const SUPERTYPE_KR = { 'Pokémon':'포켓몬', 'Pokemon':'포켓몬', 'Trainer':'트레이너', 'Energy':'에너지' };
  const _supertypeLabel = SUPERTYPE_KR[_supertype] || _supertype;
  const priceSentence = hasPrice
    ? `${displayName}의 ${priceDisplay.label}는 ${priceDisplay.priceText}입니다. 국내 거래가와 다를 수 있습니다.`
    : `${displayName}: ${priceDisplay.unavailableText}`;
  const aboutText = `${displayName} 카드 정보입니다. ${setName}${number ? ` · ${number}번` : ''}. ${hasPrice ? `${priceDisplay.label} ${priceDisplay.priceText}.` : priceDisplay.unavailableText} 국내 거래가와 다를 수 있습니다.`;
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
    _ctxTitle = '그레이딩을 고려한다면 — 상태·비용·거래 안전';
    _ctxSubText = '센터링·모서리·표면 상태와 발송 비용을 함께 확인하세요. 사전 점검만으로 실제 등급이나 판매가격을 보장할 수는 없습니다.';
  } else if (_ctxIsHighValue) {
    _ctxOrder = ['psa10','psa','safety'];
    _ctxTitle = '그레이딩을 고려한다면 — 상태·비용·거래 안전';
    _ctxSubText = '센터링·모서리·표면 상태와 발송 비용을 함께 확인하세요. 사전 점검만으로 실제 등급이나 판매가격을 보장할 수는 없습니다.';
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

  // 상위 검색 후보 중 사람이 메타데이터를 대조한 카드만 노출하는 검수 메모.
  // 전 카드에 같은 문단을 복제하지 않고, 세트·번호·레어도를 혼동하기 쉬운 10장으로 한정한다.
  const REVIEWED_CARD_NOTES = {
    'phanpy-205': {
      compare: '이 페이지는 Surging Sparks의 SSP · #205 · Illustration Rare입니다. 같은 세트의 Phanpy #102 Common과 이름이 같으므로 카드 번호 205와 레어도를 함께 확인하세요.'
    },
    'kyurem-ex-28': {
      compare: 'Black Bolt의 BLK · #28 · Double Rare입니다. 카드에 적힌 전체 번호 028/086과 짧은 번호 #28은 같은 카드이며, #157 Ultra Rare와 #165 Special Illustration Rare는 별도 수록판입니다.'
    },
    'umbreon-ex-161': {
      compare: 'Prismatic Evolutions에는 여러 이브이 진화형 ex 카드가 함께 수록됩니다. 블래키라는 이름만 보지 말고 PRE · #161 · Special Illustration Rare 조합을 맞춰 비교하세요.'
    },
    'pikachu-with-grey-felt-hat-85': {
      compare: '확장팩 수록 카드가 아니라 Scarlet & Violet Black Star Promos의 PR-SV · #85 프로모입니다. 일반 피카츄 수록 카드와 가격군을 섞지 않는 것이 중요합니다.'
    },
    'mew-ex-232': {
      compare: 'Mew ex는 같은 이름의 다른 수록판이 많습니다. 이 페이지는 Paldean Fates의 PAF · #232 · Special Illustration Rare만 다룹니다.'
    },
    'giratina-v-186': {
      compare: '이 페이지의 대상은 Lost Origin의 LOR · #186 · Rare Ultra입니다. Giratina V라는 이름이 같아도 세트와 카드 번호가 다르면 별도 카드입니다.'
    },
    'mega-charizard-x-ex-125': {
      compare: 'Mega Charizard X ex 중에서도 Phantasmal Flames의 PFL · #125 · Special Illustration Rare입니다. 이름 검색 결과만으로 비교하지 말고 세트 코드와 번호를 함께 확인하세요.'
    },
    'victini-171': {
      compare: 'Black Bolt의 BLK · #171 · Rare 카드입니다. Victini ex나 다른 세트의 Victini와 구분해 같은 수록판끼리 비교해야 합니다.'
    },
    'zekrom-ex-172': {
      compare: 'Black Bolt의 BLK · #172 · Black White Rare입니다. 다른 Zekrom ex 수록판이나 레어도와 섞이지 않도록 번호와 레어도를 함께 확인하세요.'
    },
    'sylveon-ex-156': {
      compare: 'Prismatic Evolutions의 PRE · #156 · Special Illustration Rare이며 Tera·Stage 1 카드입니다. 같은 세트의 다른 이브이 진화형과 비교할 때도 카드 번호를 기준으로 구분하세요.'
    },
    'lugia-v-186': {
      compare: 'Silver Tempest의 SIT · #186 · Rare Ultra입니다. Lugia V라는 이름이 같은 다른 번호의 수록판과 분리해 가격을 확인하세요.'
    },
    'reshiram-ex-173': {
      compare: 'White Flare의 WHT · #173 · Black White Rare입니다. 다른 Reshiram ex와 비교할 때 세트 코드 WHT와 카드 번호 173을 먼저 맞추세요.'
    }
  };
  const reviewedNote = REVIEWED_CARD_NOTES[slug] || null;
  const reviewedIdentity = [
    setName ? `${setName} (${card?.set_code || '—'})` : '',
    number ? `#${number}` : '',
    rarity || '',
    card?.artist ? `일러스트 ${card.artist}` : ''
  ].filter(Boolean).join(' · ');
  const reviewedCondition = '이 페이지의 참고가는 등급이 없는 raw 카드 기준입니다. 카드 상태와 언어가 다르면 같은 번호라도 거래 가격이 달라질 수 있으니 실물 사진과 표기를 확인하세요.';

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
    .on('meta[name="robots"]',             { element(el) { el.setAttribute('content', indexable ? 'index,follow,max-image-preview:large,max-snippet:-1' : 'noindex,follow'); } })
    // ★ P0-E: Hero 가격 SSR — 초기 HTML에 가격/환율/갱신일 완성. JS는 후속 갱신만.
    //   크롤러가 JS 대기 없이 완전한 콘텐츠 확인 (Google SEO + AdSense 리뷰어).
    .on('#hero-price',     { element(el) { el.setInnerContent(heroPriceText); } })
    .on('#hero-price-label', { element(el) { el.setInnerContent(priceDisplay.label); } })
    .on('#hero-secondary', { element(el) { el.setInnerContent(heroSecondaryText); } })
    .on('#hero-updated',   { element(el) { el.setInnerContent(heroUpdatedText); } })
    .on('#hero-judgement', { element(el) { el.setInnerContent(priceSentence); } })
    .on('#pricing-fx',     { element(el) { el.setInnerContent('별도 환율값 미제공'); } })
    .on('#pricing-basis',  { element(el) { el.setInnerContent(priceDisplay.label); } })
    .on('#trust-none-banner', { element(el) { if (!hasPrice) el.setAttribute('class', (el.getAttribute('class') || '').replace(/\bhidden\b/g, '')); } })
    .on('[data-c-unavailable]', { element(el) { el.setInnerContent(priceDisplay.unavailableText); } })
    // 본문 SSR (data-c-* 앵커)
    .on('[data-c-name]',        { element(el) { el.setInnerContent(el.tagName === 'li' ? name : displayName); } })
    .on('[data-c-subtitle]',    { element(el) { el.setInnerContent(subtitle); } })
    .on('[data-c-h1-full]',     { element(el) { el.setInnerContent(`${displayName} ${hasPrice ? '시세 가격' : '카드 정보'}`); } })
    .on('[data-c-h1-lede]',     { element(el) {
      el.setInnerContent(priceSentence);
    } })
    // Trust level SSR 라벨 (HIGH/MEDIUM/LOW/NONE)
    .on('[data-c-trust-level]', { element(el) {
      const tl = best?.trust_level || 'NONE';
      el.setInnerContent(tl);
      el.setAttribute('data-level', tl);
    } })
    // ★ AI Citation Box — Codex 권장 (시세 요약 3줄 + 출처표 + 업데이트 + 신뢰등급)
    .on('[data-c-citation-1]', { element(el) {
      el.setInnerContent(`· ${priceSentence}`);
    } })
    .on('[data-c-citation-2]', { element(el) {
      const parts = [];
      if (setName) parts.push(`${setName} 세트`);
      if (number) parts.push(`${number}번`);
      if (rarityAbbr) parts.push(rarityAbbr);
      el.setInnerContent(`· ${parts.join(' ') || '포켓몬 카드'} (영문판)`);
    } })
    .on('[data-c-citation-3]', { element(el) {
      el.setInnerContent(`· ${priceDisplay.trustText} · ${priceDisplay.basisText}`);
    } })
    .on('[data-c-citation-4]', { element(el) {
      el.setInnerContent(`· 가격 기준: ${priceDisplay.sourceDescription} · PSA 등급 미반영 (Raw 카드 기준)`);
    } })
    // 출처별 가격표
    .on('[data-c-src-tcg]', { element(el) {
      const usd = best?.latest_usd;
      if (best?.trust_level === 'NONE' || !usd) { el.setInnerContent('—'); return; }
      el.setInnerContent(`$${Number(usd).toFixed(2)} (raw)`);
    } })
    .on('[data-c-src-cm]', { element(el) {
      const rawEur = cm?.ext_avg_24h;
      const eur = typeof rawEur === 'number' || typeof rawEur === 'string' ? Number(rawEur) : null;
      if (!Number.isFinite(eur) || eur <= 0) { el.setInnerContent('—'); return; }
      el.setInnerContent(`€${eur.toFixed(2)}`);
    } })
    .on('[data-c-src-ebay]', { element(el) {
      const v = card?.ebay_active_avg_krw;
      el.setInnerContent(v ? `₩${Math.round(Number(v)).toLocaleString('ko-KR')}` : '—');
    } })
    .on('[data-c-updated-at]', { element(el) {
      el.setInnerContent(priceDisplay.sourceDate ? priceDisplay.sourceDate.slice(0, 10).replace(/-/g, '.') : '—');
    } })
    .on('[data-c-trust-badge]', { element(el) {
      const tl = best?.trust_level || 'NONE';
      el.setInnerContent(tl);
      const colors = { HIGH:'#26E0C2', MEDIUM:'#7FB8FF', LOW:'#E0B84A', NONE:'#FF4D6D' };
      el.setAttribute('style', `color:${colors[tl] || '#FF4D6D'}`);
    } })
    .on('[data-c-trust-label]', { element(el) {
      el.setInnerContent(priceDisplay.trustText);
    } })
    .on('[data-c-trust-basis]', { element(el) {
      el.setInnerContent(priceDisplay.basisText);
    } })
    // 포켓몬 타입은 포켓몬 카드에만 표시한다. 트레이너·에너지는 카드 분류로 구분한다.
    .on('[data-c-type]', { element(el) {
      el.setInnerContent(_typeStr || '');
    } })
    .on('[data-c-type-row]', { element(el) { if (!_isPokemon || !_typeStr) el.remove(); } })
    .on('[data-c-hp]', { element(el) { el.setInnerContent(card?.hp ? `${card.hp} HP` : ''); } })
    .on('[data-c-hp-row]', { element(el) { if (!card?.hp) el.remove(); } })
    .on('[data-c-card-class]', { element(el) { el.setInnerContent(_supertypeLabel || ''); } })
    .on('[data-c-card-class-row]', { element(el) { if (!_supertypeLabel) el.remove(); } })
    .on('[data-c-artist]', { element(el) { el.setInnerContent(card?.artist || '—'); } })
    .on('[data-c-set-code-jp]', { element(el) { el.setInnerContent(card?.set_code || '—'); } })
    .on('[data-c-info-h2]',     { element(el) { el.setInnerContent(`${name} 카드 정보`); } })
    .on('[data-c-about]',       { element(el) { el.setInnerContent(aboutText); } })
    .on('[data-c-game-chip]',   { element(el) { el.setInnerContent(gameLabel); } })
    .on('[data-c-rarity-chip]', { element(el) { el.setInnerContent(rarity || '—'); } })
    // Match the hydrated chip from the first paint; full set name remains in the subtitle.
    .on('[data-c-set-chip]',    { element(el) { el.setInnerContent((card?.set_code || '—') + (card?.game === 'pokemon' ? ' · 영문판' : '')); } })
    .on('[data-c-set-en]',      { element(el) { el.setInnerContent(setName); } })
    .on('[data-c-set-en-short]',{ element(el) { el.setInnerContent(setName); } })
    .on('[data-c-set-jp]',      { element(el) { el.setInnerContent(setName); } })
    .on('[data-c-set-link]',    { element(el) { el.setInnerContent(setName); } })
    .on('[data-c-name-en]',     { element(el) { el.setInnerContent(name); } })
    .on('[data-c-number]',      { element(el) { el.setInnerContent(card?.number || '—'); } })
    .on('[data-c-rarity-full]', { element(el) { el.setInnerContent(rarity || '—'); } })
    .on('[data-c-game-name]',   { element(el) { el.setInnerContent(gameLabel + ' 카드 게임'); } })
    // 신뢰도 판정에 사용한 distinct 관측 수. 실제 판매 건수와 구분한다.
    .on('[data-c-samples]',     { element(el) {
        el.setInnerContent(priceDisplay.samplesText);
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
        const lowTrust = priceDisplay.trustLevel === 'LOW' || priceDisplay.trustLevel === 'NONE';
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
    // 검수 완료 10장에만 카드별 식별·가격 해석 블록 노출
    .on('[data-c-reviewed-section]', { element(el) {
      if (!reviewedNote) { el.remove(); return; }
      el.removeAttribute('hidden');
    } })
    .on('[data-c-reviewed-title]', { element(el) { if (reviewedNote) el.setInnerContent(`${displayName} 확인 포인트`); } })
    .on('[data-c-reviewed-identity]', { element(el) { if (reviewedNote) el.setInnerContent(reviewedIdentity); } })
    .on('[data-c-reviewed-price]', { element(el) { if (reviewedNote) el.setInnerContent(priceDisplay.reviewedPriceText); } })
    .on('[data-c-reviewed-compare]', { element(el) { if (reviewedNote) el.setInnerContent(reviewedNote.compare); } })
    .on('[data-c-reviewed-condition]', { element(el) { if (reviewedNote) el.setInnerContent(reviewedCondition); } })
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
        const browserCard = card ? { ...card, name_ko: nameKo || card.name_ko || '' } : {};
        const scriptJson = value => JSON.stringify(value).replace(/</g, '\\u003c');
        el.append(`\n<script>window.CARDPICK_SLUG=${scriptJson(slug)};window.CARDPICK_CARD=${scriptJson(browserCard)};window.CARDPICK_BEST=${scriptJson(best)};window.CARDPICK_PRICE_DISPLAY=${scriptJson(priceDisplay)};</script>`, { html: true });

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

        // ★ Product/Offer/AggregateOffer 제거 (2026-07 정책 정비):
        //   카드픽은 카드를 판매하지 않고 "해외 참고가"만 제공한다. Product+Offer+availability:InStock +
        //   조작된 lowPrice/highPrice(±15%)는 판매 상품을 사칭하는 구조화데이터 오용(Google 정책 위반 + §4).
        //   가격 데이터는 아래 Dataset 스키마로만 표현한다(참고 데이터에 올바른 타입).

        // Dataset — 가격 데이터 출처·갱신 주기 명시 (AEO 강화)
        if (hasPrice) {
          const lastFetched = priceDisplay.sourceDate?.slice(0, 10) || null;
          const dataset = {
            "@context": "https://schema.org",
            "@type": "Dataset",
            "name": `${idLabel} 해외 참고가 데이터`,
            "description": `${idLabel} ${priceDisplay.label}. ${priceDisplay.sourceDescription}`,
            "url": canonical,
            "creator": { "@type": "Organization", "name": "카드픽", "url": "https://cardpick.kr/" },
            "license": "https://cardpick.kr/license",
            "isAccessibleForFree": true,
            ...(lastFetched ? { "dateModified": lastFetched } : {}),
            "variableMeasured": [
              { "@type": "PropertyValue", "name": "display_krw", "description": priceDisplay.label, "unitText": "KRW", "value": krw },
              ...(priceDisplay.sourceUsd !== null ? [{ "@type": "PropertyValue", "name": "latest_usd", "description": "TCGplayer market price (USD)", "unitText": "USD", "value": priceDisplay.sourceUsd }] : []),
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
        'Cache-Control': 'public, s-maxage=3600, stale-while-revalidate=600',
        'X-Cardpick-SSR': 'cards/' + slug,
        'X-Edge-Cache': 'MISS'
      }
    });
    if (edgeCache && typeof context.waitUntil === 'function') context.waitUntil(Promise.resolve().then(() => edgeCache.put(cacheKey, resp.clone())).catch(() => {}));
    return resp;
  } catch (e) {
    return unavailable();
  }
  } finally { upstream.close(); }
}
