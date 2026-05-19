// 카드 업데이트 요청 (사용자가 "가격 업데이트 요청" 버튼 클릭)
export async function onRequest(context) {
  const SUPA = 'https://aqxrmdratnkffvivguqs.supabase.co';
  const KEY = 'sb_publishable_AeDBjfn3ymozGyw06ohMUw_S6n1-qpj';
  const req = context.request;
  if (req.method !== 'POST') return json({ error: 'POST only' }, 405);

  try {
    const body = await req.json();
    const slug = String(body.slug || '').slice(0, 200);
    const query = body.query ? String(body.query).slice(0, 200) : null;
    if (!slug && !query) return json({ error: 'slug or query required' }, 400);

    const res = await fetch(`${SUPA}/rest/v1/rpc/log_price_update_request`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', apikey: KEY },
      body: JSON.stringify({ p_query: query || slug, p_card_slug: slug || null })
    });
    if (!res.ok) return json({ error: `db ${res.status}` }, 500);
    return json({ ok: true, message: '가격 업데이트 요청이 접수되었습니다.' });
  } catch (e) {
    return json({ error: e.message || String(e) }, 500);
  }
}
function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store, max-age=0', 'Access-Control-Allow-Origin': '*' }
  });
}
