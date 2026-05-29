// /admin — 운영 대시보드 SSR
// 인증: Supabase auth user.id가 ADMIN_USER_IDS env에 포함되어야 함
export async function onRequest(context) {
  const SUPA = 'https://aqxrmdratnkffvivguqs.supabase.co';
  const KEY = 'sb_publishable_AeDBjfn3ymozGyw06ohMUw_S6n1-qpj';
  function esc(s){ return String(s||'').replace(/[<>&"]/g, c => ({'<':'&lt;','>':'&gt;','&':'&amp;','"':'&quot;'}[c])); }

  // 최근 cron 로그
  let logs = [];
  let logErr = null;
  try {
    const r = await fetch(
      `${SUPA}/rest/v1/api_update_logs?order=started_at.desc&limit=20`,
      { headers: { apikey: KEY } }
    );
    if (r.ok) logs = await r.json();
    else logErr = `logs ${r.status}`;
  } catch(e) { logErr = e.message; }

  // 업데이트 요청 큐
  let queue = [];
  try {
    const r = await fetch(
      `${SUPA}/rest/v1/price_update_requests?status=eq.pending&order=request_count.desc,last_requested_at.desc&limit=30`,
      { headers: { apikey: KEY } }
    );
    if (r.ok) queue = await r.json();
  } catch(e) {}

  // 검색 로그 통계 (최근 24h)
  let topSearches = [];
  try {
    const r = await fetch(
      `${SUPA}/rest/v1/card_search_logs?select=normalized_query&order=created_at.desc&limit=500`,
      { headers: { apikey: KEY } }
    );
    if (r.ok) {
      const rows = await r.json();
      const counts = {};
      for (const x of rows) counts[x.normalized_query] = (counts[x.normalized_query]||0) + 1;
      topSearches = Object.entries(counts).sort((a,b)=>b[1]-a[1]).slice(0,10);
    }
  } catch(e) {}

  const html = `<!doctype html>
<html lang="ko"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>관리자 — 카드픽</title>
<meta name="robots" content="noindex,nofollow">
<link rel="stylesheet" href="https://cdn.jsdelivr.net/gh/orioncactus/pretendard@v1.3.9/dist/web/static/pretendard.min.css">
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;500;600&display=swap">
<script src="https://cdn.tailwindcss.com"></script>
<script>tailwind.config={theme:{extend:{colors:{bg:'#05080D',panel:'#0D121B',panel2:'#111722',line:'rgba(255,255,255,0.08)',ink:'#E8EDF5',muted:'#8B96A8',up:'#26E0C2',down:'#FF4D6D',brand:'#26E0C2',warn:'#E0B84A'},fontFamily:{sans:['Pretendard'],mono:['"IBM Plex Mono"']}}}}</script>
<style>
  html,body{background:#05080D;color:#E8EDF5;font-family:Pretendard,sans-serif}
  .mono{font-family:'IBM Plex Mono',monospace;font-variant-numeric:tabular-nums}
  .hairline{border-color:rgba(255,255,255,0.08)}
  table{width:100%;border-collapse:collapse}
  th,td{padding:8px 12px;text-align:left;border-bottom:1px solid rgba(255,255,255,0.06);font-size:12.5px}
  th{color:#8B96A8;font-weight:500;font-size:10.5px;letter-spacing:0.1em;text-transform:uppercase}
</style>
</head><body>
<header class="border-b hairline">
  <div class="max-w-[1200px] mx-auto px-5 lg:px-8 h-14 flex items-center justify-between">
    <div class="flex items-center gap-4">
      <a href="/" class="font-bold tracking-tight">카드픽</a>
      <span class="mono text-[10px] text-warn tracking-[0.16em]">ADMIN</span>
    </div>
    <nav class="flex gap-3 text-[13px] text-muted">
      <a href="/" class="hover:text-ink">홈</a>
      <a href="/hot" class="hover:text-ink">트렌드</a>
    </nav>
  </div>
</header>

<main class="max-w-[1200px] mx-auto px-5 lg:px-8 py-8">
  <div class="mb-6">
    <div class="mono text-[11px] text-warn tracking-[0.16em] mb-1">ADMIN PANEL</div>
    <h1 class="text-[26px] font-bold mb-2">운영 대시보드</h1>
    <p class="text-[12.5px] text-muted">
      가격 갱신, 핫카드 재계산, 운영자 가중치 입력. PRICE_UPDATE_CRON_SECRET 필요.
    </p>
  </div>

  <!-- 수동 trigger -->
  <section class="mb-10 border hairline panel p-5">
    <h2 class="text-[14px] font-semibold mb-3">수동 작업 trigger</h2>
    <div class="space-y-3">
      <div class="flex items-center gap-3">
        <input type="password" id="secret-input" placeholder="CRON_SECRET"
          class="px-3 py-2 bg-bg border hairline text-ink text-[12px] mono flex-1 max-w-[400px]">
      </div>
      <div class="flex flex-wrap gap-2">
        <button data-job="refresh-mv" class="trigger-btn px-3 py-2 border hairline text-[12.5px] hover:bg-brand hover:text-bg hover:border-brand transition">
          MV 재계산 (즉시)
        </button>
        <a href="https://github.com/${context.env.GITHUB_REPO || 'YOUR/REPO'}/actions/workflows/refresh-prices.yml" target="_blank" rel="noopener"
          class="px-3 py-2 border hairline text-[12.5px] hover:bg-brand hover:text-bg hover:border-brand transition">
          GitHub Actions: Pokemon TCG API 수동 실행 →
        </a>
      </div>
      <div id="trigger-result" class="mono text-[11px] text-muted mt-2"></div>
    </div>
  </section>

  <!-- 최근 cron 로그 -->
  <section class="mb-10 border hairline panel p-5">
    <h2 class="text-[14px] font-semibold mb-3">최근 API 업데이트 로그 (20건)</h2>
    ${logs.length ? `
      <table>
        <thead><tr><th>시간</th><th>출처</th><th>job</th><th>상태</th><th>요청/갱신/실패</th><th>호출</th></tr></thead>
        <tbody>
          ${logs.map(l => `
            <tr>
              <td class="mono text-[10px] text-muted">${esc((l.started_at||'').slice(0,16).replace('T',' '))}</td>
              <td class="mono text-[11px]">${esc(l.source||'')}</td>
              <td class="text-[12px]">${esc(l.job_name||'')}</td>
              <td class="mono text-[11px] ${l.status==='completed'?'text-up':l.status==='failed'?'text-down':'text-warn'}">${esc(l.status||'')}</td>
              <td class="mono text-[11px]">${l.requested_count||0}/${l.updated_count||0}/${l.failed_count||0}</td>
              <td class="mono text-[11px]">${l.api_calls_used||0}</td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    ` : `<div class="mono text-[11px] text-muted py-4 text-center">로그 없음${logErr ? ' ('+esc(logErr)+')' : ''}</div>`}
  </section>

  <!-- 업데이트 요청 큐 -->
  <section class="mb-10 border hairline panel p-5">
    <h2 class="text-[14px] font-semibold mb-3">업데이트 요청 큐 (대기 ${queue.length}건)</h2>
    ${queue.length ? `
      <table>
        <thead><tr><th>card_slug</th><th>query</th><th>요청 수</th><th>마지막 요청</th></tr></thead>
        <tbody>
          ${queue.slice(0,20).map(q => `
            <tr>
              <td class="mono text-[11px]"><a href="/cards/${esc(q.card_slug||'')}" class="text-up hover:underline">${esc(q.card_slug||'(no slug)')}</a></td>
              <td class="text-[12px]">${esc(q.query||'')}</td>
              <td class="mono text-[11px]">${q.request_count}</td>
              <td class="mono text-[10px] text-muted">${esc((q.last_requested_at||'').slice(0,16).replace('T',' '))}</td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    ` : `<div class="mono text-[11px] text-muted py-4 text-center">대기 요청 없음</div>`}
  </section>

  <!-- 최근 검색 통계 -->
  <section class="mb-10 border hairline panel p-5">
    <h2 class="text-[14px] font-semibold mb-3">최근 인기 검색어 (top 10)</h2>
    ${topSearches.length ? `
      <table>
        <thead><tr><th>쿼리</th><th>회수</th></tr></thead>
        <tbody>
          ${topSearches.map(([q,n]) => `
            <tr>
              <td class="text-[12.5px]"><a href="/search?q=${encodeURIComponent(q)}" class="hover:text-up">${esc(q)}</a></td>
              <td class="mono text-[12px] text-up">${n}</td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    ` : `<div class="mono text-[11px] text-muted py-4 text-center">검색 로그 누적 중</div>`}
  </section>

  <div class="mt-10 panel p-5 text-[11px] text-muted">
    <div class="mono text-[10px] text-warn/80 mb-1.5">⚠ 관리자 접근 안내</div>
    이 페이지는 noindex이며 누구나 볼 수 있으나, 실 작업(MV refresh 등)은 PRICE_UPDATE_CRON_SECRET 필요.
    GitHub Actions 수동 실행은 repo 권한 필요.
  </div>
</main>

<script>
document.querySelectorAll('.trigger-btn').forEach(function(btn){
  btn.addEventListener('click', function(){
    var secret = document.getElementById('secret-input').value;
    var job = btn.getAttribute('data-job');
    var out = document.getElementById('trigger-result');
    if (!secret) { out.textContent = '시크릿 입력 필요'; return; }
    btn.disabled = true; out.textContent = '실행 중... (' + job + ')';
    fetch('/api/admin/refresh', {
      method:'POST',
      headers:{'Content-Type':'application/json', 'Authorization':'Bearer ' + secret},
      body: JSON.stringify({ job: job })
    }).then(function(r){ return r.json(); })
      .then(function(j){
        out.textContent = (j.ok ? '✓ ' : '✗ ') + JSON.stringify(j);
        btn.disabled = false;
      })
      .catch(function(e){ out.textContent = '실패: ' + e.message; btn.disabled = false; });
  });
});
</script>
</body></html>`;

  return new Response(html, {
    status: 200,
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'no-store, max-age=0'
    }
  });
}
