import {
  cleanSlug,
  cleanText,
  handlePreflight,
  isAllowedBrowserOrigin,
  json,
  rateLimit,
  readJsonBody,
} from '../_lib/request-guard.js';

// 카드 업데이트 요청 (사용자가 "가격 업데이트 요청" 버튼 클릭)
export async function onRequest(context) {
  const SUPA = 'https://aqxrmdratnkffvivguqs.supabase.co';
  const KEY = 'sb_publishable_AeDBjfn3ymozGyw06ohMUw_S6n1-qpj';
  const req = context.request;

  const preflight = handlePreflight(req);
  if (preflight) return preflight;

  if (req.method !== 'POST') {
    return json({ error: 'POST only' }, 405, req, { Allow: 'POST, OPTIONS' });
  }
  if (!isAllowedBrowserOrigin(req)) {
    return json({ error: 'origin not allowed' }, 403, req);
  }

  const limit = await rateLimit(context, 'price-update-request', 6, 600);
  if (!limit.allowed) {
    return json(
      { error: 'too many requests' },
      429,
      req,
      { 'Retry-After': String(limit.retryAfter) },
    );
  }

  try {
    const body = await readJsonBody(req, 2048);
    const slug = cleanSlug(body.slug);
    const query = body.query ? cleanText(body.query, 120) : '';

    if (!slug && !query) {
      return json({ error: 'valid slug or query required' }, 400, req);
    }

    const res = await fetch(`${SUPA}/rest/v1/rpc/log_price_update_request`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', apikey: KEY },
      body: JSON.stringify({
        p_query: query || slug,
        p_card_slug: slug || null,
      }),
    });

    if (!res.ok) {
      console.error('request-update db error', res.status);
      return json({ error: 'request could not be recorded' }, 502, req);
    }

    return json(
      { ok: true, message: '가격 업데이트 요청이 접수되었습니다.' },
      200,
      req,
    );
  } catch (error) {
    const status = Number(error?.status) || 500;
    if (status >= 500) console.error('request-update error', error);
    const message =
      status === 413
        ? 'payload too large'
        : status === 415
          ? 'application/json required'
          : status === 400
            ? 'invalid JSON'
            : 'internal error';
    return json({ error: message }, status, req);
  }
}
