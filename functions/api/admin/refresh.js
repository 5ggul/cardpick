// 관리자 수동 가격 갱신 trigger — PRICE_UPDATE_CRON_SECRET로 보호
// 실제 GitHub Actions workflow_dispatch를 호출하거나 SQL refresh
export async function onRequest(context) {
  const req = context.request;
  if (req.method !== 'POST') return json({ error: 'POST only' }, 405);

  // 1) Authorization: Bearer <secret>
  const auth = req.headers.get('Authorization') || '';
  const expected = context.env.PRICE_UPDATE_CRON_SECRET || '';
  if (!expected) return json({ error: 'server cron secret not configured' }, 500);
  if (auth !== 'Bearer ' + expected) return json({ error: 'unauthorized' }, 401);

  try {
    const body = await req.json().catch(() => ({}));
    const job = body.job || 'refresh-mv';

    if (job === 'refresh-mv') {
      // Supabase REST RPC 호출 (SECURITY DEFINER 함수)
      const SUPA = 'https://aqxrmdratnkffvivguqs.supabase.co';
      const KEY = 'sb_publishable_AeDBjfn3ymozGyw06ohMUw_S6n1-qpj';
      const res = await fetch(`${SUPA}/rest/v1/rpc/refresh_card_price_summary`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', apikey: KEY },
        body: JSON.stringify({})
      });
      if (!res.ok) return json({ error: `refresh ${res.status}: ${await res.text()}` }, 500);
      return json({ ok: true, job, status: 'mv refreshed' });
    }

    return json({ error: `unknown job: ${job}` }, 400);
  } catch (e) {
    return json({ error: e.message || String(e) }, 500);
  }
}

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store, max-age=0' }
  });
}
