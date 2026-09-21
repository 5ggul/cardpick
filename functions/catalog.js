// /catalog: 검색과 주요 카드 진입점을 서버 HTML로 제공하는 카탈로그 허브
export async function onRequest(context) {
  const SUPA = 'https://aqxrmdratnkffvivguqs.supabase.co';
  const KEY = 'sb_publishable_AeDBjfn3ymozGyw06ohMUw_S6n1-qpj';

  function esc(value) {
    return String(value || '').replace(/[<>&"]/g, (char) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' })[char]);
  }

  function fmtKrw(value) {
    return value ? `₩${Math.round(Number(value)).toLocaleString('ko-KR')}` : '참고가 없음';
  }

  function printedNumber(value) {
    return String(value || '').split('/')[0].trim().replace(/^0+/, '') || '0';
  }

  let cards = [];
  let updatedDate = '';
  let dataError = false;

  try {
    const trustResponse = await fetch(
      `${SUPA}/rest/v1/card_price_trust?select=card_slug,computed_at,display_krw,trust_level&trust_level=in.(HIGH,MEDIUM)&display_krw=gte.5000&order=display_krw.desc&limit=100`,
      { headers: { apikey: KEY } }
    );
    if (!trustResponse.ok) throw new Error(`trust ${trustResponse.status}`);
    const trustRows = await trustResponse.json();

    if (trustRows.length) {
      const slugs = trustRows.map((row) => `"${String(row.card_slug).replace(/"/g, '\\"')}"`).join(',');
      const cardResponse = await fetch(
        `${SUPA}/rest/v1/cards?select=slug,name,name_ko,set_code,set_name,number,rarity_class&game=eq.pokemon&slug=in.(${slugs})`,
        { headers: { apikey: KEY } }
      );
      if (!cardResponse.ok) throw new Error(`cards ${cardResponse.status}`);

      const cardBySlug = new Map((await cardResponse.json()).map((card) => [card.slug, card]));
      const selected = new Map();
      for (const row of trustRows) {
        const card = cardBySlug.get(row.card_slug);
        if (!card) continue;
        const key = `${String(card.set_code || '').toLowerCase()}|${String(card.name || '').toLowerCase()}|${printedNumber(card.number)}`;
        const candidate = { ...card, display_krw: Number(row.display_krw), trust_level: row.trust_level, computed_at: row.computed_at };
        const current = selected.get(key);
        if (!current || (/-{2,}/.test(current.slug) && !/-{2,}/.test(candidate.slug))) selected.set(key, candidate);
      }
      cards = [...selected.values()].filter((card) => !/-{2,}/.test(card.slug)).slice(0, 36);
      updatedDate = cards.map((card) => String(card.computed_at || '').slice(0, 10)).filter(Boolean).sort().at(-1) || '';
    }
  } catch {
    dataError = true;
  }

  const hasCatalog = cards.length >= 12;
  const robots = hasCatalog ? 'index,follow,max-image-preview:large' : 'noindex,follow';
  const cardLinks = cards.map((card, index) => {
    const name = card.name_ko ? `${esc(card.name_ko)} <span lang="en">${esc(card.name)}</span>` : `<span lang="en">${esc(card.name)}</span>`;
    const contextLine = [card.set_name || card.set_code, card.number ? `#${card.number}` : '', card.rarity_class].filter(Boolean).map(esc).join(' · ');
    return `<li>
      <a class="catalog-row" href="/cards/${encodeURIComponent(card.slug)}">
        <span class="rank">${String(index + 1).padStart(2, '0')}</span>
        <span class="identity"><strong>${name}</strong><small>${contextLine}</small></span>
        <span class="trust trust-${String(card.trust_level).toLowerCase()}">${esc(card.trust_level)}</span>
        <span class="price">${fmtKrw(card.display_krw)}</span>
        <span class="arrow" aria-hidden="true">→</span>
      </a>
    </li>`;
  }).join('');

  // 검색 유입과 카드 식별 오류가 실제로 확인된 카드 중 편집 검수를 마친 소수만 고정 노출한다.
  const reviewedCards = [
    { slug: 'phanpy-205', name: '코코리 (Phanpy) #205', detail: 'Surging Sparks · Illustration Rare' },
    { slug: 'kyurem-ex-28', name: '큐레무 ex (Kyurem ex) #28', detail: 'Black Bolt · Double Rare' },
    { slug: 'umbreon-ex-161', name: '블래키 ex (Umbreon ex) #161', detail: 'Prismatic Evolutions · SIR' },
    { slug: 'pikachu-with-grey-felt-hat-85', name: '피카츄 with Grey Felt Hat #85', detail: '프로모 카드 · 카드 번호 확인' },
    { slug: 'mew-ex-232', name: '뮤 ex (Mew ex) #232', detail: 'Paldean Fates · SIR' },
    { slug: 'giratina-v-186', name: '기라티나 V (Giratina V) #186', detail: 'Lost Origin · Alternate Art' },
    { slug: 'mega-charizard-x-ex-125', name: '메가리자몽 X ex #125', detail: 'Phantasmal Flames · SIR' },
    { slug: 'charizard-ex-199', name: '리자몽 ex (Charizard ex) #199', detail: 'Scarlet & Violet 151 · SIR' }
  ];
  const reviewedLinks = reviewedCards.map((card) => `<li><a href="/cards/${encodeURIComponent(card.slug)}"><strong>${esc(card.name)}</strong><span>${esc(card.detail)}</span><i aria-hidden="true">→</i></a></li>`).join('');

  const reviewedSlugs = new Set(reviewedCards.map((card) => card.slug));
  const schemaCards = [
    ...reviewedCards.map((card) => ({ slug: card.slug, name: card.name })),
    ...cards.filter((card) => !reviewedSlugs.has(card.slug))
  ].slice(0, 20);
  const itemList = schemaCards.map((card, index) => ({
    '@type': 'ListItem',
    position: index + 1,
    url: `https://cardpick.kr/cards/${encodeURIComponent(card.slug)}`,
    name: card.name_ko ? `${card.name_ko} (${card.name})` : card.name
  }));
  const schema = JSON.stringify({
    '@context': 'https://schema.org',
    '@type': 'CollectionPage',
    name: '포켓몬 카드 검색 — 이름·세트·카드 번호로 찾기',
    url: 'https://cardpick.kr/catalog',
    description: '한국어·영문 카드명, 세트 코드와 카드 번호로 포켓몬 카드를 찾고 검수 카드의 해외 참고가를 확인하는 검색 허브',
    inLanguage: 'ko',
    mainEntity: { '@type': 'ItemList', numberOfItems: itemList.length, itemListElement: itemList }
  }).replace(/</g, '\\u003c');

  const emptyState = dataError
    ? '카드 목록을 가져오지 못했습니다. 검색은 정상적으로 이용할 수 있습니다.'
    : '현재 표시할 카드 목록을 준비하고 있습니다. 검색을 이용해 주세요.';

  const html = `<!doctype html>
<html lang="ko">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>포켓몬 카드 검색 — 이름·세트·카드 번호로 찾기 | 카드픽</title>
<meta name="description" content="포켓몬 카드 이름, 영문명, 세트 코드와 카드 번호로 25,000장 이상의 카탈로그를 검색하세요. 검수 카드의 해외 참고가와 같은 이름의 다른 수록판 구분법도 확인할 수 있습니다.">
<meta name="robots" content="${robots}">
<link rel="canonical" href="https://cardpick.kr/catalog">
<meta property="og:type" content="website">
<meta property="og:title" content="포켓몬 카드 검색 — 이름·세트·번호로 찾기 | 카드픽">
<meta property="og:description" content="한국어·영문 카드명, 세트 코드, 카드 번호로 찾고 검수된 카드 정보를 확인하세요.">
<meta property="og:url" content="https://cardpick.kr/catalog">
<meta name="theme-color" content="#05080D">
<style>
:root{--bg:#05080D;--panel:#0D121B;--panel-2:#111722;--line:rgba(255,255,255,.08);--line-strong:rgba(255,255,255,.14);--ink:#E8EDF5;--muted:#8B96A8;--dim:#7C8798;--mint:#26E0C2;--gold:#D8B84A;--sans:"Pretendard Variable",Pretendard,-apple-system,BlinkMacSystemFont,system-ui,sans-serif;--mono:'IBM Plex Mono',ui-monospace,monospace}
*{box-sizing:border-box}html,body{margin:0;padding:0;background:var(--bg);color:var(--ink);font-family:var(--sans);font-size:14px;line-height:1.5;-webkit-font-smoothing:antialiased}a{color:inherit}.mono,.rank,.price,.trust,.eyebrow{font-family:var(--mono);font-variant-numeric:tabular-nums}
.skip-link{position:absolute;left:12px;top:8px;z-index:100;transform:translateY(-140%);background:var(--mint);color:#04100E;padding:8px 12px;font-weight:700;font-size:12px;text-decoration:none}.skip-link:focus{transform:translateY(0)}
.site-header{position:sticky;top:0;z-index:20;border-bottom:1px solid var(--line);background:#05080D}.header-inner{max-width:1280px;height:56px;margin:auto;padding:0 20px;display:flex;align-items:center;gap:24px}.brand{display:flex;align-items:center;gap:9px;font-weight:700;text-decoration:none}.brand img{width:28px;height:28px;object-fit:contain}.brand .name{font-size:15px}.brand .en{color:var(--muted);font:11px var(--mono);letter-spacing:.12em}.nav{display:flex;flex:1;gap:2px;overflow:auto;scrollbar-width:none}.nav::-webkit-scrollbar{display:none}.nav a{flex:none;padding:8px 12px;color:var(--muted);font-size:13.5px;text-decoration:none}.nav a[aria-current="page"],.nav a:hover{color:var(--ink);background:rgba(255,255,255,.04)}
.statusbar{border-bottom:1px solid var(--line);background:linear-gradient(90deg,#070B12,#05080D)}.status-inner{max-width:1280px;height:34px;margin:auto;padding:0 20px;display:flex;align-items:center;gap:18px;color:var(--muted);font:11.5px var(--mono)}.status-dot{width:6px;height:6px;border-radius:50%;background:var(--mint);box-shadow:0 0 0 3px rgba(38,224,194,.12)}
main{max-width:1280px;margin:auto;padding:18px 20px 80px}.hero{display:grid;grid-template-columns:310px minmax(0,1fr);min-height:106px;border:1px solid var(--line-strong);background:#070B12;overflow:hidden;border-radius:4px;animation:rise .35s ease-out both}.hero-title{position:relative;padding:19px 18px;border-right:1px solid var(--line);background:linear-gradient(180deg,#101824,#090D14)}.eyebrow{display:block;margin-bottom:6px;color:var(--mint);font-size:10px;letter-spacing:.14em}.hero h1{margin:0;color:#fff;font-size:20px;line-height:1.25;letter-spacing:-.03em}.hero .micro{display:block;margin-top:8px;color:var(--muted);font:10px var(--mono);letter-spacing:.04em}.scope{display:flex;align-items:center;justify-content:space-between;gap:24px;padding:18px 22px;color:var(--muted);font-size:12.5px;line-height:1.65}.scope strong{display:block;color:var(--ink);font-size:13px}.scope-date{flex:none;text-align:right;font:11px var(--mono);color:var(--muted)}
.search{margin:18px 0 10px;display:flex;align-items:center;min-height:56px;border:1px solid var(--line-strong);border-radius:4px;background:var(--panel);transition:border-color .16s,box-shadow .16s;animation:rise .35s .06s ease-out both}.search:focus-within{border-color:var(--mint);box-shadow:0 0 0 3px rgba(38,224,194,.08)}.search-mark{padding-left:16px;color:var(--muted);font:14px var(--mono)}.search input{min-width:0;flex:1;padding:16px 12px;border:0;outline:0;background:transparent;color:var(--ink);font:14px var(--sans)}.search input::placeholder{color:var(--dim)}.search button{align-self:stretch;border:0;border-left:1px solid var(--line);background:transparent;color:var(--mint);font:600 11px var(--mono);cursor:pointer;padding:0 20px}.search button:hover{background:rgba(38,224,194,.06)}
.quick{display:flex;align-items:center;flex-wrap:wrap;gap:6px;margin-bottom:24px;color:var(--dim);font:10px var(--mono)}.quick a{padding:5px 9px;border:1px solid var(--line);color:var(--muted);font:12px var(--sans);text-decoration:none;transition:border-color .16s,color .16s,transform .16s}.quick a:hover{border-color:var(--line-strong);color:var(--ink);background:rgba(255,255,255,.03);transform:translateY(-1px)}
.reviewed{margin-bottom:24px;border-top:1px solid var(--line-strong)}.reviewed-head{display:flex;justify-content:space-between;gap:24px;padding:17px 0 13px}.reviewed-head h2{margin:0;font-size:17px;letter-spacing:-.025em}.reviewed-head p{margin:2px 0 0;color:var(--muted);font-size:11px}.reviewed-list{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));list-style:none;margin:0;padding:0;border-bottom:1px solid var(--line)}.reviewed-list li{border-top:1px solid var(--line)}.reviewed-list li:nth-child(odd){border-right:1px solid var(--line)}.reviewed-list a{display:grid;grid-template-columns:minmax(0,1fr) auto;grid-template-areas:'name arrow' 'detail arrow';gap:3px 14px;align-items:center;padding:14px 12px;text-decoration:none;transition:background .16s,padding .16s}.reviewed-list a:hover{padding-left:17px;background:rgba(38,224,194,.04)}.reviewed-list strong{grid-area:name;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:13px}.reviewed-list span{grid-area:detail;color:var(--muted);font:10px var(--mono)}.reviewed-list i{grid-area:arrow;color:var(--mint);font-style:normal}
.section-head{display:flex;justify-content:space-between;align-items:end;gap:24px;margin-bottom:18px}.section-head h2{margin:0;font-size:25px;letter-spacing:-.03em}.section-head p{margin:0;color:var(--muted);font-size:12px}.catalog-list{list-style:none;margin:0;padding:0;border-top:1px solid var(--line)}.catalog-list li{border-bottom:1px solid var(--line)}.catalog-row{display:grid;grid-template-columns:48px minmax(0,1fr) 76px 130px 20px;gap:16px;align-items:center;padding:17px 8px;text-decoration:none;transition:background .16s,padding .16s}.catalog-row:hover{background:rgba(38,224,194,.045);padding-left:14px}.rank{color:var(--dim);font-size:11px}.identity{min-width:0}.identity strong{display:block;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:15px}.identity strong span{margin-left:7px;color:var(--muted);font-size:12px;font-weight:500}.identity small{display:block;margin-top:5px;color:var(--muted);font:11px 'IBM Plex Mono',monospace;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.trust{font-size:10px;letter-spacing:.08em}.trust-high{color:var(--mint)}.trust-medium{color:var(--gold)}.price{text-align:right;font-size:13px}.arrow{color:var(--muted)}
.empty{padding:44px 0;border-top:1px solid var(--line);border-bottom:1px solid var(--line);color:var(--muted)}
.section-head{margin-top:0;padding:13px 16px;border:1px solid var(--line);border-bottom:0;background:var(--panel);align-items:center}.section-head h2{font-size:14px;letter-spacing:-.01em}.section-head p{font:10.5px var(--mono)}.catalog-list{border:1px solid var(--line)}.catalog-row{padding:14px 16px}.catalog-row:hover{padding-left:20px}
.method{display:grid;grid-template-columns:repeat(3,1fr);margin-top:20px;border:1px solid var(--line);background:#070B12}.method article{padding:20px}.method article+article{border-left:1px solid var(--line)}.method b{display:block;margin-bottom:7px;color:var(--mint);font:10px var(--mono);letter-spacing:.1em}.method h2{margin:0 0 7px;font-size:14px}.method p{margin:0;color:var(--muted);font-size:12px;line-height:1.65}.method a{color:var(--ink);text-underline-offset:3px}.price-note{display:flex;justify-content:space-between;gap:24px;margin-top:12px;padding:14px 16px;border-left:2px solid var(--mint);background:rgba(38,224,194,.035);color:var(--muted);font-size:11.5px}.price-note strong,.price-note a{color:var(--ink)}.price-note a{flex:none;text-underline-offset:3px}.final-links{display:flex;gap:10px;margin-top:18px}.final-links a{padding:8px 10px;border:1px solid var(--line);color:var(--muted);font-size:12px;text-decoration:none}.final-links a:hover{color:var(--ink);border-color:var(--line-strong)}footer{max-width:1280px;margin:auto;padding:20px;border-top:1px solid var(--line);color:var(--muted);font-size:11px}
@keyframes rise{from{opacity:0;transform:translateY(7px)}to{opacity:1;transform:translateY(0)}}
@media(max-width:980px){.header-inner{flex-wrap:wrap;height:auto;min-height:56px;padding:8px 20px}.nav{order:99;flex-basis:100%;padding:8px 0 4px;border-top:1px solid var(--line)}.hero{grid-template-columns:220px minmax(0,1fr)}}
@media(max-width:760px){.header-inner{padding:8px 16px}.brand .en{display:none}.nav a{padding:7px 10px;font-size:12px}.status-inner{padding:0 16px}main{padding:14px 16px 64px}.hero{grid-template-columns:1fr}.hero-title{border-right:0;border-bottom:1px solid var(--line)}.scope{display:block;padding:14px 16px}.scope-date{text-align:left;margin-top:6px}.search{margin-top:14px}.search button{padding:0 13px}.quick{margin-bottom:20px}.reviewed-head{display:block}.reviewed-head p{margin-top:5px}.reviewed-list{grid-template-columns:1fr}.reviewed-list li:nth-child(odd){border-right:0}.reviewed-list a{padding:13px 8px}.reviewed-list a:hover{padding-left:8px}.section-head{align-items:start;flex-direction:column;gap:4px}.catalog-row{grid-template-columns:32px minmax(0,1fr) 92px 16px;gap:9px;padding:14px 10px}.catalog-row:hover{padding-left:10px}.trust{display:none}.identity strong{font-size:14px}.identity strong span{display:block;margin:3px 0 0}.identity small{font-size:10px}.price{font-size:12px}.method{grid-template-columns:1fr}.method article+article{border-left:0;border-top:1px solid var(--line)}.price-note{display:block}.final-links{flex-direction:column;gap:6px}}
@media(prefers-reduced-motion:reduce){*{scroll-behavior:auto!important;transition:none!important}}
</style>
<script type="application/ld+json">${schema}</script>
</head>
<body>
<a class="skip-link" href="#main">본문으로 이동</a>
<header class="site-header"><div class="header-inner"><a class="brand" href="/"><img src="/logo-sm.png" alt="" width="28" height="28"><span class="name">카드픽</span><span class="en">CARDPICK</span></a><nav class="nav" aria-label="주요 메뉴"><a href="/#prices">카드 시세</a><a href="/catalog" aria-current="page">카드 검색</a><a href="/hot">트렌드</a><a href="/board">게시판</a><a href="/guides">가이드</a><a href="/tools">도구</a><a href="/releases">뉴스·발매</a></nav></div></header>
<div class="statusbar"><div class="status-inner"><span class="status-dot" aria-hidden="true"></span><span>실물 영문 Pokémon TCG</span><span>해외 참고가</span></div></div>
<main id="main" tabindex="-1">
  <section class="hero">
    <div class="hero-title"><span class="eyebrow">CARD DATABASE</span><h1>포켓몬 카드 검색</h1><span class="micro">이름 · 세트 · 카드 번호로 찾기</span></div>
    <div class="scope"><div><strong>한국어와 영문 카드명을 모두 검색할 수 있습니다.</strong>같은 포켓몬도 세트와 번호가 다르면 별도 카드입니다. 검색 결과에서 두 정보를 함께 확인하세요.</div><div class="scope-date">${updatedDate ? `가격 집계 ${esc(updatedDate)}` : '집계 상태 확인 중'}</div></div>
  </section>
  <form class="search" action="/search" method="get"><label for="catalog-q" style="position:absolute;left:-9999px">포켓몬 카드 이름, 세트 또는 카드 번호 검색</label><span class="search-mark" aria-hidden="true">⌕</span><input id="catalog-q" name="q" type="search" placeholder="예: 리자몽 ex, PFL, 125" autocomplete="off" enterkeyhint="search"><button type="submit">카드 찾기</button></form>
  <div class="quick" aria-label="빠른 검색"><span>검색 예시</span><a href="/search?q=피카츄">피카츄</a><a href="/search?q=리자몽+ex">리자몽 ex</a><a href="/search?q=Umbreon">Umbreon</a><a href="/search?q=PFL">세트 PFL</a><a href="/search?q=205">번호 205</a></div>
  <section class="reviewed" aria-labelledby="reviewed-title">
    <div class="reviewed-head"><div><h2 id="reviewed-title">직접 확인한 카드</h2><p>세트·카드 번호·레어도와 중복 수록판을 대조한 상세 페이지입니다.</p></div><span class="eyebrow">EDITOR REVIEWED · 8</span></div>
    <ul class="reviewed-list">${reviewedLinks}</ul>
  </section>
  <section aria-labelledby="catalog-list-title"><div class="section-head"><h2 id="catalog-list-title">가격 데이터가 있는 카드</h2><p>${hasCatalog ? `${cards.length}장 · HIGH/MEDIUM · 가격순` : '목록 준비 중'}</p></div>${hasCatalog ? `<ol class="catalog-list">${cardLinks}</ol>` : `<div class="empty">${esc(emptyState)}</div>`}</section>
  <section class="method" aria-label="포켓몬 카드 찾는 방법">
    <article><b>01 · NAME</b><h2>카드 이름으로 찾기</h2><p>리자몽 또는 Charizard처럼 한국어·영문 이름을 입력하세요. ex, V, VMAX 같은 표기도 함께 쓰면 결과가 더 정확합니다.</p></article>
    <article><b>02 · SET</b><h2>세트 코드로 좁히기</h2><p>카드 하단의 SSP, PFL, PRE 같은 영문 세트 코드를 검색하면 같은 이름의 다른 수록판을 구분하기 쉽습니다.</p></article>
    <article><b>03 · NUMBER</b><h2>카드 번호 확인하기</h2><p>205 또는 028/086처럼 카드 하단 번호를 확인하세요. 짧은 번호와 전체 번호가 같은 카드를 뜻할 수도 있습니다.</p></article>
  </section>
  <div class="price-note"><span><strong>가격 표시 기준</strong> · TCGplayer 북미 가격을 원화로 환산한 해외 참고가이며 국내 거래가가 아닙니다.</span><a href="/methodology">신뢰도와 산정 방법 →</a></div>
  <div class="final-links"><a href="/guide-card-price">가격 확인 방법</a><a href="/guide-fake-detection">가품 확인</a><a href="/about">운영 기준</a></div>
</main>
<footer>© 카드픽 cardpick.kr · 정보 제공 사이트 · 거래 중개 없음</footer>
</body></html>`;

  return new Response(html, {
    status: 200,
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'public, s-maxage=3600, stale-while-revalidate=300'
    }
  });
}
