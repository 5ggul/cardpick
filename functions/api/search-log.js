// 사용자 검색 로깅 (POST). 외부 API 호출 없음 — 단순 DB insert.
export async function onRequest(context) {
  const SUPA = 'https://aqxrmdratnkffvivguqs.supabase.co';
  const KEY = 'sb_publishable_AeDBjfn3ymozGyw06ohMUw_S6n1-qpj';
  const req = context.request;
  if (req.method !== 'POST') return json({ error: 'POST only' }, 405);

  try {
    const body = await req.json();
    const query = String(body.query || '').slice(0, 200);
    if (!query) return json({ error: 'query required' }, 400);

    const normalized = query.toLowerCase().replace(/\s+/g, ' ').trim();
    const matched_slug = body.matched_slug ? String(body.matched_slug).slice(0, 200) : null;
    const game = body.game === 'pokemon' ? 'pokemon' : null;
    const result_count = Number.isInteger(body.result_count) ? body.result_count : 0;
    const has_price = !!body.has_price;

    // IP hash (privacy — full IP 저장 X)
    const ip = req.headers.get('CF-Connecting-IP') || '';
    const ipHash = ip ? await sha256(ip + '|cardpick-salt') : null;
    const ua = (req.headers.get('User-Agent') || '').slice(0, 120);

    const res = await fetch(`${SUPA}/rest/v1/card_search_logs`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', apikey: KEY, Prefer: 'return=minimal' },
      body: JSON.stringify({
        query, normalized_query: normalized, matched_slug, game,
        result_count, has_price, user_agent: ua, ip_hash: ipHash
      })
    });
    if (!res.ok) return json({ error: `db ${res.status}` }, 500);

    // 검색 결과 없음 또는 가격 없음 → 업데이트 요청 큐에 누적
    if (!matched_slug || !has_price) {
      await fetch(`${SUPA}/rest/v1/rpc/log_price_update_request`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', apikey: KEY },
        body: JSON.stringify({ p_query: query, p_card_slug: matched_slug })
      }).catch(() => {});
    }
    return json({ ok: true });
  } catch (e) {
    return json({ error: e.message || String(e) }, 500);
  }
}
async function sha256(s) {
  const h = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s));
  return Array.from(new Uint8Array(h)).map(b => b.toString(16).padStart(2,'0')).join('').slice(0, 16);
}
function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store, max-age=0', 'Access-Control-Allow-Origin': '*' }
  });
}
