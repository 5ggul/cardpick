// /guides — 카드픽 가이드 허브 (카드 그리드 + 카테고리 탭)
// HTML 가이드 파일 목록을 한눈에 볼 수 있는 카탈로그 페이지.
// 발행 글이 늘어나면 자동으로 그리드에 추가.
export async function onRequest() {
  function esc(s){ return String(s||'').replace(/[<>&"]/g, c => ({'<':'&lt;','>':'&gt;','&':'&amp;','"':'&quot;'}[c])); }

  // 카드픽 발행 가이드 글 카탈로그 (정적 manifest)
  // 새 가이드 발행 시 여기에 항목 추가하면 그리드에 자동 노출.
  const GUIDES = [
    {
      slug: 'guide-what-is-tcg',
      title: 'TCG란? 트레이딩 카드 게임 입문 가이드',
      cat: 'intro',
      catLabel: '입문',
      catColor: '#26E0C2',
      excerpt: 'TCG의 정의부터 포켓몬·원피스·매직·유희왕 등 5대 트레이딩 카드 게임 종류, 입문 방법, 시세 흐름까지 한 번에 정리.',
      date: '2026-05-19',
      readTime: '8분',
      thumb: '/images/guides/what-is-tcg-hero.png',
      heroBg: 'linear-gradient(135deg, #1A2230 0%, #0D1A1F 100%)'
    },
    {
      slug: 'guide-trade-safety',
      title: '카드 거래 안전 체크리스트',
      cat: 'safety',
      catLabel: '거래 안전',
      catColor: '#9C5CFF',
      excerpt: '판매자 평판, 사진 인증, 안전결제, 외부 카톡 거래 거절까지 7단계로 정리한 중고거래 안전 가이드.',
      date: '2026-05-18',
      readTime: '10분',
      thumb: '/images/guides/trade-safety-hero.png',
      heroBg: 'linear-gradient(135deg, #15101F 0%, #111620 100%)'
    },
    {
      slug: 'guide-psa-grading-korea',
      title: '포켓몬 카드 PSA 그레이딩 신청 방법 — 한국에서 보내는 법',
      cat: 'grade',
      catLabel: '그레이딩',
      catColor: '#FFE07A',
      excerpt: '한국에서 PSA로 카드 보내는 완전 가이드. 비용·기간·신청 단계·자주 하는 실수 7가지·BRG10 비교까지 처음 보내는 분도 한 번에.',
      date: '2026-05-21',
      readTime: '12분',
      thumb: '/images/guides/psa-grading-hero.png?v=4',
      heroBg: 'linear-gradient(135deg, #1F1A0F 0%, #0F0D08 100%)'
    },
    {
      slug: 'guide-japan-import',
      title: '포켓몬 카드 일본 직구 완전 가이드 — 한판·일판 차이, 비용, 통관',
      cat: 'import',
      catLabel: '해외 직구',
      catColor: '#7FB8FF',
      excerpt: '한판 vs 일판 시세 차이, 메루카리·야후옥션·포케카닷컴·아마존JP 구매처 비교, 배송 대행 vs 직배송, 진짜 비용 계산, 통관 관세 기준까지 한 번에.',
      date: '2026-05-22',
      readTime: '14분',
      thumb: '/images/guides/japan-import-hero.png?v=2',
      heroBg: 'linear-gradient(135deg, #15151F 0%, #0F0D08 100%)'
    }
  ];

  // 카테고리 필터 옵션 (이모티콘 없이 글씨만)
  const ALL_CATS = [
    { key: 'all',    label: '전체' },
    { key: 'intro',  label: '입문' },
    { key: 'safety', label: '거래 안전' },
    { key: 'price',  label: '시세 분석' },
    { key: 'grade',  label: '그레이딩' },
    { key: 'import', label: '해외 직구' }
  ];

  // 카드 한 장 렌더
  function renderCard(g) {
    const fallbackBg = esc(g.heroBg || 'linear-gradient(135deg, #1A2230 0%, #0D1A1F 100%)');
    const heroContent = g.thumb
      ? `<img src="${esc(g.thumb)}" alt="${esc(g.title)} 썸네일" loading="lazy" class="hero-img" onerror="this.style.display='none';this.parentNode.style.background='${fallbackBg}'">`
      : `<div class="hero-fill" style="background:${fallbackBg}"></div>`;
    return `
    <a href="/${esc(g.slug)}" class="guide-card group" data-cat="${esc(g.cat)}">
      <div class="hero">
        ${heroContent}
      </div>
      <div class="body">
        <div class="meta">
          <span class="cat-chip" style="color:${esc(g.catColor)};border-color:${esc(g.catColor)}">${esc(g.catLabel)}</span>
          <span class="mono date">${esc(g.date)}</span>
          <span class="mono read">${esc(g.readTime)}</span>
        </div>
        <h3 class="title">${esc(g.title)}</h3>
        <p class="excerpt">${esc(g.excerpt)}</p>
        <span class="cta">읽어보기 →</span>
      </div>
    </a>`;
  }

  // JSON-LD: CollectionPage + ItemList
  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "CollectionPage",
    "name": "카드픽 가이드 — 포켓몬·TCG 입문부터 거래까지",
    "description": "TCG 입문, 카드 거래 안전, 시세 해석, 그레이딩 등 카드픽 운영자가 직접 정리한 한국어 가이드 모음.",
    "url": "https://cardpick.kr/guides",
    "inLanguage": "ko",
    "isPartOf": { "@type": "WebSite", "name": "카드픽", "url": "https://cardpick.kr/" },
    "mainEntity": {
      "@type": "ItemList",
      "numberOfItems": GUIDES.length,
      "itemListElement": GUIDES.map((g, i) => ({
        "@type": "ListItem",
        "position": i + 1,
        "url": `https://cardpick.kr/${g.slug}`,
        "item": {
          "@type": "Article",
          "@id": `https://cardpick.kr/${g.slug}`,
          "url": `https://cardpick.kr/${g.slug}`,
          "headline": g.title,
          "description": g.excerpt,
          "datePublished": g.date,
          "image": g.thumb ? `https://cardpick.kr${g.thumb}` : undefined,
          "inLanguage": "ko",
          "author": { "@type": "Organization", "name": "카드픽", "url": "https://cardpick.kr/" }
        }
      }))
    }
  };

  const breadcrumb = {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    "itemListElement": [
      { "@type": "ListItem", "position": 1, "name": "카드픽", "item": "https://cardpick.kr/" },
      { "@type": "ListItem", "position": 2, "name": "가이드", "item": "https://cardpick.kr/guides" }
    ]
  };

  const html = `<!doctype html>
<html lang="ko"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>카드픽 가이드 — 포켓몬 TCG 입문부터 거래까지 | 카드픽</title>
<meta name="description" content="TCG 입문, 카드 거래 안전, 시세 해석, 그레이딩 등 카드픽 운영자가 정리한 한국어 가이드 모음. 처음 시작하는 분도 한 번에 흐름을 잡을 수 있습니다.">
<meta name="robots" content="index,follow,max-image-preview:large,max-snippet:-1">
<link rel="canonical" href="https://cardpick.kr/guides">
<link rel="icon" href="/favicon.ico" sizes="any">
<link rel="alternate" type="application/rss+xml" title="카드픽 가이드 RSS — 신규 글 + 오늘의 핫카드" href="https://cardpick.kr/rss.xml">

<meta property="og:type" content="website">
<meta property="og:url" content="https://cardpick.kr/guides">
<meta property="og:title" content="카드픽 가이드 — 포켓몬 TCG 입문부터 거래까지">
<meta property="og:description" content="TCG 입문, 카드 거래 안전, 시세 해석, 그레이딩까지 한국어 가이드 모음.">
<meta property="og:image" content="https://cardpick.kr/og.jpg">

<link rel="stylesheet" href="https://cdn.jsdelivr.net/gh/orioncactus/pretendard@v1.3.9/dist/web/static/pretendard.min.css">
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;500;600&display=swap">
<script src="https://cdn.tailwindcss.com"></script>
<script>tailwind.config={theme:{extend:{colors:{bg:'#05080D',panel:'#0D121B',panel2:'#111722',line:'rgba(255,255,255,0.08)',ink:'#E8EDF5',muted:'#8B96A8',up:'#26E0C2',down:'#FF4D6D',brand:'#26E0C2',gold:'#F2C94C'}}}}</script>

<script type="application/ld+json">${JSON.stringify(breadcrumb)}</script>
<script type="application/ld+json">${JSON.stringify(jsonLd)}</script>

<style>
  html,body{background:#05080D;color:#E8EDF5;font-family:Pretendard,system-ui,sans-serif}
  .mono{font-family:'IBM Plex Mono',ui-monospace,monospace;font-variant-numeric:tabular-nums}
  .hairline{border-color:rgba(255,255,255,0.08)}

  /* ===== 통합 헤더 (다른 페이지와 동일) ===== */
  :root {
    --cp-bg:#05080D; --cp-panel:#0D121B; --cp-panel-2:#111722;
    --cp-line:rgba(255,255,255,0.08); --cp-line-strong:rgba(255,255,255,0.14);
    --cp-fg:#E8EDF5; --cp-sub:#8B96A8; --cp-dim:#5B6577;
    --cp-up:#26E0C2; --cp-mono:"IBM Plex Mono",ui-monospace,SFMono-Regular,Menlo,monospace;
  }
  .cp-shell{max-width:1280px;margin:0 auto;padding:0 20px}
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
  .cp-search{display:flex;align-items:center;gap:6px;background:var(--cp-panel);border:1px solid var(--cp-line);border-radius:3px;padding:6px 10px;width:240px;color:var(--cp-sub);font-size:12.5px}
  .cp-search kbd{font-family:var(--cp-mono);font-size:10.5px;color:var(--cp-sub);border:1px solid var(--cp-line);padding:1px 5px;border-radius:2px;margin-left:auto}
  .cp-login-google{display:inline-flex;align-items:center;justify-content:center;gap:9px;height:36px;padding:0 13px;border:1px solid var(--cp-line-strong);border-radius:1px;background:#080D15;color:var(--cp-fg);font-size:12.5px;font-weight:600;cursor:pointer;text-decoration:none;flex:none;white-space:nowrap}
  .cp-login-google svg{width:16px;height:16px;display:block;flex:none}
  @media (max-width:980px){.cp-topbar-inner{flex-wrap:wrap;height:auto;min-height:56px;padding:8px 0}.cp-nav{display:flex!important;order:99;flex-basis:100%;overflow-x:auto;scrollbar-width:none;padding:8px 0 4px;gap:0;margin-top:6px;border-top:1px solid var(--cp-line)}.cp-nav::-webkit-scrollbar{display:none}.cp-nav a{padding:8px 12px;font-size:13px;white-space:nowrap;flex-shrink:0}.cp-search{display:none}}

  /* Hub header */
  .hub-head {
    padding: 56px 0 32px;
    border-bottom: 1px solid rgba(255,255,255,0.08);
    background: radial-gradient(ellipse at 20% 0%, rgba(38,224,194,0.04), transparent 60%);
  }
  .hub-eyebrow {
    display: inline-flex; align-items: center; gap: 8px;
    font-family: 'IBM Plex Mono', monospace;
    font-size: 10.5px; color: #26E0C2;
    letter-spacing: 0.18em; text-transform: uppercase;
    margin-bottom: 14px;
  }
  .hub-eyebrow::before { content: ""; width: 24px; height: 1px; background: #26E0C2; }
  .hub-title { font-size: 38px; font-weight: 900; letter-spacing: -0.025em; line-height: 1.08; color: #fff; margin-bottom: 14px; }
  @media (min-width: 1024px) { .hub-title { font-size: 48px; } }
  .hub-sub { font-size: 15px; color: #8B96A8; line-height: 1.65; max-width: 680px; }

  /* Category tabs */
  .cat-tabs {
    display: flex; gap: 4px; padding: 24px 0 28px;
    overflow-x: auto; white-space: nowrap;
    scrollbar-width: none;
  }
  .cat-tabs::-webkit-scrollbar { display: none; }
  .cat-tab {
    display: inline-flex; align-items: center;
    padding: 8px 16px;
    border: 1px solid rgba(255,255,255,0.08);
    background: #0D121B;
    color: #8B96A8;
    font-size: 13px; font-weight: 500;
    cursor: pointer; transition: all 0.15s ease;
    border-radius: 2px;
    flex-shrink: 0;
    letter-spacing: -0.005em;
  }
  .cat-tab:hover { color: #E8EDF5; border-color: rgba(255,255,255,0.18); }
  .cat-tab.on { color: #04100E; background: #26E0C2; border-color: #26E0C2; font-weight: 600; }

  /* Card grid */
  .guide-grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
    gap: 20px;
    padding: 0 0 60px;
  }
  @media (max-width: 640px) {
    .guide-grid { grid-template-columns: 1fr; gap: 14px; }
  }

  .guide-card {
    display: flex; flex-direction: column;
    background: #0D121B;
    border: 1px solid rgba(255,255,255,0.08);
    border-radius: 3px;
    overflow: hidden;
    transition: transform 0.18s ease, border-color 0.18s ease, box-shadow 0.18s ease;
    text-decoration: none;
    color: inherit;
  }
  .guide-card:hover {
    transform: translateY(-3px);
    border-color: rgba(38,224,194,0.4);
    box-shadow: 0 12px 32px rgba(0,0,0,0.4), 0 0 24px rgba(38,224,194,0.08);
  }

  /* Hero (실제 썸네일 이미지 or 그라데이션 fallback) */
  .guide-card .hero {
    position: relative;
    aspect-ratio: 16/9;
    overflow: hidden;
    border-bottom: 1px solid rgba(255,255,255,0.05);
    background: #0A0E15;
  }
  .guide-card .hero-img {
    width: 100%; height: 100%;
    object-fit: cover;
    display: block;
    transition: transform 0.4s ease;
  }
  .guide-card:hover .hero-img { transform: scale(1.04); }
  .guide-card .hero-fill { position: absolute; inset: 0; }

  /* Body */
  .guide-card .body { padding: 18px 18px 20px; flex: 1; display: flex; flex-direction: column; }
  .guide-card .meta {
    display: flex; align-items: center; gap: 10px; flex-wrap: wrap;
    margin-bottom: 10px;
  }
  .guide-card .cat-chip {
    display: inline-flex; align-items: center;
    padding: 2px 8px; border: 1px solid;
    font-family: 'IBM Plex Mono', monospace;
    font-size: 10.5px; letter-spacing: 0.04em; font-weight: 600;
    background: rgba(255,255,255,0.02);
  }
  .guide-card .date, .guide-card .read {
    font-size: 10.5px; color: #5B6577; letter-spacing: 0.02em;
  }
  .guide-card .title {
    font-size: 16.5px; font-weight: 700; color: #E8EDF5;
    line-height: 1.4; letter-spacing: -0.015em;
    margin-bottom: 8px;
    display: -webkit-box; -webkit-line-clamp: 2; line-clamp: 2;
    -webkit-box-orient: vertical; overflow: hidden;
  }
  .guide-card:hover .title { color: #fff; }
  .guide-card .excerpt {
    font-size: 13px; color: #8B96A8;
    line-height: 1.6;
    display: -webkit-box; -webkit-line-clamp: 3; line-clamp: 3;
    -webkit-box-orient: vertical; overflow: hidden;
    flex: 1;
  }
  .guide-card .cta {
    display: inline-flex; align-items: center; gap: 4px;
    margin-top: 14px;
    font-size: 12px; font-weight: 600; color: #26E0C2;
    letter-spacing: -0.01em;
  }

  /* RSS subscribe */
  .rss-row {
    display: flex; align-items: center; gap: 14px; flex-wrap: wrap;
    margin-top: 20px; padding-top: 18px;
    border-top: 1px solid rgba(255,255,255,0.06);
  }
  .rss-row .rss-label {
    font-family: 'IBM Plex Mono', monospace;
    font-size: 10.5px; color: #5B6577; letter-spacing: 0.16em;
  }
  .rss-btn {
    display: inline-flex; align-items: center; gap: 8px;
    padding: 7px 13px;
    background: rgba(255,150,30,0.04);
    border: 1px solid rgba(255,150,30,0.28);
    color: #FF961E;
    font-size: 12.5px; font-weight: 600;
    text-decoration: none; border-radius: 2px;
    letter-spacing: -0.01em;
    transition: all 0.15s ease;
  }
  .rss-btn:hover { background: rgba(255,150,30,0.09); border-color: rgba(255,150,30,0.55); }
  .rss-btn svg { width: 13px; height: 13px; flex: none }
  .rss-link-plain {
    font-size: 12px; color: #8B96A8;
    text-decoration: none; border-bottom: 1px dotted rgba(139,150,168,0.4);
  }
  .rss-link-plain:hover { color: #E8EDF5; border-bottom-color: #E8EDF5; }

  /* Empty state */
  .empty-state {
    padding: 60px 24px; text-align: center;
    border: 1px dashed rgba(255,255,255,0.12);
    border-radius: 3px;
    background: rgba(255,255,255,0.01);
  }
  .empty-state .mono { font-size: 11px; color: #5B6577; letter-spacing: 0.14em; margin-bottom: 8px; }
  .empty-state p { font-size: 13.5px; color: #8B96A8; }
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

<!-- HEADER (다른 페이지와 동일한 cp-topbar 구조) -->
<header class="cp-topbar" role="banner">
  <div class="cp-shell cp-topbar-inner">
    <a href="/" class="cp-brand" aria-label="카드픽 홈">
      <img src="/logo.png?v=2" alt="카드픽" class="cp-mark" width="28" height="28">
      <span class="cp-name">카드픽</span>
      <span class="cp-en">CARDPICK</span>
    </a>
    <nav class="cp-nav" aria-label="주 메뉴">
      <a href="/#prices">참고가</a>
      <a href="/releases">발매정보</a>
      <a href="/guides" class="on">가이드</a>
      <a href="/tools">도구</a>
      <a href="/board">게시판</a>
    </nav>
    <label class="cp-search" aria-label="카드명 검색">
      <span aria-hidden="true" style="font-family:var(--cp-mono)">⌕</span>
      <span style="flex:1;color:var(--cp-dim)">카드명, 세트 코드</span>
      <kbd>⌘K</kbd>
    </label>
    <button type="button" class="cp-login-google" aria-label="Google 계정으로 로그인">
      <svg viewBox="0 0 18 18" aria-hidden="true">
        <path fill="#4285F4" d="M17.64 9.2c0-.64-.06-1.25-.16-1.84H9v3.48h4.84a4.14 4.14 0 0 1-1.8 2.72v2.26h2.91c1.7-1.57 2.69-3.88 2.69-6.62z"/>
        <path fill="#34A853" d="M9 18c2.43 0 4.47-.8 5.96-2.18l-2.91-2.26c-.8.54-1.84.86-3.05.86-2.35 0-4.34-1.58-5.05-3.71H.94v2.33A9 9 0 0 0 9 18z"/>
        <path fill="#FBBC05" d="M3.95 10.71A5.4 5.4 0 0 1 3.67 9c0-.59.1-1.17.28-1.71V4.96H.94A9 9 0 0 0 0 9c0 1.45.35 2.82.94 4.04l3.01-2.33z"/>
        <path fill="#EA4335" d="M9 3.58c1.32 0 2.5.45 3.43 1.35l2.58-2.58C13.46.9 11.42 0 9 0A9 9 0 0 0 .94 4.96l3.01 2.33C4.66 5.16 6.65 3.58 9 3.58z"/>
      </svg>
      <span>Google로 로그인</span>
    </button>
  </div>
</header>

<main class="max-w-[1280px] mx-auto px-5 lg:px-8">

  <!-- HUB HEADER -->
  <section class="hub-head">
    <div class="hub-eyebrow">CARDPICK · GUIDE HUB</div>
    <h1 class="hub-title">카드픽 가이드</h1>
    <p class="hub-sub">
      TCG가 처음인 분, 거래에서 한 번 데인 분, 시세를 더 정확히 보고 싶은 분 모두를 위한 한국어 가이드 모음입니다.
      입문부터 거래 안전, 그레이딩, 해외 직구까지 단계별로 정리했습니다.
    </p>

    <div class="rss-row">
      <span class="rss-label">UPDATES</span>
      <a href="/rss.xml" class="rss-btn" aria-label="카드픽 가이드 RSS 피드 구독">
        <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
          <path d="M6.18 15.64a2.18 2.18 0 1 1 0 4.36 2.18 2.18 0 0 1 0-4.36zM4 4.44A19.56 19.56 0 0 1 23.56 24h-2.83A16.73 16.73 0 0 0 4 7.27V4.44zm0 5.66a13.9 13.9 0 0 1 13.9 13.9h-2.83A11.07 11.07 0 0 0 4 12.93V10.1z"/>
        </svg>
        <span>RSS 구독</span>
      </a>
      <a href="/rss.xml" class="rss-link-plain">/rss.xml 직접 열기</a>
    </div>
  </section>

  <!-- CATEGORY TABS -->
  <nav class="cat-tabs" aria-label="가이드 카테고리">
    ${ALL_CATS.map(c => `
      <button type="button" class="cat-tab ${c.key === 'all' ? 'on' : ''}" data-cat="${esc(c.key)}">${esc(c.label)}</button>
    `).join('')}
  </nav>

  <!-- CARD GRID -->
  <section class="guide-grid" id="guide-grid">
    ${GUIDES.map(renderCard).join('')}

    <!-- 발행 예정 placeholder (그라데이션만, 텍스트 없음) -->
    <div class="guide-card" style="opacity:0.5;pointer-events:none">
      <div class="hero">
        <div class="hero-fill" style="background:linear-gradient(135deg, #1A1410 0%, #111620 100%)"></div>
      </div>
      <div class="body">
        <div class="meta">
          <span class="cat-chip" style="color:#F2C94C;border-color:#F2C94C">시세 분석</span>
          <span class="mono date">발행 예정</span>
        </div>
        <h3 class="title">시세 변동률 읽는 법 — 7일·30일 변화의 의미</h3>
        <p class="excerpt">카드 시세에서 +12% 같은 숫자는 무엇을 의미할까요. 변동 폭과 표본 수를 함께 보는 법, 거래 결정 전 확인할 신호를 정리합니다.</p>
        <span class="cta" style="color:#5B6577">곧 공개</span>
      </div>
    </div>

    <div class="guide-card" style="opacity:0.5;pointer-events:none">
      <div class="hero">
        <div class="hero-fill" style="background:linear-gradient(135deg, #15101F 0%, #111620 100%)"></div>
      </div>
      <div class="body">
        <div class="meta">
          <span class="cat-chip" style="color:#C084FC;border-color:#C084FC">그레이딩</span>
          <span class="mono date">발행 예정</span>
        </div>
        <h3 class="title">PSA 그레이딩 — 접수 방식과 등급별 기준</h3>
        <p class="excerpt">PSA·BGS 같은 카드 등급 평가 기관에 카드를 보내는 절차, 등급 판정 기준, 비용과 소요 기간, 한국에서 접수하는 방법을 정리합니다.</p>
        <span class="cta" style="color:#5B6577">곧 공개</span>
      </div>
    </div>

    <div class="guide-card" style="opacity:0.5;pointer-events:none">
      <div class="hero">
        <div class="hero-fill" style="background:linear-gradient(135deg, #0F1F1A 0%, #111620 100%)"></div>
      </div>
      <div class="body">
        <div class="meta">
          <span class="cat-chip" style="color:#7FB8FF;border-color:#7FB8FF">해외 직구</span>
          <span class="mono date">발행 예정</span>
        </div>
        <h3 class="title">일본 카드 직구 — 절차와 비용 한눈에</h3>
        <p class="excerpt">대행료, 배송비, 관세 면제 한도, 환율 변동 같은 변수가 한 번에 들어옵니다. 어떤 카드는 직구가, 어떤 카드는 국내가 더 유리한지 정리합니다.</p>
        <span class="cta" style="color:#5B6577">곧 공개</span>
      </div>
    </div>
  </section>

  <!-- 데이터 출처 안내 -->
  <div class="border hairline panel p-5 mb-12" style="background:rgba(255,255,255,0.01)">
    <div class="mono text-[10.5px] text-muted tracking-[0.16em] mb-2">⚠ 가격 정보 안내</div>
    <p class="text-[12.5px] text-muted leading-relaxed">
      카드픽의 모든 가격은 <strong class="text-ink">TCGplayer 북미 market price</strong> 기준의 해외 참고가입니다 (USD 원가 → KRW 환산).
      국내 거래가는 카드 상태·언어판·등급·배송비·환율·거래처에 따라 다를 수 있어 참고용으로만 보세요. 본 정보는 투자 권유가 아닙니다.
    </p>
  </div>

</main>

<footer class="border-t hairline mt-12">
  <div class="max-w-[1280px] mx-auto px-5 lg:px-8 py-8 text-[12px] text-muted flex flex-wrap gap-4">
    <span>© 2026 CARDPICK</span>
    <span>해외 참고가 · TCGplayer 북미 기준</span>
    <span style="margin-left:auto"><a href="/" class="hover:text-ink">홈으로 →</a></span>
  </div>
</footer>

<script>
  // 카테고리 필터
  document.querySelectorAll('.cat-tab').forEach(function(btn){
    btn.addEventListener('click', function(){
      var cat = btn.dataset.cat;
      document.querySelectorAll('.cat-tab').forEach(function(b){ b.classList.toggle('on', b === btn); });
      document.querySelectorAll('.guide-card').forEach(function(card){
        var cardCat = card.dataset.cat;
        var show = cat === 'all' || cardCat === cat;
        card.style.display = show ? '' : 'none';
      });
    });
  });
</script>

</body></html>`;

  return new Response(html, {
    status: 200,
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'public, max-age=300',
      'X-Cardpick-SSR': 'guides-hub'
    }
  });
}
