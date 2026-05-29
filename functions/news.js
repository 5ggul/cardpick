// /news — 포켓몬 TCG 뉴스 레이더 (PokéBeach RSS 기반, noindex)
// - 사용자 명시: 처음에는 noindex (자동 수집 페이지가 얇아 보일 위험)
// - 영어 원문 + 자동 한글 짧은 제목 (title_ko) + 출처 링크
// - 본문 번역 복붙 X (summary는 1~2줄만)
// - 이미지 자체 호스팅 X (외부 URL 그대로)
export async function onRequest() {
  const SUPA = 'https://aqxrmdratnkffvivguqs.supabase.co';
  const KEY  = 'sb_publishable_AeDBjfn3ymozGyw06ohMUw_S6n1-qpj';

  function esc(s){ return String(s||'').replace(/[<>&"]/g, c => ({'<':'&lt;','>':'&gt;','&':'&amp;','"':'&quot;'}[c])); }

  // 최근 60일 active 항목, 30개
  let events = [];
  try {
    const r = await fetch(
      `${SUPA}/rest/v1/drop_events?status=eq.active&select=id,source_name,title,title_ko,summary,source_url,image_url,category,tags,country,published_at&order=published_at.desc&limit=30`,
      { headers: { apikey: KEY } }
    );
    if (r.ok) events = await r.json();
  } catch(e) {}

  const today = new Date().toISOString().slice(0,10);

  // 카테고리 한글 라벨
  const CAT_KO = {
    news: '뉴스', release: '발매', lottery: '응모', preorder: '예약 판매',
    event: '이벤트', promo: '프로모'
  };
  const COUNTRY_KO = { GLOBAL: '국제', JP: '일본판', US: '영문판', KR: '한국판' };

  function rel(iso) {
    if (!iso) return '';
    const d = new Date(iso); const now = new Date();
    const diff = (now - d) / 1000;
    if (diff < 3600) return Math.floor(diff/60) + '분 전';
    if (diff < 86400) return Math.floor(diff/3600) + '시간 전';
    if (diff < 86400*7) return Math.floor(diff/86400) + '일 전';
    return d.toLocaleDateString('ko-KR', {year:'numeric', month:'2-digit', day:'2-digit'});
  }

  const cardsHtml = events.map(e => {
    const catLabel = CAT_KO[e.category] || '뉴스';
    const countryLabel = COUNTRY_KO[e.country] || '';
    const titleKo = e.title_ko || catLabel + ' 소식';
    return `
    <article class="news-card">
      <div class="news-meta">
        <span class="chip chip-cat">${esc(catLabel)}</span>
        ${countryLabel ? `<span class="chip chip-country">${esc(countryLabel)}</span>` : ''}
        <span class="news-time">${rel(e.published_at)}</span>
      </div>
      <h3 class="news-title-ko">${esc(titleKo)}</h3>
      <p class="news-title-en">${esc(e.title)}</p>
      ${e.summary ? `<p class="news-summary">${esc(e.summary)}</p>` : ''}
      <div class="news-foot">
        <span class="news-source">출처: ${esc(e.source_name === 'pokebeach' ? 'PokéBeach' : e.source_name)}</span>
        <a class="news-link" href="${esc(e.source_url)}" target="_blank" rel="nofollow noopener external">원문 보기 →</a>
      </div>
    </article>`;
  }).join('') || `<div class="news-empty">아직 수집된 뉴스가 없습니다. 매일 새벽 자동 갱신됩니다.</div>`;

  const html = `<!doctype html>
<html lang="ko"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>포켓몬 TCG 뉴스 레이더 (BETA) | 카드픽</title>
<meta name="description" content="포켓몬 TCG 신규 세트 · 프로모 · 응모 · 이벤트 소식을 해외 출처(PokéBeach 등) 기반으로 정리한 뉴스 레이더 (BETA).">
<meta name="robots" content="noindex,follow">
<link rel="canonical" href="https://cardpick.kr/news">
<link rel="stylesheet" as="style" href="https://cdn.jsdelivr.net/gh/orioncactus/pretendard@v1.3.9/dist/web/static/pretendard.min.css">
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;500;600&display=swap">
<style>
  :root{--cp-bg:#05080D;--cp-panel:#0D121B;--cp-line:rgba(255,255,255,0.08);--cp-line-strong:rgba(255,255,255,0.14);--cp-fg:#E8EDF5;--cp-sub:#8B96A8;--cp-dim:#5B6577;--cp-up:#26E0C2;--cp-warn:#E0B84A;--cp-mono:"IBM Plex Mono",ui-monospace,monospace}
  html,body{background:var(--cp-bg);color:var(--cp-fg);font-family:Pretendard,system-ui,sans-serif;margin:0}
  .mono{font-family:var(--cp-mono)}
  .cp-shell{max-width:980px;margin:0 auto;padding:0 20px}
  .cp-topbar{position:sticky;top:0;z-index:50;background:#05080D;border-bottom:1px solid var(--cp-line)}
  .cp-topbar-inner{display:flex;align-items:center;gap:24px;height:56px}
  .cp-brand{display:flex;align-items:center;gap:9px;font-weight:700;color:var(--cp-fg);text-decoration:none}
  .cp-brand .cp-mark{width:28px;height:28px;display:block;object-fit:contain;flex:none}
  .cp-brand .cp-name{font-size:15px}
  .cp-brand .cp-en{color:var(--cp-sub);font-family:var(--cp-mono);font-size:11px;letter-spacing:.12em}
  .cp-nav{display:flex;gap:2px;flex:1}
  .cp-nav a{padding:8px 12px;font-size:13.5px;color:var(--cp-sub);border-radius:3px;text-decoration:none}
  .cp-nav a:hover{color:var(--cp-fg);background:rgba(255,255,255,0.04)}
  .cp-nav a.on{color:var(--cp-fg)}
  @media (max-width:980px){.cp-topbar-inner{flex-wrap:wrap;height:auto;min-height:56px;padding:8px 0}.cp-nav{display:flex!important;order:99;flex-basis:100%;overflow-x:auto;scrollbar-width:none;padding:8px 0 4px;gap:0;margin-top:6px;border-top:1px solid var(--cp-line)}.cp-nav::-webkit-scrollbar{display:none}.cp-nav a{padding:8px 12px;font-size:13px;white-space:nowrap;flex-shrink:0}}

  main{padding:32px 0 64px}
  .news-head{margin-bottom:24px}
  .news-head h1{font-size:32px;font-weight:800;letter-spacing:-.015em;margin:0 0 8px;color:#FFFFFF}
  .news-head .beta{display:inline-block;font-family:var(--cp-mono);font-size:11px;padding:2px 8px;border:1px solid var(--cp-warn);color:var(--cp-warn);letter-spacing:.12em;border-radius:2px;margin-left:8px;vertical-align:middle}
  .news-head .lead{color:var(--cp-sub);font-size:14px;line-height:1.7;margin:0}
  .news-disclaimer{margin:16px 0 28px;padding:12px 16px;background:rgba(224,184,74,0.05);border-left:3px solid var(--cp-warn);font-size:13px;color:#C8D2E0;line-height:1.65}

  .news-grid{display:grid;grid-template-columns:1fr;gap:14px}
  .news-card{background:var(--cp-panel);border:1px solid var(--cp-line);padding:18px 20px;border-radius:3px;transition:border-color .15s}
  .news-card:hover{border-color:var(--cp-line-strong)}
  .news-meta{display:flex;align-items:center;gap:8px;margin-bottom:8px;flex-wrap:wrap}
  .chip{display:inline-flex;align-items:center;padding:2px 8px;font-family:var(--cp-mono);font-size:11px;letter-spacing:.04em;border:1px solid;border-radius:2px}
  .chip-cat{color:var(--cp-up);border-color:rgba(38,224,194,0.4);background:rgba(38,224,194,0.05)}
  .chip-country{color:var(--cp-warn);border-color:rgba(224,184,74,0.4);background:rgba(224,184,74,0.05)}
  .news-time{color:var(--cp-sub);font-size:12px;font-family:var(--cp-mono);margin-left:auto}
  .news-title-ko{font-size:18px;font-weight:700;color:#FFFFFF;margin:4px 0 4px;letter-spacing:-.01em;line-height:1.4}
  .news-title-en{font-size:13px;color:var(--cp-sub);margin:0 0 8px;line-height:1.55;font-style:italic}
  .news-summary{font-size:13.5px;color:#C8D2E0;line-height:1.7;margin:0 0 12px;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}
  .news-foot{display:flex;justify-content:space-between;align-items:center;font-size:12.5px;flex-wrap:wrap;gap:8px}
  .news-source{color:var(--cp-sub);font-family:var(--cp-mono);font-size:11px}
  .news-link{color:var(--cp-up);text-decoration:none;font-weight:600}
  .news-link:hover{color:#7FE8D6;text-decoration:underline}
  .news-empty{text-align:center;padding:60px 20px;color:var(--cp-sub);font-size:14px}

  @media (max-width:720px){
    .news-head h1{font-size:26px}
    .news-card{padding:16px}
    .news-title-ko{font-size:16px}
    .news-title-en{font-size:12px}
  }
</style>
<script async src="https://www.googletagmanager.com/gtag/js?id=G-S1QY1436WG"></script>
<script>window.dataLayer=window.dataLayer||[];function gtag(){dataLayer.push(arguments)}gtag('js',new Date());gtag('config','G-S1QY1436WG');</script>
<script src="/auth.js?v=v3clean"></script>
<script src="/search.js?v=20260519ko"></script>
</head><body>

<header class="cp-topbar" role="banner">
  <div class="cp-shell cp-topbar-inner">
    <a href="/" class="cp-brand" aria-label="카드픽 홈">
      <img src="/logo.png?v=2" alt="카드픽" class="cp-mark" width="28" height="28">
      <span class="cp-name">카드픽</span>
      <span class="cp-en">CARDPICK</span>
    </a>
    <nav class="cp-nav" aria-label="주 메뉴">
      <a href="/#prices">카드 시세</a>
      <a href="/hot">트렌드</a>
      <a href="/board">게시판</a>
      <a href="/guides">가이드</a>
      <a href="/tools">도구</a>
      <a href="/releases">발매정보</a>
    </nav>
  </div>
</header>

<main class="cp-shell">
  <div class="news-head">
    <h1>포켓몬 TCG 뉴스 레이더<span class="beta">BETA</span></h1>
    <p class="lead">신규 세트·프로모·응모·이벤트 소식을 해외 출처에서 자동으로 수집해 한국어로 정리합니다. 매일 새벽 자동 갱신.</p>
  </div>
  <div class="news-disclaimer">
    <strong>해외 뉴스 기반 참고 정보</strong>입니다. 공식 발표가 아니며, 원문은 출처 링크에서 확인하세요. 자동 한국어 제목은 휴리스틱으로 생성되며 운영자가 점진적으로 보강합니다.
  </div>

  <section class="news-grid">
    ${cardsHtml}
  </section>
</main>

</body></html>`;

  return new Response(html, {
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'public, max-age=300, s-maxage=300'
    }
  });
}
