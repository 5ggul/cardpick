// /search — 포켓몬 카드 검색 페이지 SSR
// 필터: q=검색어, has_price=1, sort=recent|up_7d|up_30d
export async function onRequest(context) {
  const SUPA = 'https://aqxrmdratnkffvivguqs.supabase.co';
  const KEY = 'sb_publishable_AeDBjfn3ymozGyw06ohMUw_S6n1-qpj';
  const url = new URL(context.request.url);
  const q = (url.searchParams.get('q') || '').trim().slice(0, 80);
  const hasPrice = url.searchParams.get('has_price') === '1';
  const sort = url.searchParams.get('sort') || 'relevance';  // relevance|recent|up_7d|up_30d

  function esc(s){ return String(s||'').replace(/[<>&"]/g, c => ({'<':'&lt;','>':'&gt;','&':'&amp;','"':'&quot;'}[c])); }
  function fmtKrw(n){ return n ? '₩'+Math.round(Number(n)).toLocaleString('ko-KR') : '—'; }

  let cards = [];
  let totalCount = 0;
  let queryError = null;

  if (q.length >= 1) {
    try {
      // 토큰화
      const tokens = q.split(/\s+/).filter(Boolean).slice(0, 5);
      const ilikeFilters = tokens.map(t => `search_text=ilike.*${encodeURIComponent(t.replace(/[%_]/g, '\\$&'))}*`).join('&');

      // 카드 fetch (포켓몬만, RLS 적용)
      const cardsRes = await fetch(
        `${SUPA}/rest/v1/cards?select=slug,name,name_en,name_ko,game,set_name,set_code,number,rarity_class,popularity_rank,external_id&game=eq.pokemon&${ilikeFilters}&limit=200`,
        { headers: { apikey: KEY } }
      );
      if (!cardsRes.ok) throw new Error(`cards ${cardsRes.status}`);
      const rawCards = await cardsRes.json();
      totalCount = rawCards.length;

      if (rawCards.length) {
        // 가격 / 변동 / ★ Trust Gate 정보 일괄 join (outlier 차단)
        const slugs = rawCards.map(c => `"${c.slug.replace(/"/g, '\\"')}"`).join(',');
        const [sumRes, cmRes, tRes] = await Promise.all([
          fetch(`${SUPA}/rest/v1/card_price_summary_best?card_slug=in.(${slugs})`, { headers: { apikey: KEY } }),
          fetch(`${SUPA}/rest/v1/card_movement_cardmarket?card_slug=in.(${slugs})`, { headers: { apikey: KEY } }),
          // ★ Trust MV — 2026-05-27 fix: ₩5.5M outlier 차단
          fetch(`${SUPA}/rest/v1/card_price_trust?card_slug=in.(${slugs})&select=card_slug,trust_level,display_krw`, { headers: { apikey: KEY } })
        ]);
        const sums = sumRes.ok ? await sumRes.json() : [];
        const cms = cmRes.ok ? await cmRes.json() : [];
        const trusts = tRes.ok ? await tRes.json() : [];
        const sumBySlug = {}, cmBySlug = {}, trustBySlug = {};
        for (const s of sums) sumBySlug[s.card_slug] = s;
        for (const m of cms) cmBySlug[m.card_slug] = m;
        for (const t of trusts) trustBySlug[t.card_slug] = t;

        // 카드별 enrich — Trust Gate 적용
        const enriched = rawCards.map(c => {
          const s = sumBySlug[c.slug] || {};
          const m = cmBySlug[c.slug] || {};
          const t = trustBySlug[c.slug];
          // ★ Trust Gate: NONE 또는 trust 없으면 가격 null
          let safeKrw = null;
          if (t && t.display_krw && t.trust_level !== 'NONE') {
            safeKrw = Math.round(Number(t.display_krw));
          }
          return {
            ...c,
            latest_krw: safeKrw,  // outlier 차단
            trust_level: t ? t.trust_level : 'NONE',
            last_fetched_at: s.last_fetched_at || null,
            change_7d: m.change_7d_vs_30d_pct != null ? Number(m.change_7d_vs_30d_pct) : null,
            change_30d: s.change_30d_pct != null ? Number(s.change_30d_pct) : null,
            has_price: !!safeKrw
          };
        });

        // 필터
        let filtered = hasPrice ? enriched.filter(c => c.has_price) : enriched;

        // 정렬
        const qL = q.toLowerCase();
        if (sort === 'recent') {
          filtered.sort((a,b) => (b.last_fetched_at||'').localeCompare(a.last_fetched_at||''));
        } else if (sort === 'up_7d') {
          filtered.sort((a,b) => (b.change_7d || -999) - (a.change_7d || -999));
        } else if (sort === 'up_30d') {
          filtered.sort((a,b) => (b.change_30d || -999) - (a.change_30d || -999));
        } else {
          // relevance — 이름 정확/시작/길이/popularity
          filtered.sort((a,b) => {
            const aN = (a.name||'').toLowerCase(), bN = (b.name||'').toLowerCase();
            const aKo = (a.name_ko||'').toLowerCase(), bKo = (b.name_ko||'').toLowerCase();
            const aExact = aN === qL || aKo === qL;
            const bExact = bN === qL || bKo === qL;
            if (aExact !== bExact) return aExact ? -1 : 1;
            const aStarts = aN.startsWith(qL) || aKo.startsWith(qL);
            const bStarts = bN.startsWith(qL) || bKo.startsWith(qL);
            if (aStarts !== bStarts) return aStarts ? -1 : 1;
            return (a.popularity_rank||9999) - (b.popularity_rank||9999);
          });
        }

        cards = filtered.slice(0, 60);
        totalCount = filtered.length;
      }
    } catch (e) { queryError = e.message; }
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

  const html = `<!doctype html>
<html lang="ko"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${q ? esc(q)+' 검색 결과' : '포켓몬 카드 검색'} | 카드픽</title>
<meta name="description" content="포켓몬 카드 검색. 카드명·세트·번호·희귀도로 약 20,000장 검색. Pokémon TCG API 기반 해외 참고가 표시.">
<link rel="canonical" href="https://cardpick.kr/search${q ? '?q='+encodeURIComponent(q) : ''}">
<meta name="robots" content="${q ? 'noindex,follow' : 'index,follow'}">
<link rel="stylesheet" href="https://cdn.jsdelivr.net/gh/orioncactus/pretendard@v1.3.9/dist/web/static/pretendard.min.css">
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;500;600&display=swap">
<script src="https://cdn.tailwindcss.com"></script>
<script>tailwind.config={theme:{extend:{colors:{bg:'#05080D',panel:'#0D121B',panel2:'#111722',line:'rgba(255,255,255,0.08)',ink:'#E8EDF5',muted:'#8B96A8',up:'#26E0C2',down:'#FF4D6D',brand:'#26E0C2'},fontFamily:{sans:['Pretendard','system-ui','sans-serif'],mono:['"IBM Plex Mono"','ui-monospace','monospace']}}}}</script>
<style>
  html,body{background:#05080D;color:#E8EDF5;font-family:Pretendard,system-ui,sans-serif}
  .mono{font-family:'IBM Plex Mono',ui-monospace,monospace;font-variant-numeric:tabular-nums}
  .hairline{border-color:rgba(255,255,255,0.08)}
  .text-up{color:#26E0C2}.text-down{color:#FF4D6D}
  .chip{display:inline-flex;align-items:center;padding:6px 12px;border:1px solid rgba(255,255,255,0.12);font-size:12px;border-radius:2px;cursor:pointer;transition:all .15s}
  .chip.on{background:#26E0C2;color:#04100E;border-color:#26E0C2;font-weight:600}
  .chip:hover{border-color:#26E0C2}
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
  <div class="max-w-[1280px] mx-auto px-5 lg:px-8 h-14 flex items-center justify-between gap-4">
    <a href="/" class="font-bold tracking-tight text-ink shrink-0">카드픽</a>
    <form action="/search" method="get" class="flex-1 max-w-[600px]">
      <input type="search" name="q" value="${esc(q)}" placeholder="카드명·세트·번호 검색"
        class="w-full px-3 py-2 bg-panel border hairline text-ink text-sm font-mono"
        autofocus>
    </form>
    <nav class="flex gap-3 text-[13px] text-muted shrink-0">
      <a href="/" class="hover:text-ink">홈</a>
      <a href="/hot" class="hover:text-ink">트렌드</a>
      <a href="/board" class="hover:text-ink">게시판</a>
    </nav>
  </div>
</header>

<main class="max-w-[1280px] mx-auto px-5 lg:px-8 py-8">
  ${q ? `
    <div class="mb-4">
      <div class="mono text-[11px] text-muted tracking-[0.16em] mb-1">SEARCH</div>
      <h1 class="text-[24px] font-bold mb-1">${esc(q)}</h1>
      <p class="text-[13px] text-muted">${cards.length === 0 && totalCount === 0 ? '결과 없음' : `${totalCount}건 (상위 ${cards.length}장 표시)`}</p>
    </div>
    <div class="flex flex-wrap gap-2 mb-6">
      <a href="/search${baseQs({sort:'relevance'})}" class="chip ${sort==='relevance'?'on':''}">관련도</a>
      <a href="/search${baseQs({sort:'recent'})}" class="chip ${sort==='recent'?'on':''}">최근 업데이트순</a>
      <a href="/search${baseQs({sort:'up_7d'})}" class="chip ${sort==='up_7d'?'on':''}">7일 상승순</a>
      <a href="/search${baseQs({sort:'up_30d'})}" class="chip ${sort==='up_30d'?'on':''}">30일 상승순</a>
      <span class="border-l hairline mx-2"></span>
      <a href="/search${baseQs({has_price: hasPrice ? '' : '1'})}" class="chip ${hasPrice?'on':''}">가격 정보 있음</a>
    </div>
    ${cards.length ? `
      <div class="border hairline divide-y divide-line">
        ${cards.map(c => `
          <a href="/cards/${esc(c.slug)}" class="flex items-center gap-4 px-4 py-3 hover:bg-panel2 transition">
            <div class="flex-1 min-w-0">
              <div class="text-[14px] text-ink truncate">${esc(c.name)}${c.name_ko ? `<span class="ml-2 text-[11px] text-muted">${esc(c.name_ko)}</span>` : ''}</div>
              <div class="mono text-[10px] text-muted mt-1">${esc(c.set_name||'')} · ${esc(c.set_code||'')}${c.number ? ' · '+esc(c.number) : ''}${c.rarity_class ? ' · '+esc(c.rarity_class) : ''}</div>
            </div>
            <div class="mono text-[13px] text-ink text-right shrink-0 w-24">${fmtKrw(c.latest_krw)}</div>
            <div class="mono text-[12px] text-right shrink-0 w-20 hidden sm:block">${chgCell(c.change_7d)}</div>
            <div class="mono text-[10px] text-muted text-right shrink-0 w-16 hidden md:block">7D</div>
          </a>
        `).join('')}
      </div>
    ` : `
      <div class="border hairline panel p-8 text-center">
        <p class="text-[14px] text-muted">아직 등록되지 않은 카드입니다. 검색어가 업데이트 후보에 추가되었습니다.</p>
        <p class="mono text-[11px] text-muted mt-2">조건을 바꾸거나 영문/세트코드로도 시도해보세요.</p>
      </div>
      <script>
        // 검색 결과 0건 → 업데이트 요청 자동 송신
        fetch('/api/request-update', {
          method:'POST',
          headers:{'Content-Type':'application/json'},
          body: JSON.stringify({ query: ${JSON.stringify(q)} })
        }).catch(()=>{});
      </script>
    `}
  ` : `
    <div class="text-center py-16">
      <h1 class="text-[28px] font-bold mb-3">포켓몬 카드 검색</h1>
      <p class="text-[14px] text-muted">상단 검색창에 카드명·세트 코드·번호를 입력하세요. 한국어/영문 모두 지원.</p>
      <p class="mono text-[11px] text-muted mt-2">예: 리자몽, charizard, sv4pt5, 199/091</p>
    </div>
  `}

  <div class="mt-10 panel p-5 text-[11px] text-muted leading-relaxed">
    <div class="mono text-[10px] text-ink/80 mb-1.5">⚠ 해외 참고가 안내</div>
    가격은 Pokémon TCG API 기반 해외 참고가입니다. 국내 거래가와 다를 수 있습니다. 본 정보는 투자 권유가 아닙니다.
  </div>
</main>

<script>
// 검색 로그 송신 (디바운스 안에서 한 번)
${q ? `
fetch('/api/search-log', {
  method:'POST',
  headers:{'Content-Type':'application/json'},
  body: JSON.stringify({
    query: ${JSON.stringify(q)},
    game: 'pokemon',
    result_count: ${cards.length},
    has_price: ${cards.some(c => c.has_price)},
    matched_slug: ${cards.length ? JSON.stringify(cards[0].slug) : 'null'}
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
