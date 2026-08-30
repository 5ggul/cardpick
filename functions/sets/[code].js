// /sets/[code] — 세트별 집계 페이지 SSR (평판 회복 2단계, 2026-08-30)
//
// 목적: 25k 얇은 카드 상세 대신 세트별 정보 밀도 높은 페이지 신설로
// Google 색인 회복. 각 세트 페이지 = 발매 정보 + Top 카드 + FAQ + 관련 세트.
export async function onRequest(context) {
  const { params } = context;
  const codeRaw = String(params.code || '').toUpperCase().trim();
  const code = codeRaw.replace(/[^A-Z0-9-]/g, '');
  if (!code) return new Response('Not Found', { status: 404 });

  const SUPA = 'https://aqxrmdratnkffvivguqs.supabase.co';
  const KEY = 'sb_publishable_AeDBjfn3ymozGyw06ohMUw_S6n1-qpj';

  // 엣지 캐시
  const edgeCache = caches.default;
  const cacheKey = new Request(`https://cardpick.kr/__set_ssr_v2_${code}`, { method: 'GET' });
  const cached = await edgeCache.match(cacheKey);
  if (cached) { const h = new Headers(cached.headers); h.set('X-Edge-Cache', 'HIT'); return new Response(cached.body, { status: cached.status, headers: h }); }

  // 1. 이 세트의 카드 전체 (표시 이름 결정용)
  const setCardsRes = await fetch(
    `${SUPA}/rest/v1/cards?select=slug,name,name_ko,number,rarity,set_code,set_name,set_id&game=eq.pokemon&set_code=eq.${encodeURIComponent(code)}&limit=1000`,
    { headers: { apikey: KEY } }
  );
  const setCards = setCardsRes.ok ? await setCardsRes.json() : [];
  if (!setCards.length) return new Response('Set not found', { status: 404 });

  // 세트명 결정 (가장 완전한 이름 선택)
  const setName = setCards[0].set_name || code;
  const setId = setCards[0].set_id || '';
  const totalCards = setCards.length;

  // 2. Trust 조회 (embed 로 cards join, 세트 코드로 필터 — URL 길이 초과 회피)
  const trustRes = await fetch(
    `${SUPA}/rest/v1/card_price_trust?select=card_slug,trust_level,display_krw,distinct_7d,distinct_30d,change_7d_pct,change_30d_pct,cards!inner(set_code)&cards.set_code=eq.${encodeURIComponent(code)}&order=display_krw.desc.nullslast&limit=200`,
    { headers: { apikey: KEY } }
  );
  const trustRows = trustRes.ok ? await trustRes.json() : [];

  // 카드 메타 매핑
  const cardMap = new Map(setCards.map(c => [c.slug, c]));
  const withPrice = trustRows
    .filter(t => t.display_krw != null && cardMap.has(t.card_slug))
    .map(t => ({ ...t, ...cardMap.get(t.card_slug) }));

  // Top 20 (가격순)
  const top20 = withPrice.slice(0, 20);
  // rarity 분포
  const rarityDist = {};
  for (const c of setCards) {
    const r = c.rarity || 'Unknown';
    rarityDist[r] = (rarityDist[r] || 0) + 1;
  }
  const rarityOrder = Object.entries(rarityDist).sort((a, b) => b[1] - a[1]);

  // 신뢰도 통계
  const trustDist = { HIGH: 0, MEDIUM: 0, LOW: 0, NONE: 0 };
  for (const t of trustRows) trustDist[t.trust_level] = (trustDist[t.trust_level] || 0) + 1;
  const highCount = trustDist.HIGH + trustDist.MEDIUM;

  const esc = s => String(s || '').replace(/[<>&"]/g, c => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' }[c]));
  const fmtKrw = n => n ? '₩' + Math.round(Number(n)).toLocaleString('ko-KR') : '—';
  const fmtChg = v => {
    if (v == null) return '—';
    const n = Number(v);
    if (Math.abs(n) < 0.1) return '<span style="color:#8B96A8">0.0%</span>';
    return `<span style="color:${n > 0 ? '#26E0C2' : '#FF4D6D'}">${n > 0 ? '+' : ''}${n.toFixed(1)}%</span>`;
  };

  const title = `${setName} (${code}) 카드 시세·발매 정보·주요 카드 | 카드픽`;
  const description = `${setName} 세트 (${code}) 총 ${totalCards}장 · 참고가 표시 가능 ${highCount}장. 상위 카드 시세, 신뢰도 등급, TCGplayer 북미 기준 해외 참고가를 매일 갱신.`;
  const canonicalUrl = `https://cardpick.kr/sets/${code}`;

  // JSON-LD BreadcrumbList + CollectionPage
  const jsonLd = {
    "@context": "https://schema.org",
    "@graph": [
      {
        "@type": "BreadcrumbList",
        "itemListElement": [
          { "@type": "ListItem", "position": 1, "name": "카드픽", "item": "https://cardpick.kr/" },
          { "@type": "ListItem", "position": 2, "name": "세트", "item": "https://cardpick.kr/releases" },
          { "@type": "ListItem", "position": 3, "name": `${setName} (${code})`, "item": canonicalUrl }
        ]
      },
      {
        "@type": "CollectionPage",
        "name": `${setName} (${code})`,
        "description": description,
        "url": canonicalUrl,
        "isPartOf": { "@type": "WebSite", "name": "카드픽", "url": "https://cardpick.kr/" },
        "about": { "@type": "Thing", "name": `Pokemon TCG ${setName}` }
      }
    ]
  };

  // Top 카드 rows
  const topRows = top20.map((c, i) => {
    const displayName = c.name_ko ? `${c.name_ko} (${c.name})` : c.name;
    return `<tr>
      <td style="padding:12px 14px;border-bottom:1px solid #253044;color:#8B96A8;font-family:'IBM Plex Mono',monospace;font-size:12px;width:36px">${i + 1}</td>
      <td style="padding:12px 14px;border-bottom:1px solid #253044"><a href="/cards/${esc(c.slug)}" style="color:#E8EEF7;text-decoration:none;font-weight:600">${esc(displayName)}</a> <span style="color:#8B96A8;font-family:'IBM Plex Mono',monospace;font-size:11px;margin-left:6px">#${esc(c.number || '')}</span></td>
      <td style="padding:12px 14px;border-bottom:1px solid #253044;color:#8B96A8;font-size:12px">${esc(c.rarity || '')}</td>
      <td style="padding:12px 14px;border-bottom:1px solid #253044;color:#E8EEF7;font-family:'IBM Plex Mono',monospace;font-weight:600;text-align:right">${fmtKrw(c.display_krw)}</td>
      <td style="padding:12px 14px;border-bottom:1px solid #253044;font-family:'IBM Plex Mono',monospace;text-align:right">${fmtChg(c.change_7d_pct)}</td>
      <td style="padding:12px 14px;border-bottom:1px solid #253044;font-family:'IBM Plex Mono',monospace;text-align:right">${fmtChg(c.change_30d_pct)}</td>
    </tr>`;
  }).join('');

  const rarityRows = rarityOrder.slice(0, 10).map(([r, n]) => `
    <div style="display:flex;justify-content:space-between;padding:8px 12px;border-bottom:1px solid #253044;font-size:13px">
      <span style="color:#E8EEF7">${esc(r)}</span>
      <span style="color:#8B96A8;font-family:'IBM Plex Mono',monospace">${n}장</span>
    </div>`).join('');

  const html = `<!doctype html>
<html lang="ko">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(title)}</title>
<meta name="description" content="${esc(description)}">
<meta name="robots" content="index,follow,max-image-preview:large,max-snippet:-1">
<link rel="canonical" href="${canonicalUrl}">
<meta property="og:type" content="article">
<meta property="og:title" content="${esc(title)}">
<meta property="og:description" content="${esc(description)}">
<meta property="og:url" content="${canonicalUrl}">
<meta property="og:image" content="https://cardpick.kr/og.jpg">
<link rel="icon" href="/favicon.ico">
<link rel="preconnect" href="https://cdn.jsdelivr.net">
<link rel="stylesheet" href="https://cdn.jsdelivr.net/gh/orioncactus/pretendard@v1.3.9/dist/web/static/pretendard.min.css">
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;500;600&display=swap">
<script type="application/ld+json">${JSON.stringify(jsonLd)}</script>
<script async src="https://www.googletagmanager.com/gtag/js?id=G-S1QY1436WG"></script>
<script>window.dataLayer=window.dataLayer||[];function gtag(){dataLayer.push(arguments);}gtag('js',new Date());gtag('config','G-S1QY1436WG');</script>
<style>
:root{--bg:#05080D;--panel:#0D121B;--panel2:#111722;--line:rgba(255,255,255,0.08);--fg:#E8EDF5;--sub:#8B96A8;--dim:#5B6577;--up:#26E0C2;--down:#FF4D6D;--mono:'IBM Plex Mono',ui-monospace,monospace}
*{box-sizing:border-box;margin:0;padding:0}
html,body{background:var(--bg);color:var(--fg);font-family:Pretendard,system-ui,sans-serif;-webkit-font-smoothing:antialiased;font-size:14px;line-height:1.65}
a{color:inherit;text-decoration:none}
.cp-shell{max-width:1080px;margin:0 auto;padding:0 20px}
.mono{font-family:var(--mono);font-variant-numeric:tabular-nums}
.cp-topbar{position:sticky;top:0;z-index:50;background:#05080D;border-bottom:1px solid var(--line)}
.cp-topbar-inner{display:flex;align-items:center;gap:24px;height:56px;max-width:1280px;margin:0 auto;padding:0 20px}
.cp-brand{display:flex;align-items:center;gap:9px;font-weight:700;color:var(--fg)}
.cp-brand .cp-name{font-size:15px}
.cp-brand .cp-en{color:var(--sub);font-family:var(--mono);font-size:11px;letter-spacing:.12em}
.cp-nav{display:flex;gap:2px;flex:1;margin-left:8px}
.cp-nav a{padding:8px 12px;font-size:13.5px;color:var(--sub);border-radius:3px}
.cp-nav a:hover{color:var(--fg);background:rgba(255,255,255,0.04)}
.cp-login-google{display:inline-flex;align-items:center;justify-content:center;gap:9px;height:36px;padding:0 13px;border:1px solid rgba(255,255,255,0.14);border-radius:1px;background:#080D15;color:var(--fg);font-size:12.5px;font-weight:600;cursor:pointer;flex:none;white-space:nowrap}
.cp-login-google svg{width:16px;height:16px;flex:none}
@media(max-width:980px){.cp-nav{display:none}}
main{padding:36px 0 80px}
.crumb{font-family:var(--mono);font-size:11px;color:var(--sub);letter-spacing:.06em;margin-bottom:16px}
.crumb a{color:var(--sub)}.crumb a:hover{color:var(--fg)}
h1{font-size:34px;font-weight:800;letter-spacing:-.02em;line-height:1.15;margin-bottom:8px;color:var(--fg)}
.h1-sub{color:var(--sub);font-size:14.5px;margin-bottom:24px}
.stat-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(160px,1fr));gap:12px;margin:24px 0 32px}
.stat{background:var(--panel);border:1px solid var(--line);padding:16px 18px;border-radius:3px}
.stat .lbl{font-family:var(--mono);font-size:10.5px;color:var(--sub);letter-spacing:.14em;text-transform:uppercase;margin-bottom:8px}
.stat .val{font-size:24px;font-weight:800;color:var(--fg);letter-spacing:-.02em}
.stat .sub{font-size:11.5px;color:var(--dim);font-family:var(--mono);margin-top:4px}
h2{font-size:20px;font-weight:700;margin:40px 0 14px;color:var(--fg);padding-bottom:10px;border-bottom:1px solid var(--line)}
.grid-2{display:grid;grid-template-columns:2fr 1fr;gap:24px}
@media(max-width:820px){.grid-2{grid-template-columns:1fr}}
table.top-cards{width:100%;border-collapse:collapse;background:var(--panel);border:1px solid var(--line);border-radius:3px;overflow:hidden}
table.top-cards th{padding:11px 14px;background:#111722;color:var(--sub);font-family:var(--mono);font-size:10.5px;letter-spacing:.14em;text-transform:uppercase;font-weight:600;text-align:left;border-bottom:1px solid var(--line)}
table.top-cards th.num,table.top-cards th.pct{text-align:right}
.rarity-box{background:var(--panel);border:1px solid var(--line);border-radius:3px;padding:12px 0;height:fit-content}
.rarity-box .lbl{font-family:var(--mono);font-size:10.5px;color:var(--sub);letter-spacing:.14em;text-transform:uppercase;padding:6px 14px;margin-bottom:6px}
.faq-item{padding:16px 18px;background:var(--panel);border:1px solid var(--line);border-radius:3px;margin-bottom:10px}
.faq-q{color:var(--fg);font-weight:700;font-size:14.5px;margin-bottom:6px}
.faq-a{color:#C8D2E0;font-size:13.5px;line-height:1.7}
.callout{background:rgba(38,224,194,0.05);border-left:3px solid var(--up);padding:14px 18px;margin:22px 0;font-size:13px;color:#C8D2E0;line-height:1.7}
</style>
</head>
<body>
<header class="cp-topbar">
  <div class="cp-topbar-inner">
    <a href="/" class="cp-brand"><img src="/logo-sm.png" alt="카드픽" width="28" height="28"><span class="cp-name">카드픽</span><span class="cp-en">CARDPICK</span></a>
    <nav class="cp-nav" aria-label="주 메뉴">
      <a href="/#prices">가격</a>
      <a href="/releases">뉴스·발매</a>
      <a href="/guides">가이드</a>
      <a href="/board">게시판</a>
      <a href="/tools">도구</a>
    </nav>
    <button type="button" class="cp-login-google" aria-label="Google로 로그인">
      <svg viewBox="0 0 18 18" aria-hidden="true"><path fill="#4285F4" d="M17.64 9.2c0-.64-.06-1.25-.16-1.84H9v3.48h4.84a4.14 4.14 0 0 1-1.8 2.72v2.26h2.91c1.7-1.57 2.69-3.88 2.69-6.62z"/><path fill="#34A853" d="M9 18c2.43 0 4.47-.8 5.96-2.18l-2.91-2.26c-.8.54-1.84.86-3.05.86-2.35 0-4.34-1.58-5.05-3.71H.94v2.33A9 9 0 0 0 9 18z"/><path fill="#FBBC05" d="M3.95 10.71A5.4 5.4 0 0 1 3.67 9c0-.59.1-1.17.28-1.71V4.96H.94A9 9 0 0 0 0 9c0 1.45.35 2.82.94 4.04l3.01-2.33z"/><path fill="#EA4335" d="M9 3.58c1.32 0 2.5.45 3.43 1.35l2.58-2.58C13.46.9 11.42 0 9 0A9 9 0 0 0 .94 4.96l3.01 2.33C4.66 5.16 6.65 3.58 9 3.58z"/></svg>
      <span>Google로 로그인</span>
    </button>
  </div>
</header>
<main>
<div class="cp-shell">
  <div class="crumb"><a href="/">카드픽</a> › <a href="/releases">세트·발매</a> › ${esc(setName)} (${esc(code)})</div>
  <h1>${esc(setName)} <span style="color:var(--sub);font-family:var(--mono);font-size:22px;font-weight:600;margin-left:8px">${esc(code)}</span></h1>
  <p class="h1-sub">Pokemon TCG 세트 · 총 ${totalCards}장 · TCGplayer 북미 기준 해외 참고가 (KRW 환산) · 매일 05:00 KST 갱신</p>

  <div class="stat-grid">
    <div class="stat"><div class="lbl">Total Cards</div><div class="val">${totalCards}</div><div class="sub">세트 전체 카드 수</div></div>
    <div class="stat"><div class="lbl">Priced (H+M)</div><div class="val" style="color:var(--up)">${highCount}</div><div class="sub">참고가 표시 가능 카드</div></div>
    <div class="stat"><div class="lbl">Top Price</div><div class="val mono">${top20[0] ? fmtKrw(top20[0].display_krw) : '—'}</div><div class="sub">${top20[0] ? esc(top20[0].name_ko || top20[0].name || '') : ''}</div></div>
    <div class="stat"><div class="lbl">Rarity Types</div><div class="val">${rarityOrder.length}</div><div class="sub">희귀도 종류</div></div>
  </div>

  <div class="callout">
    이 페이지의 가격은 <strong style="color:var(--fg)">TCGplayer 북미 market price 기준 해외 참고가</strong>를 원화로 환산한 값입니다. 한국 거래가와는 환율·배송비·관세·카드 상태·언어판·등급에 따라 다를 수 있습니다. Trust Gate v1 (distinct count + MAD outlier 제거 + price-band ratio gate)로 산출한 신뢰도 등급을 함께 표시합니다.
  </div>

  <div class="grid-2">
    <div>
      <h2>주요 카드 Top ${top20.length} (참고가 순)</h2>
      ${top20.length > 0 ? `
      <table class="top-cards">
        <thead><tr><th class="num">#</th><th>카드</th><th>희귀도</th><th class="pct">참고가 (KRW)</th><th class="pct">7일</th><th class="pct">30일</th></tr></thead>
        <tbody>${topRows}</tbody>
      </table>
      ` : '<p style="color:var(--sub);padding:20px;background:var(--panel);border:1px solid var(--line);border-radius:3px">이 세트에는 아직 참고가 표시 가능한 카드가 없습니다. 표본이 쌓이면 자동 표시됩니다.</p>'}
    </div>
    <div>
      <h2>희귀도 분포</h2>
      <div class="rarity-box">
        <div class="lbl">Rarity Distribution</div>
        ${rarityRows || '<div style="padding:10px 14px;color:var(--sub);font-size:13px">데이터 없음</div>'}
      </div>
    </div>
  </div>

  <h2>자주 묻는 질문</h2>
  <div class="faq-item">
    <div class="faq-q">${esc(setName)} (${esc(code)}) 는 어떤 세트인가요?</div>
    <div class="faq-a">${esc(setName)} 는 Pokemon TCG의 정식 세트 중 하나로, 총 ${totalCards}장의 카드로 구성됩니다. 세트 코드는 <span class="mono" style="color:var(--up)">${esc(code)}</span> 이며, 카드픽은 이 세트의 카드 중 <strong style="color:var(--fg)">${highCount}장</strong>에 대해 TCGplayer 북미 시장의 참고가를 매일 갱신합니다.</div>
  </div>
  <div class="faq-item">
    <div class="faq-q">이 세트의 가장 비싼 카드는?</div>
    <div class="faq-a">${top20[0] ? `현재 가장 높은 참고가는 <strong style="color:var(--fg)">${esc(top20[0].name_ko || top20[0].name)}</strong> #${esc(top20[0].number || '')}로 ${fmtKrw(top20[0].display_krw)}입니다. 세트 내 다른 카드의 시세는 위 Top ${top20.length} 목록에서 확인할 수 있습니다.` : '아직 참고가 데이터가 축적되지 않았습니다.'}</div>
  </div>
  <div class="faq-item">
    <div class="faq-q">한국판 시세와 다른 이유는?</div>
    <div class="faq-a">카드픽 참고가는 <strong style="color:var(--fg)">TCGplayer 북미 시장</strong>의 market price 기준입니다. 한국 국내 거래는 배송비, 환율, 관세, 카드 상태, 언어판(한판/일판/영판), 등급에 따라 시세가 다릅니다. 국내 실거래는 중고나라·번개장터·전문 매장을 함께 참고하세요.</div>
  </div>
  <div class="faq-item">
    <div class="faq-q">가격 신뢰도 등급은 어떻게 결정되나요?</div>
    <div class="faq-a">Trust Gate v1 알고리즘으로 distinct 표본 수 + MAD outlier 제거 + price-band별 ratio gate를 통과한 카드만 참고가를 표시합니다. HIGH (실측 최신), MEDIUM (30일 중앙값), LOW (표본 부족), NONE (참고가 산출 불가) 4단계로 분류합니다. 상세: <a href="/methodology" style="color:var(--up)">방법론</a></div>
  </div>

  <h2>관련 링크</h2>
  <ul style="padding-left:22px;color:#C8D2E0;line-height:2;font-size:14px">
    <li><a href="/releases" style="color:var(--up)">전체 세트·발매 정보</a></li>
    <li><a href="/hot" style="color:var(--up)">전 세트 핫 카드 트렌드</a></li>
    <li><a href="/guides" style="color:var(--up)">가이드 허브</a></li>
    <li><a href="/methodology" style="color:var(--up)">데이터 방법론 (Trust Gate v1)</a></li>
  </ul>
</div>
</main>
<script defer src="/js/cp-notif.js"></script>
</body>
</html>`;

  const resp = new Response(html, {
    status: 200,
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'public, max-age=3600',
      'X-Cardpick-SSR': 'sets',
      'X-Set-Total-Cards': String(totalCards),
      'X-Set-High-Cards': String(highCount)
    }
  });
  context.waitUntil(edgeCache.put(cacheKey, resp.clone()));
  return resp;
}
