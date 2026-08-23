import {
  cleanSlug,
  cleanText,
  handlePreflight,
  isAllowedBrowserOrigin,
  json,
  privacyPreservingIpHash,
  rateLimit,
  readJsonBody,
} from '../_lib/request-guard.js';

// 사용자 검색 로깅 (POST). 외부 API 호출 없음 — 단순 DB insert.
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

  const limit = await rateLimit(context, 'search-log', 90, 60);
  if (!limit.allowed) {
    return json(
      { error: 'too many requests' },
      429,
      req,
      { 'Retry-After': String(limit.retryAfter) },
    );
  }

  try {
    const body = await readJsonBody(req, 3072);
    const query = cleanText(body.query, 120);
    if (!query) return json({ error: 'query required' }, 400, req);

    const normalized = query.toLowerCase();
    const rawMatchedSlug = body.matched_slug
      ? cleanText(body.matched_slug, 200)
      : '';
    const matched_slug = rawMatchedSlug ? cleanSlug(rawMatchedSlug) : null;
    if (rawMatchedSlug && !matched_slug) {
      return json({ error: 'invalid matched_slug' }, 400, req);
    }

    const game = body.game === 'pokemon' ? 'pokemon' : null;
    const rawResultCount = Number(body.result_count);
    const result_count =
      Number.isInteger(rawResultCount) && rawResultCount >= 0
        ? Math.min(rawResultCount, 10000)
        : 0;
    const has_price = body.has_price === true;

    // SEARCH_LOG_PEPPER가 설정된 경우에만 비가역 식별용 해시를 저장한다.
    // 공개 salt를 사용한 IP 해시는 IPv4 사전대입 위험이 있어 사용하지 않는다.
    const ip_hash = await privacyPreservingIpHash(context, 'search-log');
    const user_agent = cleanText(req.headers.get('User-Agent') || '', 120);

    const res = await fetch(`${SUPA}/rest/v1/card_search_logs`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        apikey: KEY,
        Prefer: 'return=minimal',
      },
      body: JSON.stringify({
        query,
        normalized_query: normalized,
        matched_slug,
        game,
        result_count,
        has_price,
        user_agent,
        ip_hash,
      }),
    });

    if (!res.ok) {
      console.error('search-log db error', res.status);
      return json({ error: 'search log could not be recorded' }, 502, req);
    }

    // 검색 결과 없음 또는 가격 없음 → 업데이트 요청 큐에 누적.
    // 이 RPC 실패는 사용자 검색 자체를 실패시키지 않는다.
    if (!matched_slug || !has_price) {
      await fetch(`${SUPA}/rest/v1/rpc/log_price_update_request`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', apikey: KEY },
        body: JSON.stringify({
          p_query: query,
          p_card_slug: matched_slug,
        }),
      }).catch(() => {});
    }

    return json({ ok: true }, 200, req);
  } catch (error) {
    const status = Number(error?.status) || 500;
    if (status >= 500) console.error('search-log error', error);
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
