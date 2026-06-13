// 홈 위젯 통합 엔드포인트 (트렌드 top5 + 게시판 미리보기 + 인기글)
// 기존: 방문자마다 브라우저가 Supabase REST 직접 4~5회 호출 (search_trends 2000행 포함, 캐시 우회)
// 변경: 서버측에서 1회 집계 + 엣지 캐시(Cache API) 600초 → DB 부하 방문자당 → 10분당 1회
export async function onRequest(context) {
  const SUPA = 'https://aqxrmdratnkffvivguqs.supabase.co';
  const KEY = 'sb_publishable_AeDBjfn3ymozGyw06ohMUw_S6n1-qpj';

  // 엣지 캐시
  const edgeCache = caches.default;
  const cacheKey = new Request('https://cardpick.kr/__home_widgets', { method: 'GET' });
  const hit = await edgeCache.match(cacheKey);
  if (hit) { const h = new Headers(hit.headers); h.set('X-Edge-Cache','HIT'); return new Response(hit.body, { status: hit.status, headers: h }); }

  const out = { trends: [], free: [], qna: [], popular: [] };

  // 1) 검색 트렌드 — 14일 윈도우, 최근 7d vs 직전 7d 증가율 top5 (서버에서 집계)
  try {
    const since = new Date(Date.now() - 14*86400*1000).toISOString().slice(0,10);
    const r = await fetch(`${SUPA}/rest/v1/search_trends?date=gte.${since}&select=keyword,ratio,date&order=date.desc&limit=2000`, { headers: { apikey: KEY } });
    if (r.ok) {
      const rows = await r.json();
      const today = new Date(); today.setUTCHours(0,0,0,0);
      const daysAgo = (ds) => Math.floor((today - new Date(ds + 'T00:00:00Z')) / 86400000);
      const agg = {};
      for (const row of rows) {
        const k = row.keyword;
        if (!agg[k]) agg[k] = { recent: [], prev: [], all: [] };
        const ago = daysAgo(row.date);
        const v = Number(row.ratio) || 0;
        agg[k].all.push(v);
        if (ago < 7) agg[k].recent.push(v);
        else if (ago < 14) agg[k].prev.push(v);
      }
      const avg = (a) => a.length ? a.reduce((s,x)=>s+x,0)/a.length : 0;
      const list = Object.keys(agg).map(k => {
        const recent = avg(agg[k].recent), prev = avg(agg[k].prev), all = avg(agg[k].all);
        const growth = prev > 0.5 ? ((recent - prev) / prev) * 100 : null;
        return { keyword: k, recent, prev, growth, all };
      });
      const hasG = list.filter(x => x.growth !== null && isFinite(x.growth)).sort((a,b)=>b.growth-a.growth);
      const noG = list.filter(x => x.growth === null || !isFinite(x.growth)).sort((a,b)=>b.all-a.all);
      let top = hasG.slice(0,5);
      if (top.length < 5) top = top.concat(noG.slice(0, 5 - top.length));
      out.trends = top;
    }
  } catch (e) { /* graceful */ }

  // 2) 게시판 미리보기 (자유/질문 각 최신 4)
  async function board(b) {
    try {
      const r = await fetch(`${SUPA}/rest/v1/posts?board=eq.${b}&select=id,title,comments_count,created_at&order=created_at.desc&limit=4`, { headers: { apikey: KEY } });
      return r.ok ? await r.json() : [];
    } catch (e) { return []; }
  }
  // 3) 인기글 (7일내 likes·comments top 4)
  async function popular() {
    try {
      const since = new Date(Date.now() - 7*86400*1000).toISOString();
      const r = await fetch(`${SUPA}/rest/v1/posts?created_at=gte.${since}&select=id,title,board,likes,comments_count&order=likes.desc,comments_count.desc,created_at.desc&limit=4`, { headers: { apikey: KEY } });
      return r.ok ? await r.json() : [];
    } catch (e) { return []; }
  }
  const [free, qna, pop] = await Promise.all([board('free'), board('qna'), popular()]);
  out.free = free; out.qna = qna; out.popular = pop;

  const resp = new Response(JSON.stringify(out), {
    status: 200,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'public, s-maxage=3600, stale-while-revalidate=600',
      'Access-Control-Allow-Origin': '*',
      'X-Edge-Cache': 'MISS'
    }
  });
  context.waitUntil(edgeCache.put(cacheKey, resp.clone()));
  return resp;
}
