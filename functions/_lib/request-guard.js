const ALLOWED_WEB_ORIGINS = new Set([
  'https://cardpick.kr',
  'https://www.cardpick.kr',
]);

function jsonHeaders(origin) {
  const headers = {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store, max-age=0',
    'Vary': 'Origin',
    'X-Content-Type-Options': 'nosniff',
  };
  if (origin && ALLOWED_WEB_ORIGINS.has(origin)) {
    headers['Access-Control-Allow-Origin'] = origin;
  }
  return headers;
}

export function json(body, status = 200, request = null, extraHeaders = {}) {
  const origin = request?.headers?.get('Origin') || '';
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...jsonHeaders(origin), ...extraHeaders },
  });
}

export function handlePreflight(request) {
  if (request.method !== 'OPTIONS') return null;
  const origin = request.headers.get('Origin') || '';
  if (!ALLOWED_WEB_ORIGINS.has(origin)) {
    return json({ error: 'origin not allowed' }, 403, request);
  }
  return new Response(null, {
    status: 204,
    headers: {
      ...jsonHeaders(origin),
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
      'Access-Control-Max-Age': '86400',
    },
  });
}

export function isAllowedBrowserOrigin(request) {
  const origin = request.headers.get('Origin');
  // Native Android/iOS HTTP clients normally do not send an Origin header.
  if (!origin) return true;
  return ALLOWED_WEB_ORIGINS.has(origin);
}

export async function readJsonBody(request, maxBytes = 4096) {
  const contentType = (request.headers.get('Content-Type') || '').toLowerCase();
  if (!contentType.startsWith('application/json')) {
    const err = new Error('content-type');
    err.status = 415;
    throw err;
  }

  const advertised = Number(request.headers.get('Content-Length') || 0);
  if (Number.isFinite(advertised) && advertised > maxBytes) {
    const err = new Error('payload-too-large');
    err.status = 413;
    throw err;
  }

  const text = await request.text();
  if (new TextEncoder().encode(text).byteLength > maxBytes) {
    const err = new Error('payload-too-large');
    err.status = 413;
    throw err;
  }

  try {
    return JSON.parse(text);
  } catch {
    const err = new Error('invalid-json');
    err.status = 400;
    throw err;
  }
}

export function cleanText(value, maxLength = 200) {
  return String(value ?? '')
    .replace(/[\u0000-\u001F\u007F]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, maxLength);
}

export function cleanSlug(value) {
  const slug = cleanText(value, 200);
  if (!slug) return '';
  // Cardpick slugs are URL-path-safe. Keep legacy multiple hyphens valid.
  if (!/^[A-Za-z0-9][A-Za-z0-9._~-]{0,199}$/.test(slug)) return '';
  return slug;
}

async function shortHash(input) {
  const digest = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(input),
  );
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
    .slice(0, 24);
}

/**
 * Soft fixed-window abuse guard backed by the Cloudflare Cache API.
 * It intentionally does not promise strict atomicity; it is a cheap edge guard
 * in front of Supabase. A stricter global limit can later move to Durable Objects.
 */
export async function rateLimit(context, scope, limit, windowSeconds) {
  const request = context.request;
  const ip =
    request.headers.get('CF-Connecting-IP') ||
    request.headers.get('X-Forwarded-For')?.split(',')[0]?.trim() ||
    'unknown';

  const identity = await shortHash(`${scope}|${ip}`);
  const bucket = Math.floor(Date.now() / (windowSeconds * 1000));
  const key = new Request(
    `https://rate-limit.cardpick.internal/${scope}/${identity}/${bucket}`,
  );
  const cache = caches.default;
  const previous = await cache.match(key);
  const count = previous ? Number(await previous.text()) || 0 : 0;

  if (count >= limit) {
    const retryAfter =
      windowSeconds -
      Math.floor((Date.now() / 1000) % windowSeconds);
    return { allowed: false, retryAfter };
  }

  const response = new Response(String(count + 1), {
    headers: {
      'Cache-Control': `public, max-age=${windowSeconds}`,
    },
  });
  context.waitUntil(cache.put(key, response));
  return { allowed: true, retryAfter: 0 };
}

export async function privacyPreservingIpHash(context, scope) {
  const pepper = context.env?.SEARCH_LOG_PEPPER;
  if (!pepper) return null;

  const ip = context.request.headers.get('CF-Connecting-IP') || '';
  if (!ip) return null;

  return shortHash(`${scope}|${ip}|${pepper}`);
}
