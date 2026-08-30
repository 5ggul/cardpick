// /board SSR — 정적 board.html 위에 최근 게시글 5건을 서버사이드 렌더링.
// 크롤러·AdSense reviewer·AI가 SPA 로딩 전에 실 콘텐츠를 인지할 수 있도록.
// board.html 은 여전히 noindex,follow 유지 (커뮤니티 모더레이션 정책 정립 후 index 승격 검토).

export async function onRequest(context) {
  const { request, env } = context;

  // 엣지 캐시 (5분)
  const edgeCache = caches.default;
  const cacheKey = new Request('https://cardpick.kr/__board_ssr_v3_bottom', { method: 'GET' });
  const cached = await edgeCache.match(cacheKey);
  if (cached) {
    const h = new Headers(cached.headers);
    h.set('X-Edge-Cache', 'HIT');
    return new Response(cached.body, { status: cached.status, headers: h });
  }

  const SUPA = 'https://aqxrmdratnkffvivguqs.supabase.co';
  const KEY = 'sb_publishable_AeDBjfn3ymozGyw06ohMUw_S6n1-qpj';

  // 최근 posts 5건 병렬 fetch (anon SELECT 가능 확인됨 · RLS 통과 콘텐츠만 노출)
  let posts = [];
  try {
    const r = await fetch(
      `${SUPA}/rest/v1/posts?select=id,title,body,board,created_at,comments_count,likes&order=created_at.desc&limit=5`,
      { headers: { apikey: KEY } }
    );
    if (r.ok) posts = await r.json();
  } catch (e) { /* graceful */ }

  // 정적 board.html asset 로드
  const assetURL = new URL('/board.html', request.url).toString();
  const assetReq = new Request(assetURL, { method: 'GET' });
  let resp;
  try {
    resp = await env.ASSETS.fetch(assetReq);
    if (!resp || resp.status >= 400) {
      // asset fetch 실패 시 원본 요청 그대로 pass-through
      return env.ASSETS.fetch(request);
    }
  } catch (e) {
    return env.ASSETS.fetch(request);
  }

  const truncate = (s, n) => { s = String(s || '').trim(); return s.length > n ? s.slice(0, n) + '…' : s; };
  const esc = (s) => String(s || '').replace(/[&<>"']/g, m => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m]));
  const fmtDate = d => { try { const dt = new Date(d); return `${String(dt.getMonth() + 1).padStart(2, '0')}.${String(dt.getDate()).padStart(2, '0')}`; } catch { return ''; } };

  const BOARD_LABEL = { free: '자유', qna: '질문', trade: '거래', info: '정보', deals: '핫딜', notice: '공지' };

  const items = posts.map(p => {
    const bodyText = truncate(String(p.body || '').replace(/\s+/g, ' '), 100);
    const bl = BOARD_LABEL[p.board] || (p.board ? p.board : '');
    return `<li class="ssr-post"><a href="/board?post=${esc(p.id)}">` +
      `<div class="ssr-head"><span class="ssr-board">${esc(bl)}</span><span class="ssr-title">${esc(p.title)}</span></div>` +
      (bodyText ? `<p class="ssr-body">${esc(bodyText)}</p>` : '') +
      `<div class="ssr-meta">${fmtDate(p.created_at)} · 댓글 ${Number(p.comments_count || 0)} · 좋아요 ${Number(p.likes || 0)}</div>` +
      `</a></li>`;
  }).join('');

  const ssrBlock = posts.length ? (
    `<section id="ssr-recent-posts" aria-label="최근 게시글">` +
    `<h2 class="ssr-lbl">▸ 최근 게시글</h2>` +
    `<ul class="ssr-list">${items}</ul>` +
    `<p class="ssr-hint">전체 목록·정렬·글쓰기는 아래에서 확인하세요.</p>` +
    `</section>` +
    `<style>` +
    `#ssr-recent-posts{margin:14px 0 22px;padding:16px 18px;background:var(--cp-panel,#0D121B);border:1px solid var(--cp-line,rgba(255,255,255,0.08));border-radius:4px}` +
    `#ssr-recent-posts .ssr-lbl{font-family:var(--cp-mono,ui-monospace,SFMono-Regular,Menlo,monospace);font-size:11px;color:var(--cp-sub,#8B96A8);letter-spacing:.16em;text-transform:uppercase;margin:0 0 12px;font-weight:600}` +
    `#ssr-recent-posts .ssr-list{list-style:none;margin:0;padding:0;display:flex;flex-direction:column;gap:8px}` +
    `#ssr-recent-posts .ssr-post a{display:block;padding:12px 14px;border:1px solid rgba(255,255,255,0.06);border-radius:3px;color:inherit;text-decoration:none;transition:background .12s,border-color .12s}` +
    `#ssr-recent-posts .ssr-post a:hover{background:rgba(255,255,255,0.03);border-color:rgba(38,224,194,0.3)}` +
    `#ssr-recent-posts .ssr-head{display:flex;align-items:center;gap:8px;flex-wrap:wrap}` +
    `#ssr-recent-posts .ssr-board{display:inline-block;font-family:var(--cp-mono,ui-monospace);font-size:10.5px;color:var(--cp-up,#26E0C2);letter-spacing:.08em;padding:2px 7px;background:rgba(38,224,194,0.08);border-radius:2px;text-transform:uppercase;font-weight:600}` +
    `#ssr-recent-posts .ssr-title{color:var(--cp-fg,#E8EDF5);font-weight:600;font-size:14px;line-height:1.35}` +
    `#ssr-recent-posts .ssr-body{color:var(--cp-sub,#8B96A8);font-size:12.5px;line-height:1.6;margin:6px 0 0}` +
    `#ssr-recent-posts .ssr-meta{color:var(--cp-dim,#5B6577);font-size:11px;font-family:var(--cp-mono,ui-monospace);margin-top:7px;letter-spacing:.04em}` +
    `#ssr-recent-posts .ssr-hint{color:var(--cp-dim,#5B6577);font-size:11px;font-family:var(--cp-mono,ui-monospace);margin:12px 0 0;letter-spacing:.04em;text-align:right}` +
    `</style>`
  ) : '';

  // AdSense 조건부 로드 (외부 진단 P0-B): 실 게시글 5건 이상일 때만 광고 유지.
  // 커뮤니티 활성화 전(seed 삭제 후 실 유저 글 소량)에는 게시자 콘텐츠 부족 상태로
  // AdSense 정책 위반 우려 → adsbygoogle script 제거.
  const AD_MIN_POSTS = 5;
  const keepAds = posts.length >= AD_MIN_POSTS;

  const rewriter = new HTMLRewriter()
    .on('main', { element(el) { if (ssrBlock) el.append(ssrBlock, { html: true }); } })
    .on('script[src*="pagead2.googlesyndication"]', {
      element(el) { if (!keepAds) el.remove(); }
    });

  const rewritten = rewriter.transform(resp);
  const body = await rewritten.text();
  const outResp = new Response(body, {
    status: 200,
    headers: {
      'content-type': 'text/html; charset=utf-8',
      'cache-control': 'public, max-age=300',
      'x-cardpick-ssr': 'board',
    },
  });
  context.waitUntil(edgeCache.put(cacheKey, outResp.clone()));
  return outResp;
}
