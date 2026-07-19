// /hot — 오늘의 포켓몬 핫카드 SSR
export async function onRequest(context) {
  const SUPA = 'https://aqxrmdratnkffvivguqs.supabase.co';
  const KEY = 'sb_publishable_AeDBjfn3ymozGyw06ohMUw_S6n1-qpj';

  // ★ 엣지 캐시 (Cache API)
  const edgeCache = caches.default;
  const cacheKey = new Request('https://cardpick.kr/__hot_ssr_v2_adsense', { method: 'GET' });
  const hit = await edgeCache.match(cacheKey);
  if (hit) { const h = new Headers(hit.headers); h.set('X-Edge-Cache','HIT'); return new Response(hit.body, { status: hit.status, headers: h }); }

  let rows = [];
  try {
    const res = await fetch(`${SUPA}/rest/v1/rpc/get_hot_cards`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', apikey: KEY },
      body: JSON.stringify({})
    });
    if (res.ok) rows = await res.json();
  } catch (e) { /* graceful */ }

  // 검색 트렌드 (Naver 데이터랩) — 전주 대비 증가율 Top 5 (홈 위젯과 동일 로직)
  // 최근 7일 평균 vs 직전 7일 평균 → growth% desc. history 부족 키워드는 절대값 fallback.
  let trendTop = [];
  try {
    const fourteenAgo = new Date(Date.now() - 14*86400*1000).toISOString().slice(0,10);
    const trRes = await fetch(`${SUPA}/rest/v1/search_trends?date=gte.${fourteenAgo}&select=keyword,ratio,date&order=date.desc&limit=2000`, {
      headers: { apikey: KEY }
    });
    if (trRes.ok) {
      const trRows = await trRes.json();
      const today = new Date(); today.setUTCHours(0,0,0,0);
      const daysAgo = (ds) => Math.floor((today - new Date(ds + 'T00:00:00Z')) / 86400000);
      const byKw = {};
      for (const r of trRows) {
        const k = r.keyword;
        if (!byKw[k]) byKw[k] = { recent: [], prev: [], all: [] };
        const ago = daysAgo(r.date);
        const v = Number(r.ratio || 0);
        byKw[k].all.push(v);
        if (ago < 7) byKw[k].recent.push(v);
        else if (ago < 14) byKw[k].prev.push(v);
      }
      const avg = (a) => a.length ? a.reduce((s,x)=>s+x,0)/a.length : 0;
      const list = Object.entries(byKw).map(([keyword, v]) => {
        const recent = avg(v.recent), prev = avg(v.prev), all = avg(v.all);
        const growth = prev > 0.5 ? ((recent - prev) / prev) * 100 : null;
        return { keyword, recent, prev, all, growth, latest: recent };
      });
      const hasG = list.filter(x => x.growth !== null && isFinite(x.growth)).sort((a,b)=>b.growth-a.growth);
      const noG  = list.filter(x => x.growth === null || !isFinite(x.growth)).sort((a,b)=>b.all-a.all);
      trendTop = hasG.slice(0, 5);
      if (trendTop.length < 5) trendTop = trendTop.concat(noG.slice(0, 5 - trendTop.length));
    }
  } catch (e) { /* graceful */ }

  function esc(s){ return String(s||'').replace(/[<>&"]/g, c => ({'<':'&lt;','>':'&gt;','&':'&amp;','"':'&quot;'}[c])); }
  function fmtKrw(n){ return n ? '₩'+Math.round(Number(n)).toLocaleString('ko-KR') : '—'; }
  function chgBadge(p){
    if (p == null) return '<span class="chg flat mono text-[11px]">—</span>';
    const v = Number(p);
    const cls = v > 0.5 ? 'text-up' : v < -0.5 ? 'text-down' : 'text-muted';
    const sign = v > 0 ? '▲ +' : v < 0 ? '▼ ' : '';
    return `<span class="mono text-[11px] ${cls}">${sign}${v.toFixed(1)}%</span>`;
  }

  // P0-3 (외부 감사): 핫카드 품질 게이트 — 저가 / 표본 부족 / Common 배제
  // ★ Trust Gate v1: trust_level=NONE 카드는 hot에서 안전망 제외 (compute_hot_cards가 이미 거름)
  function isQuality(r) {
    // ★ trust_level=NONE 안전망 — 정직 원칙
    if (r.trust_level === 'NONE') return false;
    const krw = Number(r.latest_krw || 0);
    if (krw < 3000) return false;                    // 최소가 ₩3,000
    const rarRaw = String(r.rarity_class || '').toLowerCase();
    if (!rarRaw) return false;
    if (rarRaw === 'common' || rarRaw === 'uncommon') return false;
    // 변동률 카테고리: 절대 가격 변동 ≥ ₩1,000 + 표본 ≥ 2
    if (r.change_7d_pct != null) {
      const samples = Number(r.samples_7d || 0);
      if (samples < 2) return false;
      // ★ 변동률 게이트 (§5 도메인 룰): ±60% 초과는 stale/thin 데이터발 비현실 변동 → 제외
      if (Math.abs(Number(r.change_7d_pct)) > 60) return false;
      const absKrw = krw * Math.abs(Number(r.change_7d_pct)) / 100;
      if (absKrw < 1000) return false;
    }
    return true;
  }

  const byCat = {};
  for (const r of rows) {
    if (!isQuality(r)) continue;
    (byCat[r.category] ||= []).push(r);
  }
  // 카테고리별 rank 재정렬 (게이트 통과한 카드만 1, 2, 3, ...)
  for (const k of Object.keys(byCat)) {
    byCat[k].forEach((r, i) => { r.rank = i + 1; });
    byCat[k] = byCat[k].slice(0, 10);
  }

  const catLabels = {
    top: '오늘의 핫카드 TOP 10',
    rising_7d: '7일 급등 TOP',
    falling_7d: '7일 하락 TOP',
    rising_30d: '30일 관심 카드',
    search_surge: '검색 급증',
    requested: '업데이트 요청 많은',
  };

  // Fix C (2026-05-24): stale 'r.reason' 텍스트 대신 라이브 change_7d_pct로 재구성.
  //   compute_hot_cards가 05:40 snapshot으로 reason에 '7d +307.8% · score 45.0' 저장 →
  //   06:00 cold-rotation으로 MV 갱신 → 카드 상세 변동률은 +78%인데 reason은 +307% stale.
  //   현재 RPC는 b.change_7d_pct(live)를 함께 반환하므로 그 값으로 텍스트 재구성.
  //   카테고리별 reason 의미 분기 — high_value/fresh의 hot_score는 latest_krw라 score 표시 안 함.
  function reasonText(r, catKey) {
    const v = r.change_7d_pct;
    const sign = v > 0 ? '+' : '';
    // 변동률 중심 카테고리 — 7일 변화 (라이브)
    if (catKey === 'top' || catKey === 'rising_7d' || catKey === 'falling_7d' || catKey === 'rising_30d') {
      return v != null ? `7d ${sign}${Number(v).toFixed(1)}%` : '';
    }
    // 검색 급증·업데이트 요청 — 카운트 강조 (현재 RPC가 count 안 반환하므로 빈 텍스트)
    if (catKey === 'search_surge' || catKey === 'requested') {
      return v != null ? `7d ${sign}${Number(v).toFixed(1)}%` : '';
    }
    // high_value / fresh — 가격은 이미 별도 컬럼에 표시되므로 추가 텍스트 불필요
    return '';
  }

  function renderCat(catKey) {
    const list = byCat[catKey] || [];
    if (!list.length) return `<div class="mono text-[11px] text-muted py-8 text-center">데이터 수집 중</div>`;
    return `<ol class="space-y-1.5">${list.map(r => `
      <li class="flex items-center gap-3 px-3 py-2.5 border hairline hover:bg-panel2">
        <span class="mono text-[12px] text-muted w-6">${String(r.rank).padStart(2,'0')}</span>
        <a href="/cards/${esc(r.card_slug)}" class="flex-1 text-[14px] text-ink hover:text-brand truncate">
          ${esc(r.name)}
          <span class="ml-1 mono text-[10px] text-muted">${esc((r.set_name||'').slice(0,30))}${r.rarity_class ? ' · '+esc(r.rarity_class) : ''}</span>
        </a>
        <span class="mono text-[12px] text-ink hidden sm:inline">${fmtKrw(r.latest_krw)}</span>
        ${chgBadge(r.change_7d_pct)}
        <span class="mono text-[10px] text-muted hidden md:inline w-32 truncate text-right">${esc(reasonText(r, catKey))}</span>
      </li>`).join('')}</ol>`;
  }

  const today = new Date().toISOString().slice(0,10);
  const html = `<!doctype html>
<html lang="ko"><head>
<meta charset="utf-8"><script async src="https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=ca-pub-6109192154510152" crossorigin="anonymous"></script><meta name="viewport" content="width=device-width,initial-scale=1">
<title>오늘의 포켓몬 카드 핫카드 시세: 급등·하락 TOP 10 | 카드픽</title>
<meta name="description" content="${today} 기준 포켓몬 카드 7일 급등 TOP 10, 7일 하락 TOP 10, 30일 관심 카드, 검색 급증 카드. TCGplayer 북미 해외 참고가 기준, Trust Gate v1 검증. 국내 거래가와 다를 수 있습니다.">
<link rel="canonical" href="https://cardpick.kr/hot">
<meta name="robots" content="index,follow,max-image-preview:large,max-snippet:-1">
<meta property="og:type" content="website">
<meta property="og:url" content="https://cardpick.kr/hot">
<meta property="og:title" content="오늘의 포켓몬 카드 핫카드 시세: 급등·하락 TOP 10">
<meta property="og:description" content="포켓몬 카드 7일 급등·하락 TOP 10과 검색 급증 카드. TCGplayer 북미 해외 참고가 기준, 매일 갱신.">
<meta property="og:image" content="https://cardpick.kr/og.jpg">
<meta property="og:image:width" content="1200">
<meta property="og:image:height" content="630">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="오늘의 포켓몬 카드 핫카드 시세: 급등·하락 TOP 10">
<meta name="twitter:description" content="포켓몬 카드 급등·하락 TOP 10, 매일 갱신 해외 참고가.">
<meta name="twitter:image" content="https://cardpick.kr/og.jpg">
<link rel="stylesheet" as="style" href="https://cdn.jsdelivr.net/gh/orioncactus/pretendard@v1.3.9/dist/web/static/pretendard.min.css">
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;500;600&display=swap">
<script src="https://cdn.tailwindcss.com"></script>
<script>tailwind.config={theme:{extend:{colors:{bg:'#05080D',panel:'#0D121B',panel2:'#111722',line:'rgba(255,255,255,0.08)',ink:'#E8EDF5',muted:'#8B96A8',up:'#26E0C2',down:'#FF4D6D',brand:'#26E0C2',gold:'#D8B84A'},fontFamily:{sans:['Pretendard','system-ui','sans-serif'],mono:['"IBM Plex Mono"','ui-monospace','monospace']}}}}</script>
<script type="application/ld+json">
{
  "@context":"https://schema.org",
  "@type":"BreadcrumbList",
  "itemListElement":[
    {"@type":"ListItem","position":1,"name":"카드픽","item":"https://cardpick.kr/"},
    {"@type":"ListItem","position":2,"name":"오늘의 핫카드","item":"https://cardpick.kr/hot"}
  ]
}
</script>
<script type="application/ld+json">
{
  "@context":"https://schema.org",
  "@type":"CollectionPage",
  "name":"오늘의 포켓몬 핫카드",
  "description":"포켓몬 카드 일일 핫카드 — 7일 급등 TOP 10, 7일 하락 TOP 10, 30일 관심 카드, 검색 급증. TCGplayer 북미 해외 참고가 기준 매일 새벽 자동 계산.",
  "url":"https://cardpick.kr/hot",
  "isPartOf":{"@type":"WebSite","url":"https://cardpick.kr/","name":"카드픽"},
  "inLanguage":"ko",
  "datePublished":"${today}",
  "dateModified":"${today}"
}
</script>
<script type="application/ld+json">
{
  "@context":"https://schema.org",
  "@type":"FAQPage",
  "mainEntity":[
    {"@type":"Question","name":"오늘의 핫카드는 어떻게 선정되나요?","acceptedAnswer":{"@type":"Answer","text":"카드픽 핫카드는 매일 새벽 5시 40분 KST에 자동 계산됩니다. 7일 가격 변동률, 30일 변동률, 현재 가격, 검색 급증 신호, 신뢰도 등급(Trust Gate v1)을 종합해 카테고리별 TOP 10을 산출합니다. 표본이 부족한 카드(distinct 30일 5건 미만)는 자동 제외됩니다."}},
    {"@type":"Question","name":"포켓몬 카드 7일 급등 카드는 무엇인가요?","acceptedAnswer":{"@type":"Answer","text":"최근 7일 사이 가격이 가장 많이 오른 카드입니다. 급등 원인은 신규 발매, 대회 결과, 유튜브 영상, 컬렉터 수요 증가 등 다양합니다. 다만 표본이 적은 카드는 변동률이 과장될 수 있어 신뢰도 등급(HIGH/MEDIUM)도 함께 확인하세요."}},
    {"@type":"Question","name":"핫카드 가격은 실시간인가요?","acceptedAnswer":{"@type":"Answer","text":"실시간은 아닙니다. 매일 새벽 KST 5시 40분에 한 번 갱신되는 일일 스냅샷입니다. 가격은 TCGplayer 북미 market price 기반 해외 참고가(KRW 환산)로 국내 거래가와 다를 수 있습니다."}},
    {"@type":"Question","name":"핫카드 데이터는 어디서 가져오나요?","acceptedAnswer":{"@type":"Answer","text":"Pokémon TCG API(TCGplayer·Cardmarket) 기반입니다. 카드픽은 distinct count, MAD outlier 제거, price-band ratio gate를 거쳐 신뢰도 4단계로 분류한 후 표시합니다. 데이터 방법론은 /methodology에서 공개합니다."}}
  ]
}
</script>
<style>
  html,body{background:#05080D;color:#E8EDF5;font-family:Pretendard,system-ui,sans-serif}
  .mono{font-family:'IBM Plex Mono',ui-monospace,monospace;font-variant-numeric:tabular-nums}
  .hairline{border-color:rgba(255,255,255,0.08)}
  .panel{background:#0D121B;border:1px solid rgba(255,255,255,0.08)}
  .text-up{color:#26E0C2}.text-down{color:#FF4D6D}
  .truncate{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}

  /* === 사이트 표준 cp-topbar (board.html과 동일) === */
  :root{--cp-bg:#05080D;--cp-panel:#0D121B;--cp-line:rgba(255,255,255,0.08);--cp-line-strong:rgba(255,255,255,0.14);--cp-fg:#E8EDF5;--cp-sub:#8B96A8;--cp-dim:#5B6577;--cp-mono:"IBM Plex Mono",ui-monospace,monospace}
  .cp-shell{max-width:1280px;margin:0 auto;padding:0 20px}
  .cp-topbar{position:sticky;top:0;z-index:50;background:#05080D;border-bottom:1px solid var(--cp-line)}
  .cp-topbar-inner{display:flex;align-items:center;gap:24px;height:56px}
  .cp-brand{display:flex;align-items:center;gap:9px;font-weight:700;letter-spacing:-.01em;color:var(--cp-fg);text-decoration:none}
  .cp-brand .cp-mark{width:28px;height:28px;display:block;object-fit:contain;flex:none}
  .cp-brand .cp-name{font-size:15px}
  .cp-brand .cp-en{color:var(--cp-sub);font-family:var(--cp-mono);font-size:11px;letter-spacing:.12em}
  .cp-nav{display:flex;gap:2px;flex:1}
  .cp-nav a{padding:8px 12px;font-size:13.5px;color:var(--cp-sub);border-radius:3px;text-decoration:none}
  .cp-nav a:hover{color:var(--cp-fg);background:rgba(255,255,255,0.04)}
  .cp-nav a.on{color:var(--cp-fg)}
  .cp-search{display:flex;align-items:center;gap:6px;background:var(--cp-panel);border:1px solid var(--cp-line);border-radius:3px;padding:6px 10px;width:240px;color:var(--cp-sub);font-size:12.5px}
  .cp-search kbd{font-family:var(--cp-mono);font-size:10.5px;color:var(--cp-sub);border:1px solid var(--cp-line);padding:1px 5px;border-radius:2px;margin-left:auto}
  .cp-login-google{display:inline-flex;align-items:center;justify-content:center;gap:9px;height:36px;padding:0 13px;border:1px solid var(--cp-line-strong);border-radius:1px;background:#080D15;color:var(--cp-fg);font-size:12.5px;font-weight:600;letter-spacing:-.015em;flex:none;white-space:nowrap;cursor:pointer;text-decoration:none}
  .cp-login-google:hover{border-color:rgba(255,255,255,0.28);background:#0D1420;color:#fff}
  .cp-login-google svg{width:16px;height:16px;display:block;flex:none}
  @media (max-width:980px){.cp-topbar-inner{flex-wrap:wrap;height:auto;min-height:56px;padding:8px 0}.cp-nav{display:flex!important;order:99;flex-basis:100%;overflow-x:auto;scrollbar-width:none;padding:8px 0 4px;gap:0;margin-top:6px;border-top:1px solid var(--cp-line)}.cp-nav::-webkit-scrollbar{display:none}.cp-nav a{padding:8px 12px;font-size:13px;white-space:nowrap;flex-shrink:0}.cp-search{display:none}}
</style>
<!-- Google Analytics (gtag.js) -->
<script async src="https://www.googletagmanager.com/gtag/js?id=G-S1QY1436WG"></script>
<script>
  window.dataLayer = window.dataLayer || [];
  function gtag(){dataLayer.push(arguments);}
  gtag('js', new Date());
  gtag('config', 'G-S1QY1436WG');
</script>
<script src="/auth.js?v=v3clean"></script>
<script src="/search.js?v=20260519ko"></script>
</head><body>
<header class="cp-topbar" role="banner">
  <div class="cp-shell cp-topbar-inner">
    <a href="/" class="cp-brand" aria-label="카드픽 홈">
      <img src="/logo-sm.png" alt="카드픽" class="cp-mark" width="28" height="28">
      <span class="cp-name">카드픽</span>
      <span class="cp-en">CARDPICK</span>
    </a>
    <nav class="cp-nav" aria-label="주 메뉴">
      <a href="/#prices">카드 시세</a>
      <a href="/hot" class="on">트렌드</a>
      <a href="/board">게시판</a>
      <a href="/guides">가이드</a>
      <a href="/tools">도구</a>
      <a href="/releases">뉴스·발매</a>
    </nav>
    <label class="cp-search" aria-label="카드명 검색">
      <span aria-hidden="true" style="font-family:var(--cp-mono)">⌕</span>
      <span style="flex:1;color:var(--cp-dim)">카드명, 세트 코드</span>
      <kbd>⌘K</kbd>
    </label>
    <button type="button" class="cp-login-google" aria-label="Google 계정으로 로그인">
      <svg viewBox="0 0 18 18" aria-hidden="true" focusable="false">
        <path fill="#4285F4" d="M17.64 9.2c0-.64-.06-1.25-.16-1.84H9v3.48h4.84a4.14 4.14 0 0 1-1.8 2.72v2.26h2.91c1.7-1.57 2.69-3.88 2.69-6.62z"/>
        <path fill="#34A853" d="M9 18c2.43 0 4.47-.8 5.96-2.18l-2.91-2.26c-.8.54-1.84.86-3.05.86-2.35 0-4.34-1.58-5.05-3.71H.94v2.33A9 9 0 0 0 9 18z"/>
        <path fill="#FBBC05" d="M3.95 10.71A5.4 5.4 0 0 1 3.67 9c0-.59.1-1.17.28-1.71V4.96H.94A9 9 0 0 0 0 9c0 1.45.35 2.82.94 4.04l3.01-2.33z"/>
        <path fill="#EA4335" d="M9 3.58c1.32 0 2.5.45 3.43 1.35l2.58-2.58C13.46.9 11.42 0 9 0A9 9 0 0 0 .94 4.96l3.01 2.33C4.66 5.16 6.65 3.58 9 3.58z"/>
      </svg>
      <span>Google로 로그인</span>
    </button>
  </div>
</header>

<main class="max-w-[1280px] mx-auto px-5 lg:px-8 py-10">
  <div class="mb-2 mono text-[11px] text-muted tracking-[0.16em]">HOT CARDS · ${today}</div>
  <h1 class="text-[28px] lg:text-[36px] font-black tracking-tight leading-tight mb-3">오늘의 포켓몬 핫카드</h1>
  <p class="text-[14px] text-muted leading-relaxed mb-4 max-w-[720px]">
    Pokémon TCG API 기반 해외 참고가, 7일·30일 가격 변동, 검색량, 업데이트 요청을 종합한 일일 핫카드.
    <span class="text-ink/80">국내 거래가와 다를 수 있습니다.</span>
  </p>
  <div class="mb-8 max-w-[720px] flex flex-wrap gap-2 text-[12px]">
    <span class="mono text-[10px] text-muted tracking-[0.14em] mr-1" style="padding:5px 0">RELATED GUIDES</span>
    <a href="/guide-japan-import" class="hover:underline" style="padding:5px 10px;border:1px solid rgba(127,184,255,0.3);color:#7FB8FF;border-radius:2px">일본 직구 가이드</a>
    <a href="/guide-psa-grading-korea" class="hover:underline" style="padding:5px 10px;border:1px solid rgba(255,224,122,0.3);color:#FFE07A;border-radius:2px">PSA 그레이딩</a>
    <a href="/guide-trade-safety" class="hover:underline" style="padding:5px 10px;border:1px solid rgba(156,92,255,0.3);color:#9C5CFF;border-radius:2px">거래 안전</a>
  </div>

  ${trendTop.length ? `
  <!-- 검색 트렌드 — Naver 데이터랩 -->
  <section class="mb-10 panel" style="background:linear-gradient(180deg,rgba(38,224,194,0.04),rgba(255,176,0,0.02));border:1px solid rgba(38,224,194,0.18);padding:18px 20px;border-radius:3px">
    <div class="flex items-end justify-between flex-wrap gap-2 mb-3">
      <div>
        <h2 class="text-[18px] font-bold text-ink">검색 급증 키워드</h2>
        <p class="text-[12px] text-muted mt-1">네이버 검색어 트렌드 · 전주 대비 증가율 · 매일 09:00 자동 갱신</p>
      </div>
      <span class="mono text-[10px] text-muted tracking-[0.14em]">SOURCE · NAVER DATALAB</span>
    </div>
    <ol class="space-y-1" style="list-style:none;padding:0;margin:0">
      ${(() => { const maxRecent = Math.max(...trendTop.map(x => x.recent || 0.1)); return trendTop.map((t, i) => {
        const hasG = t.growth !== null && isFinite(t.growth);
        const label = hasG ? `${t.growth >= 0 ? '+' : ''}${t.growth.toFixed(0)}%` : t.all.toFixed(1);
        const color = hasG ? (t.growth >= 0 ? '#26E0C2' : '#FF4D6D') : '#8B96A8';
        const barWidth = Math.max(8, Math.min(100, (t.recent / maxRecent) * 100));
        return `
        <li class="flex items-center gap-4 py-2 border-b hairline" style="border-bottom:1px solid rgba(255,255,255,0.06)">
          <span class="mono text-[12px] text-muted w-6 text-right">${String(i+1).padStart(2,'0')}</span>
          <a href="https://search.naver.com/search.naver?query=${encodeURIComponent(t.keyword)}" target="_blank" rel="nofollow noopener" class="flex-1 text-[14px] font-semibold text-ink hover:text-brand" style="text-decoration:none">${esc(t.keyword)}</a>
          <div class="flex-1 max-w-[180px] hidden md:block" style="height:6px;background:rgba(255,255,255,0.05);border-radius:3px;overflow:hidden">
            <div style="width:${barWidth.toFixed(1)}%;height:100%;background:linear-gradient(90deg,#26E0C2,#F2C94C)"></div>
          </div>
          <span class="mono text-[12px]" style="color:${color};min-width:60px;text-align:right">${label}</span>
        </li>
        `;
      }).join(''); })()}
    </ol>
    <p class="text-[11px] text-muted mt-3" style="line-height:1.55">
      최근 7일 평균이 직전 7일 대비 얼마나 늘었는지(%) 기준. 키워드 클릭 시 네이버 검색 결과로 이동합니다.
    </p>
  </section>
  ` : ''}

  ${Object.entries(catLabels)
    .filter(([k]) => (byCat[k] || []).length > 0)
    .map(([k, label]) => `
    <section class="mb-10">
      <h2 class="text-[18px] font-bold mb-3">${label}</h2>
      ${renderCat(k)}
    </section>
  `).join('')}

  ${Object.entries(catLabels).every(([k]) => (byCat[k] || []).length === 0) ? `
    <div class="panel p-8 text-center">
      <div class="mono text-[11px] text-muted tracking-[0.14em] mb-3">⚠ 데이터 누적 중</div>
      <p class="text-[14px] text-muted leading-relaxed">
        포켓몬 카드 핫카드 데이터를 7일 이상 누적해야 의미 있는 변동률이 나옵니다.
        매일 새벽 5:40 자동 계산되며, 표본이 충분히 모이면 자동으로 표시됩니다.
      </p>
    </div>
  ` : ''}

  <div class="mt-10 max-w-[720px] text-[12.5px] text-muted leading-relaxed" style="padding:12px 16px;background:rgba(38,224,194,0.04);border-left:2px solid rgba(38,224,194,0.4);border-radius:2px">
    <strong class="text-ink">시세 산정 기준</strong> — TCGplayer 북미 market price 기반(USD → KRW 환산), 매일 새벽 5시 40분 KST 자동 갱신.
  </div>

  <!-- FAQ (FAQPage JSON-LD와 글자단위 동일 — 스키마↔화면 일치 룰) -->
  <section class="mt-8" aria-labelledby="hot-faq-h">
    <h2 id="hot-faq-h" class="text-[17px] font-bold mb-3">자주 묻는 질문</h2>
    <div class="panel p-5 mb-2">
      <div class="text-[14px] font-semibold text-ink mb-1.5">오늘의 핫카드는 어떻게 선정되나요?</div>
      <div class="text-[13px] text-muted leading-relaxed">카드픽 핫카드는 매일 새벽 5시 40분 KST에 자동 계산됩니다. 7일 가격 변동률, 30일 변동률, 현재 가격, 검색 급증 신호, 신뢰도 등급(Trust Gate v1)을 종합해 카테고리별 TOP 10을 산출합니다. 표본이 부족한 카드(distinct 30일 5건 미만)는 자동 제외됩니다.</div>
    </div>
    <div class="panel p-5 mb-2">
      <div class="text-[14px] font-semibold text-ink mb-1.5">포켓몬 카드 7일 급등 카드는 무엇인가요?</div>
      <div class="text-[13px] text-muted leading-relaxed">최근 7일 사이 가격이 가장 많이 오른 카드입니다. 급등 원인은 신규 발매, 대회 결과, 유튜브 영상, 컬렉터 수요 증가 등 다양합니다. 다만 표본이 적은 카드는 변동률이 과장될 수 있어 신뢰도 등급(HIGH/MEDIUM)도 함께 확인하세요.</div>
    </div>
    <div class="panel p-5 mb-2">
      <div class="text-[14px] font-semibold text-ink mb-1.5">핫카드 가격은 실시간인가요?</div>
      <div class="text-[13px] text-muted leading-relaxed">실시간은 아닙니다. 매일 새벽 KST 5시 40분에 한 번 갱신되는 일일 스냅샷입니다. 가격은 TCGplayer 북미 market price 기반 해외 참고가(KRW 환산)로 국내 거래가와 다를 수 있습니다.</div>
    </div>
    <div class="panel p-5">
      <div class="text-[14px] font-semibold text-ink mb-1.5">핫카드 데이터는 어디서 가져오나요?</div>
      <div class="text-[13px] text-muted leading-relaxed">Pokémon TCG API(TCGplayer·Cardmarket) 기반입니다. 카드픽은 distinct count, MAD outlier 제거, price-band ratio gate를 거쳐 신뢰도 4단계로 분류한 후 표시합니다. 데이터 방법론은 /methodology에서 공개합니다.</div>
    </div>
  </section>

  <div class="mt-4 panel p-5 text-[12px] text-muted leading-relaxed">
    <div class="mono text-[10px] text-ink/80 mb-1.5">⚠ 해외 참고가 안내</div>
    이 가격은 Pokémon TCG API(TCGplayer · Cardmarket) 기반 해외 참고가입니다.
    국내 거래가와 다를 수 있으며, 카드 상태·언어·등급·배송비·환율·거래처에 따라 실제 거래가는 달라질 수 있습니다.
    본 정보는 투자 권유가 아닙니다.
  </div>
</main>

<footer class="border-t hairline mt-12">
  <div class="max-w-[1280px] mx-auto px-5 lg:px-8 py-8 text-[12px] text-muted">
    © 카드픽 cardpick.kr · 해외 참고가 (TCGplayer·Cardmarket)
  </div>
</footer>
</body></html>`;

  const resp = new Response(html, {
    status: 200,
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'public, s-maxage=3600, stale-while-revalidate=600'
    }
  });
  context.waitUntil(edgeCache.put(cacheKey, resp.clone()));
  return resp;
}
