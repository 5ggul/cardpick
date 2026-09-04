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

  const itemList = cards.slice(0, 20).map((card, index) => ({
    '@type': 'ListItem',
    position: index + 1,
    url: `https://cardpick.kr/cards/${encodeURIComponent(card.slug)}`,
    name: card.name_ko ? `${card.name_ko} (${card.name})` : card.name
  }));
  const schema = JSON.stringify({
    '@context': 'https://schema.org',
    '@type': 'CollectionPage',
    name: '포켓몬 카드 카탈로그',
    url: 'https://cardpick.kr/catalog',
    description: '영문 포켓몬 카드 검색과 해외 참고가가 있는 주요 카드 진입점',
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
<title>포켓몬 카드 카탈로그: 카드 검색·해외 참고가 | 카드픽</title>
<meta name="description" content="포켓몬 카드명, 세트, 번호를 검색하고 신뢰도 기준을 통과한 영문판 카드의 해외 참고가를 확인하세요. 국내 거래가와 다를 수 있습니다.">
<meta name="robots" content="${robots}">
<link rel="canonical" href="https://cardpick.kr/catalog">
<meta property="og:type" content="website">
<meta property="og:title" content="포켓몬 카드 카탈로그 | 카드픽">
<meta property="og:description" content="카드 검색과 해외 참고가가 있는 주요 포켓몬 카드 진입점">
<meta property="og:url" content="https://cardpick.kr/catalog">
<meta name="theme-color" content="#05080D">
<style>
:root{--bg:#05080D;--panel:#0D121B;--panel-2:#111722;--line:rgba(255,255,255,.08);--line-strong:rgba(255,255,255,.14);--ink:#E8EDF5;--muted:#8B96A8;--dim:#7C8798;--mint:#26E0C2;--gold:#D8B84A;--sans:"Pretendard Variable",Pretendard,-apple-system,BlinkMacSystemFont,system-ui,sans-serif;--mono:'IBM Plex Mono',ui-monospace,monospace}
*{box-sizing:border-box}html,body{margin:0;padding:0;background:var(--bg);color:var(--ink);font-family:var(--sans);font-size:14px;line-height:1.5;-webkit-font-smoothing:antialiased}a{color:inherit}.mono,.rank,.price,.trust,.eyebrow{font-family:var(--mono);font-variant-numeric:tabular-nums}
.skip-link{position:absolute;left:12px;top:8px;z-index:100;transform:translateY(-140%);background:var(--mint);color:#04100E;padding:8px 12px;font-weight:700;font-size:12px;text-decoration:none}.skip-link:focus{transform:translateY(0)}
.site-header{position:sticky;top:0;z-index:20;border-bottom:1px solid var(--line);background:#05080D}.header-inner{max-width:1280px;height:56px;margin:auto;padding:0 20px;display:flex;align-items:center;gap:24px}.brand{display:flex;align-items:center;gap:9px;font-weight:700;text-decoration:none}.brand img{width:28px;height:28px;object-fit:contain}.brand .name{font-size:15px}.brand .en{color:var(--muted);font:11px var(--mono);letter-spacing:.12em}.nav{display:flex;flex:1;gap:2px;overflow:auto;scrollbar-width:none}.nav::-webkit-scrollbar{display:none}.nav a{flex:none;padding:8px 12px;color:var(--muted);font-size:13.5px;text-decoration:none}.nav a[aria-current="page"],.nav a:hover{color:var(--ink);background:rgba(255,255,255,.04)}
.statusbar{border-bottom:1px solid var(--line);background:linear-gradient(90deg,#070B12,#05080D)}.status-inner{max-width:1280px;height:34px;margin:auto;padding:0 20px;display:flex;align-items:center;gap:18px;color:var(--muted);font:11.5px var(--mono)}.status-dot{width:6px;height:6px;border-radius:50%;background:var(--mint);box-shadow:0 0 0 3px rgba(38,224,194,.12)}
main{max-width:1280px;margin:auto;padding:18px 20px 80px}.hero{display:grid;grid-template-columns:244px minmax(0,1fr);min-height:92px;border:1px solid var(--line-strong);background:#070B12;overflow:hidden;border-radius:4px}.hero-title{position:relative;padding:16px;border-right:1px solid var(--line);background:linear-gradient(180deg,#101824,#090D14)}.eyebrow{display:block;margin-bottom:5px;color:var(--mint);font-size:10px;letter-spacing:.14em}.hero h1{margin:0;color:#fff;font-size:18px;line-height:1.2;letter-spacing:-.025em}.hero .micro{display:block;margin-top:7px;color:var(--muted);font:10px var(--mono);letter-spacing:.04em}.scope{display:flex;align-items:center;justify-content:space-between;gap:24px;padding:18px 22px;color:var(--muted);font-size:12.5px;line-height:1.65}.scope strong{display:block;color:var(--ink);font-size:13px}.scope-date{flex:none;text-align:right;font:11px var(--mono);color:var(--muted)}
.search{margin:18px 0 10px;display:flex;align-items:center;min-height:52px;border:1px solid var(--line-strong);border-radius:4px;background:var(--panel);transition:border-color .16s}.search:focus-within{border-color:var(--mint)}.search-mark{padding-left:16px;color:var(--muted);font:14px var(--mono)}.search input{min-width:0;flex:1;padding:15px 12px;border:0;outline:0;background:transparent;color:var(--ink);font:14px var(--sans)}.search input::placeholder{color:var(--dim)}.search button{align-self:stretch;border:0;border-left:1px solid var(--line);background:transparent;color:var(--mint);font:600 11px var(--mono);cursor:pointer;padding:0 18px}.search button:hover{background:rgba(38,224,194,.06)}
.quick{display:flex;align-items:center;flex-wrap:wrap;gap:6px;margin-bottom:20px;color:var(--dim);font:10px var(--mono)}.quick a{padding:4px 8px;border:1px solid var(--line);color:var(--muted);font:12px var(--sans);text-decoration:none}.quick a:hover{border-color:var(--line-strong);color:var(--ink);background:rgba(255,255,255,.03)}
.section-head{display:flex;justify-content:space-between;align-items:end;gap:24px;margin-bottom:18px}.section-head h2{margin:0;font-size:25px;letter-spacing:-.03em}.section-head p{margin:0;color:var(--muted);font-size:12px}.catalog-list{list-style:none;margin:0;padding:0;border-top:1px solid var(--line)}.catalog-list li{border-bottom:1px solid var(--line)}.catalog-row{display:grid;grid-template-columns:48px minmax(0,1fr) 76px 130px 20px;gap:16px;align-items:center;padding:17px 8px;text-decoration:none;transition:background .16s,padding .16s}.catalog-row:hover{background:rgba(38,224,194,.045);padding-left:14px}.rank{color:var(--dim);font-size:11px}.identity{min-width:0}.identity strong{display:block;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:15px}.identity strong span{margin-left:7px;color:var(--muted);font-size:12px;font-weight:500}.identity small{display:block;margin-top:5px;color:var(--muted);font:11px 'IBM Plex Mono',monospace;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.trust{font-size:10px;letter-spacing:.08em}.trust-high{color:var(--mint)}.trust-medium{color:var(--gold)}.price{text-align:right;font-size:13px}.arrow{color:var(--muted)}
.empty{padding:44px 0;border-top:1px solid var(--line);border-bottom:1px solid var(--line);color:var(--muted)}
.section-head{margin-top:0;padding:13px 16px;border:1px solid var(--line);border-bottom:0;background:var(--panel);align-items:center}.section-head h2{font-size:14px;letter-spacing:-.01em}.section-head p{font:10.5px var(--mono)}.catalog-list{border:1px solid var(--line)}.catalog-row{padding:14px 16px}.catalog-row:hover{padding-left:20px}
.method{display:grid;grid-template-columns:repeat(3,1fr);margin-top:20px;border:1px solid var(--line);background:#070B12}.method article{padding:20px}.method article+article{border-left:1px solid var(--line)}.method b{display:block;margin-bottom:7px;color:var(--mint);font:10px var(--mono);letter-spacing:.1em}.method h2{margin:0 0 7px;font-size:14px}.method p{margin:0;color:var(--muted);font-size:12px;line-height:1.65}.method a{color:var(--ink);text-underline-offset:3px}.final-links{display:flex;gap:10px;margin-top:18px}.final-links a{padding:8px 10px;border:1px solid var(--line);color:var(--muted);font-size:12px;text-decoration:none}.final-links a:hover{color:var(--ink);border-color:var(--line-strong)}footer{max-width:1280px;margin:auto;padding:20px;border-top:1px solid var(--line);color:var(--muted);font-size:11px}
@media(max-width:980px){.header-inner{flex-wrap:wrap;height:auto;min-height:56px;padding:8px 20px}.nav{order:99;flex-basis:100%;padding:8px 0 4px;border-top:1px solid var(--line)}.hero{grid-template-columns:220px minmax(0,1fr)}}
@media(max-width:760px){.header-inner{padding:8px 16px}.brand .en{display:none}.nav a{padding:7px 10px;font-size:12px}.status-inner{padding:0 16px}main{padding:14px 16px 64px}.hero{grid-template-columns:1fr}.hero-title{border-right:0;border-bottom:1px solid var(--line)}.scope{display:block;padding:14px 16px}.scope-date{text-align:left;margin-top:6px}.search{margin-top:14px}.search button{padding:0 13px}.section-head{align-items:start;flex-direction:column;gap:4px}.catalog-row{grid-template-columns:32px minmax(0,1fr) 92px 16px;gap:9px;padding:14px 10px}.catalog-row:hover{padding-left:10px}.trust{display:none}.identity strong{font-size:14px}.identity strong span{display:block;margin:3px 0 0}.identity small{font-size:10px}.price{font-size:12px}.method{grid-template-columns:1fr}.method article+article{border-left:0;border-top:1px solid var(--line)}.final-links{flex-direction:column;gap:6px}}
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
    <div class="hero-title"><span class="eyebrow">CARD DATABASE</span><h1>포켓몬 카드 검색</h1><span class="micro">카드명, 세트 코드, 카드 번호</span></div>
    <div class="scope"><div><strong>카드픽 카탈로그</strong>가격 데이터가 있고 신뢰도가 HIGH 또는 MEDIUM인 카드를 표시합니다.</div><div class="scope-date">${updatedDate ? `최근 집계 ${esc(updatedDate)}` : '집계 상태 확인 중'}</div></div>
  </section>
  <form class="search" action="/search" method="get"><label for="catalog-q" style="position:absolute;left:-9999px">카드 검색어</label><span class="search-mark" aria-hidden="true">⌕</span><input id="catalog-q" name="q" type="search" placeholder="카드명, 세트 코드, 카드 번호 검색" autocomplete="off"><button type="submit">검색</button></form>
  <div class="quick" aria-label="빠른 검색"><span>빠른 검색</span><a href="/search?q=피카츄">피카츄</a><a href="/search?q=리자몽">리자몽</a><a href="/search?q=블래키">블래키</a><a href="/search?q=뮤">뮤</a><a href="/search?q=개굴닌자">개굴닌자</a></div>
  <section aria-labelledby="catalog-list-title"><div class="section-head"><h2 id="catalog-list-title">가격 데이터가 있는 카드</h2><p>${hasCatalog ? `${cards.length}장 · HIGH/MEDIUM · 가격순` : '목록 준비 중'}</p></div>${hasCatalog ? `<ol class="catalog-list">${cardLinks}</ol>` : `<div class="empty">${esc(emptyState)}</div>`}</section>
  <section class="method" aria-label="카탈로그 이용 기준">
    <article><b>PRICE</b><h2>가격 기준</h2><p>TCGplayer 북미 가격을 원화로 환산한 해외 참고가입니다. 국내 거래가와 다를 수 있습니다.</p></article>
    <article><b>TRUST</b><h2>신뢰도</h2><p>표본과 이상치 검사 결과에 따라 HIGH, MEDIUM 등급을 구분합니다. <a href="/methodology">산정 기준 보기</a></p></article>
    <article><b>SEARCH</b><h2>검색 범위</h2><p>목록에 없는 카드도 검색할 수 있습니다. 표본이 부족하면 가격을 표시하지 않습니다.</p></article>
  </section>
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
