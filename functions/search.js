// /search — 포켓몬 카드 검색 페이지 SSR
// 필터: q=검색어, has_price=1, sort=recent|up_7d|up_30d
import { planSearchQuery, identityFilterEntries, escapeSearchToken, getTrustedSearchPrice, sortSearchCards } from '../search-identity.mjs';

export async function onRequest(context) {
  const SUPA = 'https://aqxrmdratnkffvivguqs.supabase.co';
  const KEY = 'sb_publishable_AeDBjfn3ymozGyw06ohMUw_S6n1-qpj';
  const url = new URL(context.request.url);
  const searchPlan = planSearchQuery(url.searchParams.get('q') || '');
  const { original: q, queryNormalized: normalized, queryTokens: tokens, hasGradingIntent, canSearch, identityError, hasIdentityFilters } = searchPlan;
  const hasPrice = url.searchParams.get('has_price') === '1';
  const sort = url.searchParams.get('sort') || 'relevance';  // relevance|recent|up_7d|up_30d
  // Local previews must not write search logs or update requests to production.
  const allowSearchWrites = !['localhost', '127.0.0.1', '[::1]', '::1'].includes(url.hostname);

  function esc(s){ return String(s||'').replace(/[<>&"]/g, c => ({'<':'&lt;','>':'&gt;','&':'&amp;','"':'&quot;'}[c])); }
  function fmtKrw(n){ return n ? '₩'+Math.round(Number(n)).toLocaleString('ko-KR') : '—'; }
  function inlineJson(value){ return JSON.stringify(value).replace(/</g, '\\u003c'); }
  function finiteNumber(value){
    if (!['number', 'string'].includes(typeof value) || (typeof value === 'string' && !value.trim())) return null;
    const number = Number(value);
    return Number.isFinite(number) ? number : null;
  }

  // Bound the complete read, including JSON parsing. No POST is made by SSR.
  async function fetchRows(endpoint) {
    const controller = new AbortController();
    let timer;
    const deadline = new Promise((_, reject) => {
      timer = setTimeout(() => {
        reject(new Error('search_read_timeout'));
        controller.abort();
      }, 6000);
    });
    try {
      return await Promise.race([
        (async () => {
          const response = await fetch(`${SUPA}/rest/v1/${endpoint}`, {
            headers: { apikey: KEY }, signal: controller.signal
          });
          if (!response.ok) throw new Error('search_read_failed');
          const rows = await response.json();
          if (!Array.isArray(rows)) throw new Error('search_invalid_data');
          return rows;
        })(),
        deadline
      ]);
    } finally {
      clearTimeout(timer);
      controller.abort();
    }
  }

  function indexRows(rows) {
    const index = new Map();
    for (const row of rows) {
      if (row && typeof row.card_slug === 'string') index.set(row.card_slug, row);
    }
    return index;
  }

  let cards = [];
  let totalCount = 0;
  let matchedCardCount = 0;
  let queryError = null;
  let partialDataError = false;

  if (canSearch) {
    try {
      const ilikeFilters = tokens.map(t => `search_text=ilike.${encodeURIComponent('%' + escapeSearchToken(t) + '%')}`).join('&');
      const exactFilters = identityFilterEntries(searchPlan).map(([field,value]) => `${field}=ilike.${encodeURIComponent(value)}`).join('&');
      const filters = [ilikeFilters, exactFilters].filter(Boolean).join('&');

      // 카드 fetch (포켓몬만, RLS 적용)
      const rawCards = await fetchRows(`cards?select=slug,name,name_en,name_ko,game,set_name,set_code,number,rarity_class,popularity_rank,external_id&game=eq.pokemon&${filters}&limit=200`);
      totalCount = rawCards.length;
      matchedCardCount = rawCards.length;

      if (rawCards.length) {
        // 가격 / 변동 / ★ Trust Gate 정보 일괄 join (outlier 차단)
        const slugs = encodeURIComponent(rawCards.map(c => `"${c.slug.replace(/"/g, '\\"')}"`).join(','));
        const joined = await Promise.allSettled([
          fetchRows(`card_price_summary_best?card_slug=in.(${slugs})`),
          fetchRows(`card_movement_cardmarket?card_slug=in.(${slugs})`),
          // ★ Trust MV — 2026-05-27 fix: ₩5.5M outlier 차단
          fetchRows(`card_price_trust?card_slug=in.(${slugs})&select=card_slug,trust_level,display_krw`)
        ]);
        partialDataError = joined.some(result => result.status === 'rejected');
        const [sumBySlug, cmBySlug, trustBySlug] = joined.map(result => indexRows(result.status === 'fulfilled' ? result.value : []));

        // 카드별 enrich — Trust Gate 적용
        const enriched = rawCards.map(c => {
          const s = sumBySlug.get(c.slug) || {};
          const m = cmBySlug.get(c.slug) || {};
          const t = trustBySlug.get(c.slug);
          const safeKrw = getTrustedSearchPrice(t);
          return {
            ...c,
            latest_krw: safeKrw,  // outlier 차단
            trust_level: safeKrw != null ? t.trust_level : 'NONE',
            last_fetched_at: s.last_fetched_at || null,
            change_7d: finiteNumber(m.change_7d_vs_30d_pct),
            change_30d: finiteNumber(s.change_30d_pct),
            has_price: !!safeKrw
          };
        });

        // 필터
        let filtered = hasPrice ? enriched.filter(c => c.has_price) : enriched;

        // 정렬
        if (sort === 'recent') {
          filtered.sort((a,b) => (b.last_fetched_at||'').localeCompare(a.last_fetched_at||''));
        } else if (sort === 'up_7d') {
          filtered.sort((a,b) => (b.change_7d ?? -Infinity) - (a.change_7d ?? -Infinity));
        } else if (sort === 'up_30d') {
          filtered.sort((a,b) => (b.change_30d ?? -Infinity) - (a.change_30d ?? -Infinity));
        } else {
          filtered = sortSearchCards(filtered, normalized);
        }

        cards = filtered.slice(0, 60);
        totalCount = filtered.length;
      }
    } catch { queryError = true; }
  }

  // 변동률 셀 렌더
  function chgCell(v) {
    if (v == null) return '<span class="text-muted">—</span>';
    if (Math.abs(v) < 0.05) return '<span class="text-muted">0.0%</span>';
    const cls = v > 0 ? 'text-up' : 'text-down';
    const sign = v > 0 ? '▲ +' : '▼ ';
    return `<span class="${cls}">${sign}${Math.abs(v).toFixed(1)}%</span>`;
  }

  // 필터 칩 active 클래스
  const activeChip = (cond) => cond ? 'bg-brand text-bg' : 'text-muted hover:text-ink';
  const baseQs = (override) => {
    const params = new URLSearchParams();
    if (q) params.set('q', q);
    if (hasPrice) params.set('has_price', '1');
    if (sort !== 'relevance') params.set('sort', sort);
    for (const [k,v] of Object.entries(override||{})) {
      if (v == null || v === '') params.delete(k);
      else params.set(k, v);
    }
    return params.toString() ? '?' + params.toString() : '';
  };
  const isEmptySearch = canSearch && !queryError && matchedCardCount === 0;
  const isFilteredEmpty = hasPrice && matchedCardCount > 0 && cards.length === 0;
  const reportSearch = canSearch && !queryError && !partialDataError && !isFilteredEmpty && allowSearchWrites
    && !(hasIdentityFilters && matchedCardCount === 0);
  const reachedCandidateLimit = !queryError && matchedCardCount >= 200;
  const resultCountLabel = reachedCandidateLimit
    ? `조회한 카드 중 ${totalCount}건 (${cards.length}장 표시)`
    : (cards.length === 0 && totalCount === 0 ? '결과 없음' : `${totalCount}건 (${cards.length}장 표시)`);

  const html = `<!doctype html>
<html lang="ko"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${q ? esc(q)+' 검색 결과' : '포켓몬 카드 검색'} | 카드픽</title>
<meta name="description" content="포켓몬 카드 검색. 카드명·세트·번호·희귀도로 약 20,000장 검색. Pokémon TCG API 기반 해외 참고가 표시.">
<link rel="canonical" href="https://cardpick.kr/search">
<meta name="robots" content="noindex,follow">
<link rel="stylesheet" href="/styles/search-base.css?v=20261012">
<link rel="stylesheet" href="/styles/card-compare.css?v=20261020">
<link rel="stylesheet" href="/styles/releases-fonts.css" media="print" onload="this.media='all'">
<link rel="stylesheet" href="/styles/set-fonts.css" media="print" onload="this.media='all'">
<noscript><link rel="stylesheet" href="/styles/releases-fonts.css"><link rel="stylesheet" href="/styles/set-fonts.css"></noscript>
<style>
  html,body{background:#05080D;color:#E8EDF5;font-family:Pretendard,system-ui,sans-serif}
  .mono{font-family:'IBM Plex Mono',ui-monospace,monospace;font-variant-numeric:tabular-nums}
  .hairline{border-color:rgba(255,255,255,0.08)}
  .text-up{color:#26E0C2}.text-down{color:#FF4D6D}
  .chip{display:inline-flex;align-items:center;padding:6px 12px;border:1px solid rgba(255,255,255,0.12);font-size:12px;border-radius:2px;cursor:pointer;transition:border-color .15s}
  .chip.on{background:#26E0C2;color:#04100E;border-color:#26E0C2;font-weight:600}
  .chip:hover{border-color:#26E0C2}
  header a:focus-visible,main a:focus-visible,input[type="search"]:focus-visible{outline:2px solid #26E0C2;outline-offset:3px}
  @media(max-width:640px){header .search-header-inner{height:auto;min-height:56px;flex-wrap:wrap;padding-top:10px;padding-bottom:10px;gap:10px}header .search-header-form{order:3;flex-basis:100%;max-width:none}header .search-header-nav{margin-left:auto}}
  @media(max-width:768px){.chip{min-height:44px;min-width:44px;justify-content:center;touch-action:manipulation}header .search-header-form input{min-height:44px}header .search-header-inner>a,header .search-header-nav a{display:inline-flex;align-items:center;justify-content:center;min-height:44px;min-width:44px;touch-action:manipulation}main a.inline-block,main a[href^="/cards/"]{min-height:44px;touch-action:manipulation}main a.inline-block{display:inline-flex;align-items:center;justify-content:center;min-width:44px}}
</style>
<!-- Google Analytics (gtag.js) -->
<script async src="https://www.googletagmanager.com/gtag/js?id=G-S1QY1436WG"></script>
<script>
  window.dataLayer = window.dataLayer || [];
  function gtag(){dataLayer.push(arguments);}
  gtag('js', new Date());
  gtag('config', 'G-S1QY1436WG');
</script>
</head><body>
<header class="border-b hairline sticky top-0 bg-bg z-10">
  <div class="search-header-inner max-w-[1280px] mx-auto px-5 lg:px-8 h-14 flex items-center justify-between gap-4">
    <a href="/" class="font-bold tracking-tight text-ink shrink-0">카드픽</a>
    <form action="/search" method="get" class="search-header-form flex-1 max-w-[600px]">
      <input type="search" name="q" value="${esc(q)}" placeholder="카드명·세트·번호 검색"
        aria-label="포켓몬 카드 이름, 세트 또는 카드 번호 검색" class="w-full px-3 py-2 bg-panel border hairline text-ink text-sm font-mono"
        autofocus>
    </form>
    <nav class="search-header-nav flex gap-3 text-[13px] text-muted shrink-0">
      <a href="/" class="hover:text-ink">홈</a>
      <a href="/hot" class="hover:text-ink">트렌드</a>
      <a href="/board" class="hover:text-ink">게시판</a>
    </nav>
  </div>
</header>

<main class="max-w-[1280px] mx-auto px-5 lg:px-8 py-8">
  ${!hasGradingIntent ? `
  <form id="cp-search-identity-form" class="cp-search-identity-form" action="/search" method="get" hidden aria-labelledby="cp-search-identity-title">
    <h2 id="cp-search-identity-title">번호·세트로 좁히기</h2>
    <div class="cp-search-identity-fields">
      <div class="cp-search-identity-field"><label for="cp-identity-query">카드명·검색어</label><input id="cp-identity-query" name="q" type="search" maxlength="80" value="${esc(searchPlan.freeQuery)}"></div>
      <div class="cp-search-identity-field"><label for="cp-identity-set-code">세트 코드</label><input id="cp-identity-set-code" type="text" maxlength="24" value="${esc(searchPlan.identity.set_code || '')}" autocomplete="off" aria-describedby="cp-identity-help"></div>
      <div class="cp-search-identity-field"><label for="cp-identity-set-id">세트 ID</label><input id="cp-identity-set-id" type="text" maxlength="24" value="${esc(searchPlan.identity.set_id || '')}" autocomplete="off" aria-describedby="cp-identity-help"></div>
      <div class="cp-search-identity-field"><label for="cp-identity-number">카드 번호</label><input id="cp-identity-number" type="text" maxlength="25" value="${esc(searchPlan.identity.number || '')}" autocomplete="off" aria-describedby="cp-identity-help"></div>
    </div>
    <p id="cp-identity-help">카드에 적힌 번호를 그대로 입력하세요. 분모·앞자리 0·문자는 생략하지 않습니다. 세트 코드와 ID는 서로 다른 조건입니다.</p>
    <button type="submit">조건으로 검색</button>
    <p id="cp-identity-form-error" class="cp-search-identity-error" role="alert" hidden></p>
  </form>
  <script>
  (function(){
    var form=document.getElementById('cp-search-identity-form');
    if(!form)return;
    var submitting=false;
    form.addEventListener('submit',function(event){
      event.preventDefault();
      if(submitting)return;
      var error=document.getElementById('cp-identity-form-error');
      var button=form.querySelector('button[type="submit"]');
      var timer;
      submitting=true;error.hidden=true;button.disabled=true;
      var deadline=new Promise(function(_,reject){timer=setTimeout(function(){reject(new Error('identity_form_timeout'));},6000);});
      var prepared=import('/search-identity.mjs?v=20261020').then(function(policy){
        return policy.serializeIdentityQuery({query:document.getElementById('cp-identity-query').value,
          set_code:document.getElementById('cp-identity-set-code').value,set_id:document.getElementById('cp-identity-set-id').value,
          number:document.getElementById('cp-identity-number').value});
      });
      Promise.race([prepared,deadline]).then(function(result){
        if(result.error){error.textContent=result.error;error.hidden=false;return;}
        var target=new URL('/search',location.origin);target.searchParams.set('q',result.query);
        var current=new URL(location.href);['has_price','sort'].forEach(function(key){if(current.searchParams.has(key))target.searchParams.set(key,current.searchParams.get(key));});
        location.href=target.pathname+target.search;
      }).catch(function(){error.textContent='검색 조건을 확인하지 못했습니다. 잠시 후 다시 시도해 주세요.';error.hidden=false;})
        .finally(function(){clearTimeout(timer);submitting=false;button.disabled=false;});
    });
    form.hidden=false;
  })();
  </script>
  <noscript><p class="cp-search-identity-summary">상단 검색창에서 #번호, set:세트코드, id:세트ID 조건을 함께 입력할 수 있습니다. 카드 비교는 JavaScript를 켜야 사용할 수 있습니다.</p></noscript>
  ${hasIdentityFilters && !identityError ? `<p class="cp-search-identity-summary" data-search-identity-conditions>적용한 조건: ${searchPlan.identityConditions.map(item => esc(item.label)+ ' ' +esc(item.value)).join(' · ')}. 번호의 분모나 언어판을 추정해 다른 카드로 연결하지 않습니다.</p>` : ''}
  ` : ''}
  ${q ? `
    <div class="mb-4">
      <div class="mono text-[11px] text-muted tracking-[0.16em] mb-1">SEARCH</div>
      <h1 class="text-[24px] font-bold mb-1">${esc(q)}</h1>
      <p class="text-[13px] text-muted">${hasGradingIntent ? '그레이딩 검색 안내' : (queryError ? '검색 결과를 불러오지 못했습니다.' : (!canSearch ? '검색어 확인 필요' : resultCountLabel))}</p>
      ${reachedCandidateLimit ? '<p data-search-candidate-limit class="text-[13px] text-muted mt-2">검색 결과는 최대 200장을 조회해 필터·정렬합니다. 표시된 건수와 순위는 조회한 카드 기준입니다.</p>' : ''}
    </div>
    <div class="flex flex-wrap gap-2 mb-6">
      <a href="/search${baseQs({sort:'relevance'})}" class="chip ${sort==='relevance'?'on':''}">관련도</a>
      <a href="/search${baseQs({sort:'recent'})}" class="chip ${sort==='recent'?'on':''}">최근 업데이트순</a>
      <a href="/search${baseQs({sort:'up_7d'})}" class="chip ${sort==='up_7d'?'on':''}">7일 상승순</a>
      <a href="/search${baseQs({sort:'up_30d'})}" class="chip ${sort==='up_30d'?'on':''}">30일 상승순</a>
      <span class="border-l hairline mx-2"></span>
      <a href="/search${baseQs({has_price: hasPrice ? '' : '1'})}" class="chip ${hasPrice?'on':''}">가격 정보 있음</a>
    </div>
    ${partialDataError ? '<p role="status" class="text-[13px] text-muted mb-4">일부 참고가·변동 정보를 불러오지 못했습니다. 카드 정보는 계속 확인할 수 있습니다.</p>' : ''}
    ${hasGradingIntent ? `
      <div data-search-grading-intent class="border hairline panel p-5">
        <h2 class="text-[14px] text-ink">그레이딩 카드 거래가격은 제공하지 않습니다.</h2>
        <p class="text-[13px] text-muted mt-2 leading-relaxed">Raw 카드 참고가로 대신 검색하지 않습니다. 비용·손익 계산이나 PSA 인증번호 확인이 필요하면 아래 도구를 이용하세요.</p>
        <div class="mt-3">
          <a href="/tools/grading-cost-compare" class="block px-4 py-3 text-[13px] text-up">그레이딩 비용 비교</a>
          <a href="/tools/psa-grading-break-even" class="block px-4 py-3 text-[13px] text-up">PSA 손익 계산</a>
          <a href="/tools/psa-cert-checker" class="block px-4 py-3 text-[13px] text-up">PSA 인증번호 조회 도우미</a>
        </div>
      </div>
    ` : identityError ? `
      <div class="cp-search-identity-error" role="alert"><p>${esc(identityError)}</p><p>조건을 수정해 다시 검색해 주세요. 입력한 조건을 빼고 다른 카드를 대신 검색하지 않습니다.</p></div>
    ` : queryError ? `
      <div role="alert" class="border hairline panel p-8 text-center">
        <p class="text-[14px] text-muted">검색에 실패했습니다. 잠시 후 다시 시도해 주세요.</p>
        <a href="/search${esc(baseQs())}" class="inline-block text-[13px] text-up mt-3">다시 검색</a>
      </div>
    ` : cards.length ? `
      <div class="border hairline divide-y divide-line">
        ${cards.map(c => `
          <div class="cp-search-result-row">
          <a href="/cards/${esc(c.slug)}" class="cp-search-card-link flex items-center gap-4 px-4 py-3 hover:bg-panel2 transition">
            <div class="flex-1 min-w-0">
              <div class="text-[14px] text-ink truncate">${esc(c.name)}${c.name_ko ? `<span class="ml-2 text-[11px] text-muted">${esc(c.name_ko)}</span>` : ''}</div>
              <div class="mono text-[10px] text-muted mt-1">${esc(c.set_name||'')} · ${esc(c.set_code||'')}${c.number ? ' · '+esc(c.number) : ''}${c.rarity_class ? ' · '+esc(c.rarity_class) : ''}</div>
            </div>
            <div class="mono text-[13px] text-ink text-right shrink-0 w-24">${fmtKrw(c.latest_krw)}${c.latest_krw != null && c.trust_level === 'LOW' ? '<small data-search-low-trust class="block text-[10px] text-muted leading-relaxed mt-1">표본 부족 · 참고용</small>' : ''}</div>
            <div class="mono text-[12px] text-right shrink-0 w-20 hidden sm:block">${chgCell(c.change_7d)}</div>
            <div class="mono text-[10px] text-muted text-right shrink-0 w-16 hidden md:block">7D</div>
          </a>
          <button type="button" class="cp-compare-add" data-cp-compare-add="${esc(c.slug)}" hidden aria-pressed="false" aria-label="${esc(c.name_ko || c.name)} 비교에 추가">비교에 추가</button>
          </div>
        `).join('')}
      </div>
    ` : `
      <div class="border hairline panel p-8 text-center">
        <p class="text-[14px] text-muted">${!canSearch ? '검색할 카드명·세트 코드·번호를 입력해 주세요.' : (isEmptySearch ? '검색어와 일치하는 카드를 찾지 못했습니다.' : (reachedCandidateLimit ? '조회한 카드 중에서는 선택한 조건에 맞는 카드가 없습니다.' : '선택한 조건에 맞는 카드가 없습니다.'))}</p>
        <p class="mono text-[11px] text-muted mt-2">${!canSearch ? '예: 코코리, Mewtwo ex, SSP, 205' : (isEmptySearch ? (hasIdentityFilters ? '번호·세트 조건을 그대로 적용한 결과입니다. 분모가 저장되지 않은 카드는 일치한다고 판단하지 않습니다. 조건을 확인하거나 직접 수정해 주세요.' : '카드명·세트 코드·번호를 확인하거나 영문명으로도 검색해 보세요.') : '가격 정보 있음 조건을 해제하거나 검색 조건을 바꿔 보세요.')}</p>
        ${canSearch && !isEmptySearch && hasPrice ? `<a href="/search${esc(baseQs({has_price:''}))}" class="inline-block text-[13px] text-up mt-3">가격 조건 해제</a>` : ''}
      </div>
      ${isEmptySearch && reportSearch ? `<script>
        // 검색 결과 0건 → 업데이트 요청 자동 송신
        fetch('/api/request-update', {
          method:'POST',
          headers:{'Content-Type':'application/json'},
          body: JSON.stringify({ query: ${inlineJson(q)} })
        }).catch(()=>{});
      </script>` : ''}
    `}
  ` : `
    <div class="text-center py-16">
      <h1 class="text-[28px] font-bold mb-3">포켓몬 카드 검색</h1>
      <p class="text-[14px] text-muted">상단 검색창에 카드명·세트 코드·번호를 입력하세요. 한국어/영문 모두 지원.</p>
      <p class="mono text-[11px] text-muted mt-2">예: 리자몽, charizard, sv4pt5, 199/091</p>
    </div>
  `}

  ${!hasGradingIntent ? `
  <section id="card-compare" class="cp-card-compare" data-cp-card-compare hidden aria-labelledby="card-compare-title">
    <h2 id="card-compare-title">카드 비교</h2>
    <p>선택한 두 카드의 식별 정보와 해외 참고가를 비교합니다. 언어판·상태가 다르면 같은 거래가격으로 볼 수 없습니다.</p>
    <p data-cp-compare-status role="status" aria-live="polite"></p>
    <div data-cp-compare-slots></div>
    <button type="button" data-cp-compare-clear>비교 비우기</button>
  </section>
  <script defer src="/js/cp-card-compare.js?v=20261020"></script>
  ` : ''}
  <div class="mt-10 panel p-5 text-[11px] text-muted leading-relaxed">
    <div class="mono text-[10px] text-ink/80 mb-1.5">⚠ 해외 참고가 안내</div>
    가격은 Pokémon TCG API 기반 해외 참고가입니다. 국내 거래가와 다를 수 있습니다. 본 정보는 투자 권유가 아닙니다.
  </div>
</main>

<script>
// 검색 로그 송신 (디바운스 안에서 한 번)
${reportSearch ? `
fetch('/api/search-log', {
  method:'POST',
  headers:{'Content-Type':'application/json'},
  body: JSON.stringify({
    query: ${inlineJson(q)},
    game: 'pokemon',
    result_count: ${cards.length},
    has_price: ${cards.some(c => c.has_price)},
    matched_slug: ${cards.length ? inlineJson(cards[0].slug) : 'null'}
  })
}).catch(()=>{});
` : ''}
</script>
</body></html>`;

  return new Response(html, {
    status: 200,
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'public, s-maxage=300, stale-while-revalidate=60'
    }
  });
}
