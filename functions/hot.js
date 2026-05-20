// /hot — 오늘의 포켓몬 핫카드 SSR
export async function onRequest(context) {
  const SUPA = 'https://aqxrmdratnkffvivguqs.supabase.co';
  const KEY = 'sb_publishable_AeDBjfn3ymozGyw06ohMUw_S6n1-qpj';

  let rows = [];
  try {
    const res = await fetch(`${SUPA}/rest/v1/rpc/get_hot_cards`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', apikey: KEY },
      body: JSON.stringify({})
    });
    if (res.ok) rows = await res.json();
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
    high_value: '고가 카드 TOP',
    fresh: '신규 갱신',
    rising_30d: '30일 관심 카드',
    search_surge: '검색 급증',
    requested: '업데이트 요청 많은',
  };

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
        <span class="mono text-[10px] text-muted hidden md:inline w-32 truncate text-right">${esc(r.reason||'')}</span>
      </li>`).join('')}</ol>`;
  }

  const today = new Date().toISOString().slice(0,10);
  const html = `<!doctype html>
<html lang="ko"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>오늘의 포켓몬 핫카드 — ${today} | 카드픽</title>
<meta name="description" content="포켓몬 카드 7일·30일 급등, 검색 급증, 업데이트 요청 많은 카드 TOP 10. 해외 참고가 기준. 국내 거래가와 다를 수 있습니다.">
<link rel="canonical" href="https://cardpick.kr/hot">
<meta name="robots" content="index,follow">
<link rel="stylesheet" as="style" href="https://cdn.jsdelivr.net/gh/orioncactus/pretendard@v1.3.9/dist/web/static/pretendard.min.css">
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;500;600&display=swap">
<script src="https://cdn.tailwindcss.com"></script>
<script>tailwind.config={theme:{extend:{colors:{bg:'#05080D',panel:'#0D121B',panel2:'#111722',line:'rgba(255,255,255,0.08)',ink:'#E8EDF5',muted:'#8B96A8',up:'#26E0C2',down:'#FF4D6D',brand:'#26E0C2',gold:'#D8B84A'},fontFamily:{sans:['Pretendard','system-ui','sans-serif'],mono:['"IBM Plex Mono"','ui-monospace','monospace']}}}}</script>
<style>
  html,body{background:#05080D;color:#E8EDF5;font-family:Pretendard,system-ui,sans-serif}
  .mono{font-family:'IBM Plex Mono',ui-monospace,monospace;font-variant-numeric:tabular-nums}
  .hairline{border-color:rgba(255,255,255,0.08)}
  .panel{background:#0D121B;border:1px solid rgba(255,255,255,0.08)}
  .text-up{color:#26E0C2}.text-down{color:#FF4D6D}
  .truncate{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
</style>
</head><body>
<header class="border-b hairline sticky top-0 bg-bg z-10">
  <div class="max-w-[1280px] mx-auto px-5 lg:px-8 h-14 flex items-center justify-between">
    <a href="/" class="font-bold tracking-tight text-ink">카드픽</a>
    <nav class="flex gap-4 text-[13px] text-muted">
      <a href="/" class="hover:text-ink">홈</a>
      <a href="/hot" class="text-ink">핫카드</a>
      <a href="/releases" class="hover:text-ink">발매</a>
      <a href="/tools" class="hover:text-ink">도구</a>
      <a href="/board" class="hover:text-ink">게시판</a>
    </nav>
  </div>
</header>

<main class="max-w-[1280px] mx-auto px-5 lg:px-8 py-10">
  <div class="mb-2 mono text-[11px] text-muted tracking-[0.16em]">HOT CARDS · ${today}</div>
  <h1 class="text-[28px] lg:text-[36px] font-black tracking-tight leading-tight mb-3">오늘의 포켓몬 핫카드</h1>
  <p class="text-[14px] text-muted leading-relaxed mb-8 max-w-[720px]">
    Pokémon TCG API 기반 해외 참고가, 7일·30일 가격 변동, 검색량, 업데이트 요청을 종합한 일일 핫카드.
    <span class="text-ink/80">국내 거래가와 다를 수 있습니다.</span>
  </p>

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

  <div class="mt-10 panel p-5 text-[12px] text-muted leading-relaxed">
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

  return new Response(html, {
    status: 200,
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'no-store, max-age=0'
    }
  });
}
