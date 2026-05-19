// /guides — 카드픽 운영자 발행 가이드·FAQ 모음 SSR
// 신규 도메인 4일차: noindex,follow 로 발행. 안정화 후 indexable 전환 검토.
export async function onRequest() {
  const SUPA = 'https://aqxrmdratnkffvivguqs.supabase.co';
  const KEY = 'sb_publishable_AeDBjfn3ymozGyw06ohMUw_S6n1-qpj';

  function esc(s){ return String(s||'').replace(/[<>&"]/g, c => ({'<':'&lt;','>':'&gt;','&':'&amp;','"':'&quot;'}[c])); }
  function fmtDate(s){
    if (!s) return '';
    const d = new Date(s);
    return d.getFullYear()+'.'+String(d.getMonth()+1).padStart(2,'0')+'.'+String(d.getDate()).padStart(2,'0');
  }

  // 운영자 카드픽 user_id (시드 작성자)
  const ADMIN_ID = '3e8782bc-4790-4d9a-91ad-cccddb68994a';

  // 운영자 발행 글 fetch (board=free/qna/trade 전체 중 운영자 글만)
  let posts = [];
  try {
    const r = await fetch(
      `${SUPA}/rest/v1/posts?user_id=eq.${ADMIN_ID}&order=is_pinned.desc,created_at.desc`,
      { headers: { apikey: KEY } }
    );
    if (r.ok) posts = await r.json();
  } catch (e) { /* graceful */ }

  // 카테고리 라벨링 (제목 prefix 기반)
  function categorize(p) {
    const t = p.title || '';
    if (t.includes('[공지]')) return { key: 'notice', label: '공지', tone: '#26E0C2' };
    if (t.includes('[양식]') || t.includes('거래') && t.includes('가이드')) return { key: 'trade', label: '거래 가이드', tone: '#F2C94C' };
    if (t.includes('[FAQ]')) return { key: 'faq', label: 'FAQ', tone: '#9CC2FF' };
    if (t.includes('[가이드]')) return { key: 'guide', label: '가이드', tone: '#26E0C2' };
    return { key: 'etc', label: '안내', tone: '#8B96A8' };
  }

  // 그룹화
  const groups = { notice: [], guide: [], faq: [], trade: [], etc: [] };
  for (const p of posts) {
    const c = categorize(p);
    p._cat = c;
    if (groups[c.key]) groups[c.key].push(p);
    else groups.etc.push(p);
  }

  // 본문 첫 한 줄 발췌 (description preview)
  function preview(body) {
    if (!body) return '';
    const txt = String(body).replace(/\n+/g, ' ').replace(/[•·]\s*/g, '').trim();
    return txt.length > 90 ? txt.slice(0, 90) + '…' : txt;
  }

  function renderGroup(key, label) {
    const list = groups[key];
    if (!list || !list.length) return '';
    return `
    <section class="mb-12">
      <div class="flex items-baseline gap-3 mb-4">
        <h2 class="text-[19px] font-bold text-ink">${esc(label)}</h2>
        <span class="mono text-[11px] text-muted">${list.length}건</span>
      </div>
      <ul class="space-y-2">
        ${list.map(p => {
          // 제목에서 prefix 분리 — sub-chip로 카테고리 강조
          const titleClean = (p.title || '').replace(/^\[(공지|가이드|FAQ|양식)\]\s*/, '');
          return `
          <li class="border hairline panel">
            <a href="/board?post=${esc(p.id)}" class="block px-5 py-4 hover:bg-panel2 transition">
              <div class="flex items-start justify-between gap-3 mb-2">
                <div class="flex items-center gap-2 flex-wrap">
                  ${p.is_pinned ? '<span class="mono text-[10px] text-up tracking-[0.12em]">★ 고정</span>' : ''}
                  <span class="inline-flex items-center px-2 py-0.5 border mono text-[10.5px] tracking-[0.06em]" style="color:${p._cat.tone};border-color:${p._cat.tone};background:rgba(255,255,255,0.02);font-weight:600">${esc(p._cat.label)}</span>
                </div>
                <span class="mono text-[10px] text-muted">${fmtDate(p.created_at)}</span>
              </div>
              <div class="text-[15px] text-ink font-semibold leading-snug mb-1.5">${esc(titleClean)}</div>
              <div class="text-[12.5px] text-muted leading-relaxed">${esc(preview(p.body))}</div>
            </a>
          </li>
        `;}).join('')}
      </ul>
    </section>`;
  }

  const html = `<!doctype html>
<html lang="ko"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>카드픽 가이드·자주 묻는 질문 | 카드픽</title>
<meta name="description" content="카드픽 운영자가 직접 정리한 포켓몬 카드 가격·검색·거래 가이드와 자주 묻는 질문 모음. 가격 출처, 변동률 해석, 거래 안전 체크리스트.">
<meta name="robots" content="noindex,follow">
<link rel="canonical" href="https://cardpick.kr/guides">
<link rel="icon" href="/favicon.ico" sizes="any">
<link rel="stylesheet" href="https://cdn.jsdelivr.net/gh/orioncactus/pretendard@v1.3.9/dist/web/static/pretendard.min.css">
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;500;600&display=swap">
<script src="https://cdn.tailwindcss.com"></script>
<script>tailwind.config={theme:{extend:{colors:{bg:'#05080D',panel:'#0D121B',panel2:'#111722',line:'rgba(255,255,255,0.08)',ink:'#E8EDF5',muted:'#8B96A8',up:'#26E0C2',down:'#FF4D6D',brand:'#26E0C2',gold:'#F2C94C'},fontFamily:{sans:['Pretendard','system-ui','sans-serif'],mono:['"IBM Plex Mono"','ui-monospace','monospace']}}}}</script>
<style>
  html,body{background:#05080D;color:#E8EDF5;font-family:Pretendard,system-ui,sans-serif}
  .mono{font-family:'IBM Plex Mono',ui-monospace,monospace;font-variant-numeric:tabular-nums}
  .hairline{border-color:rgba(255,255,255,0.08)}
  .panel{background:#0D121B}
</style>
</head><body>
<header class="border-b hairline sticky top-0 bg-bg z-10">
  <div class="max-w-[1100px] mx-auto px-5 lg:px-8 h-14 flex items-center justify-between">
    <a href="/" class="font-bold tracking-tight text-ink">카드픽</a>
    <nav class="flex gap-4 text-[13px] text-muted">
      <a href="/" class="hover:text-ink">홈</a>
      <a href="/hot" class="hover:text-ink">핫카드</a>
      <a href="/guides" class="text-ink">가이드</a>
      <a href="/board" class="hover:text-ink">게시판</a>
    </nav>
  </div>
</header>

<main class="max-w-[1100px] mx-auto px-5 lg:px-8 py-10">
  <div class="mb-2 mono text-[11px] text-muted tracking-[0.16em]">CARDPICK GUIDES</div>
  <h1 class="text-[28px] lg:text-[36px] font-black tracking-tight leading-tight mb-3">카드픽 가이드 · 자주 묻는 질문</h1>
  <p class="text-[14px] text-muted leading-relaxed mb-10 max-w-[720px]">
    카드픽 운영자가 직접 정리한 카드 가격·검색·거래 가이드입니다.
    국내·해외 데이터 출처, 변동률 해석법, 안전 거래 체크리스트를 한 곳에서 확인하세요.
  </p>

  ${renderGroup('notice', '공지')}
  ${renderGroup('guide', '가이드')}
  ${renderGroup('faq', 'FAQ')}
  ${renderGroup('trade', '거래 가이드')}
  ${renderGroup('etc', '기타')}

  ${posts.length === 0 ? `
    <div class="border hairline panel p-8 text-center">
      <div class="mono text-[11px] text-muted tracking-[0.14em] mb-2">CONTENT</div>
      <div class="text-[14px] text-muted">가이드 콘텐츠 누적 중입니다.</div>
    </div>
  ` : ''}

  <div class="mt-10 panel border hairline p-5 text-[12px] text-muted leading-relaxed">
    <div class="mono text-[10px] text-ink/80 mb-2">⚠ 가격 정보 안내</div>
    카드픽 가격은 Pokémon TCG API 기반 TCGplayer 북미 평균가 및 Cardmarket EU 평균가 참고값입니다.
    국내 거래가와 다를 수 있으며, 카드 상태·언어·등급·배송비·환율·거래처에 따라 실제 거래가는 달라질 수 있습니다.
    본 정보는 투자 권유가 아닙니다.
  </div>
</main>

<footer class="border-t hairline mt-12">
  <div class="max-w-[1100px] mx-auto px-5 lg:px-8 py-8 text-[12px] text-muted">
    © 카드픽 cardpick.kr · 해외 참고가 (TCGplayer·Cardmarket)
  </div>
</footer>
</body></html>`;

  return new Response(html, {
    status: 200,
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'no-store, max-age=0',
      'X-Robots-Tag': 'noindex, follow'
    }
  });
}
