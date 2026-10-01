import test from 'node:test';
import assert from 'node:assert/strict';
import { buildCardPriceDisplay, createJsonDeadline, UpstreamDataError, validateSummaryRows, validateTrustRows } from '../functions/_lib/card-price-display.js';
import { createCardSummaryHandler } from '../functions/api/card-summary.js';
import { onRequest as cardPage } from '../functions/cards/[slug].js';

const SLUG = 'fixture-card-1';
const DATE = '2026-09-29T23:25:33.000Z';
const card = { slug: SLUG, name: 'Fixture Card', game: 'pokemon', set_name: 'Fixture Set', number: '1' };
const summary = { card_slug: SLUG, variant: 'normal', latest_krw: 138100, latest_usd: 100,
  last_fetched_at: DATE, samples_7d: 4, samples_30d: 16, median_30d: 120000 };
const high = { trust_level: 'HIGH', display_krw: 138100, distinct_7d: 10, distinct_30d: 32,
  clean_30d_n: 30, clean_30d_median_krw: 120000 };
const cm = { ext_avg_24h: 5.13, ext_avg_7d: 5.3, ext_avg_14d: null, ext_avg_30d: 5.53, ext_updated_at: DATE };
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));

function provider(overrides = {}) {
  const values = { cards: [card], summary: [summary], trust: [high], cm: [cm], ...overrides };
  return async url => {
    const path = new URL(url).pathname;
    const key = path.endsWith('/cards') ? 'cards'
      : (path.endsWith('/card_price_summary') || path.endsWith('/card_price_summary_best')) ? 'summary'
      : path.endsWith('/card_price_trust') ? 'trust' : 'cm';
    const value = values[key];
    if (typeof value === 'function') return value(url);
    if (value instanceof Response) return value;
    // Return the objects themselves so mutation checks also cover parsed input.
    return { ok: true, status: 200, json: async () => value };
  };
}

async function invoke(overrides = {}, options = {}) {
  const pending = [];
  const { slug = SLUG, ...handlerOptions } = options;
  const handler = createCardSummaryHandler({ fetchImpl: provider(overrides), timeoutMs: 200, cache: null, ...handlerOptions });
  const response = await handler({ request: new Request(`https://cardpick.kr/api/card-summary?slug=${slug}`),
    waitUntil: promise => pending.push(promise) });
  await Promise.all(pending);
  return { response, body: await response.json() };
}

test('HIGH uses its verified amount and the matching original USD observation', () => {
  const d = buildCardPriceDisplay(summary, high);
  assert.equal(d.amountKrw, 138100);
  assert.equal(d.sourceUsd, 100);
  assert.equal(d.basis, 'latest');
  assert.equal(d.sourceDate, DATE);
  assert.equal(d.trustLevel, 'HIGH');
  assert.match(d.samplesText, /7일 관측 표본 10건/);
  assert.match(d.samplesText, /30일 32건/);
  assert.match(d.basisText, /관측 표본은 실제 판매 건수가 아닙니다/);
  assert.doesNotMatch(d.secondaryText, /환율|1,381|1\.08/);
});

test('low price and ordinary row count cannot downgrade a HIGH trust result', () => {
  const d = buildCardPriceDisplay({ ...summary, latest_krw: 235, latest_usd: 0.17 }, { ...high, display_krw: 235 });
  assert.equal(d.priceText, '₩ 235');
  assert.equal(d.trustText, '신뢰도 높음');
  assert.equal(d.trustLevel, 'HIGH');
});

for (const level of ['MEDIUM', 'LOW']) {
  test(`${level} does not present the 30-day median as a current USD conversion`, () => {
    const d = buildCardPriceDisplay(summary, { ...high, trust_level: level, display_krw: 10000 });
    assert.equal(d.amountKrw, 10000);
    assert.equal(d.basis, 'median30d');
    assert.equal(d.sourceUsd, null);
    assert.match(d.secondaryText, /30일 중앙값/);
    assert.doesNotMatch(d.secondaryText, /\$|USD\/KRW|환율/);
    assert.equal(d.sourceDate, DATE);
    if (level === 'LOW') assert.match(d.trustText, /표본 부족/);
  });
}

test('a HIGH price from a different source amount cannot borrow its USD value', () => {
  assert.equal(buildCardPriceDisplay(summary, { ...high, display_krw: 150000 }).sourceUsd, null);
  assert.equal(buildCardPriceDisplay({ ...summary, latest_krw: 138099.6 }, high).sourceUsd, 100);
  assert.equal(buildCardPriceDisplay({ ...summary, latest_krw: 138099.4 }, high).sourceUsd, null);
});

for (const value of [null, undefined, 0, -1, NaN, Infinity, -Infinity, '', ' ', 'broken', false, {}, 0.1, Number.MAX_SAFE_INTEGER + 1]) {
  test(`invalid display amount ${String(value)} never falls back to a raw price`, () => {
    const d = buildCardPriceDisplay(summary, { ...high, display_krw: value });
    assert.equal(d.amountKrw, null);
    assert.equal(d.sourceUsd, null);
    assert.equal(d.basis, 'unavailable');
    assert.equal(d.trustLevel, 'NONE');
    assert.equal(d.priceText, '—');
    assert.doesNotMatch(JSON.stringify(d), /138,?100|\$100|₩\s*0/);
  });
}

test('missing source or trust, NONE, and an unknown trust enum are unavailable', () => {
  for (const [s, t] of [[null, high], [summary, null], [summary, {}], [summary, { ...high, trust_level: 'NONE' }], [summary, { ...high, trust_level: 'UNKNOWN' }]]) {
    const d = buildCardPriceDisplay(s, t);
    assert.equal(d.amountKrw, null);
    assert.equal(d.sourceUsd, null);
    assert.equal(d.trustLevel, 'NONE');
  }
});

test('invalid USD, counts, and source dates do not become invented values', () => {
  const d = buildCardPriceDisplay({ ...summary, latest_usd: 0, last_fetched_at: 'unknown' },
    { ...high, distinct_7d: -1, distinct_30d: 'not a count' });
  assert.equal(d.sourceUsd, null);
  assert.equal(d.sourceDate, null);
  assert.equal(d.samplesText, '검증 표본 수 확인 불가');
});

test('the display helper is deterministic and never mutates frozen input', () => {
  const s = Object.freeze({ ...summary });
  const t = Object.freeze({ ...high, trust_level: 'MEDIUM', display_krw: 10000 });
  const before = JSON.stringify([s, t]);
  assert.deepEqual(buildCardPriceDisplay(s, t), buildCardPriceDisplay(s, t));
  assert.equal(JSON.stringify([s, t]), before);
});

test('deadline preserves HTTP status for the SSR legacy-column fallback', async () => {
  const reader = createJsonDeadline({ fetchImpl: async () => new Response('private upstream message', { status: 400 }) });
  try {
    await assert.rejects(reader.fetchJson('https://example.invalid/'), error => error instanceof UpstreamDataError
      && error.status === 400 && error.message === 'upstream_http_error');
  } finally { reader.close(); }
});

test('deadline rejects REST object payloads instead of treating them as empty arrays', async () => {
  const reader = createJsonDeadline({ fetchImpl: async () => Response.json({ error: 'private upstream message' }) });
  try { await assert.rejects(reader.fetchJson('https://example.invalid/'), /upstream_invalid_data/); }
  finally { reader.close(); }
});

for (const part of ['headers', 'body']) {
  test(`one deadline bounds ${part} that never completes, even if abort is ignored`, async () => {
    const reader = createJsonDeadline({ timeoutMs: 20, fetchImpl: async () => part === 'headers'
      ? new Promise(() => {}) : ({ ok: true, status: 200, json: () => new Promise(() => {}) }) });
    const started = performance.now();
    try { await assert.rejects(reader.fetchJson('https://example.invalid/'), /upstream_timeout/); }
    finally { reader.close(); }
    assert.ok(performance.now() - started < 1000);
  });
}

test('API provides the same display contract at the top level and in best', async () => {
  const { response, body } = await invoke();
  assert.equal(response.status, 200);
  assert.equal(body.best.latest_krw, 138100);
  assert.equal(body.best.latest_usd, 100);
  assert.deepEqual(body.price_display, body.best.price_display);
  assert.equal(body.price_display.sourceDate, DATE);
  assert.deepEqual(body.cardmarket, cm);
  assert.equal(body.best.usd_to_krw_rate, null);
  assert.equal(body.best.eur_to_krw_rate, null);
  assert.equal(body.best.latest_krw_cardmarket, null);
});

test('API MEDIUM preserves the median basis without assumed FX or a borrowed USD price', async () => {
  const { body } = await invoke({ trust: [{ ...high, trust_level: 'MEDIUM', display_krw: 10000 }] });
  assert.equal(body.best.latest_krw, 10000);
  assert.equal(body.best.latest_usd, null);
  assert.equal(body.price_display.basis, 'median30d');
  assert.equal(body.best.usd_to_krw_rate, null);
  assert.equal(body.best.cm_avg_7d_krw, null);
  assert.equal(body.cardmarket.ext_avg_7d, 5.3);
});

test('API NONE removes raw money fields from best and every variant', async () => {
  const { body } = await invoke({ summary: [summary, { ...summary, variant: 'holofoil', latest_krw: 999999 }],
    trust: [{ ...high, trust_level: 'NONE', display_krw: null }] });
  assert.equal(body.best.latest_krw, null);
  assert.equal(body.best.latest_usd, null);
  assert.equal(body.best.median_30d, null);
  assert.equal(body.best.clean_30d_median_krw, null);
  for (const row of body.variants) {
    assert.equal(row.latest_krw, null);
    assert.equal(row.latest_usd, null);
    assert.equal(row.median_30d, null);
  }
  assert.equal(body.price_display.basis, 'unavailable');
});

test('confirmed empty summary or trust is distinct from a failed query', async () => {
  const noSummary = await invoke({ summary: [] });
  assert.equal(noSummary.response.status, 200);
  assert.equal(noSummary.body.best, null);
  assert.equal(noSummary.body.price_display.basis, 'unavailable');
  assert.equal(noSummary.body.price_display.sourceDate, null);
  const noTrust = await invoke({ trust: [] });
  assert.equal(noTrust.response.status, 200);
  assert.equal(noTrust.body.best.latest_krw, null);
  assert.equal(noTrust.body.price_display.trustLevel, 'NONE');
});

test('only successful empty card metadata produces a 404', async () => {
  const { response, body } = await invoke({ cards: [] });
  assert.equal(response.status, 404);
  assert.equal(response.headers.get('Cache-Control'), 'no-store, max-age=0');
  assert.equal(body.error, 'card not found');
});

for (const key of ['cards', 'summary', 'trust']) {
  for (const failure of ['http', 'network', 'json', 'object']) {
    test(`required ${key} ${failure} failure is a generic non-cacheable 503`, async () => {
      const errors = {
        http: () => new Response('PRIVATE_PROVIDER_TOKEN', { status: 500 }),
        network: () => { throw new Error('PRIVATE_PROVIDER_TOKEN'); },
        json: () => ({ ok: true, status: 200, json: async () => { throw new Error('PRIVATE_PROVIDER_TOKEN'); } }),
        object: () => Response.json({ secret: 'PRIVATE_PROVIDER_TOKEN' }),
      };
      const { response, body } = await invoke({ [key]: errors[failure] });
      assert.equal(response.status, 503);
      assert.equal(response.headers.get('Cache-Control'), 'no-store, max-age=0');
      assert.deepEqual(body, { error: 'Card data is temporarily unavailable.' });
      assert.doesNotMatch(JSON.stringify(body), /PRIVATE|supabase|TypeError|stack/);
    });
  }
}

for (const value of [[null], [{ ...card, slug: 'another-card' }], [{ ...card, name: '' }]]) {
  test(`malformed metadata ${JSON.stringify(value)} is not a card-not-found 404`, async () => {
    assert.equal((await invoke({ cards: value })).response.status, 503);
  });
}

test('malformed summary and trust rows are not published as authoritative prices', async () => {
  for (const overrides of [{ summary: [null] }, { summary: [{ ...summary, card_slug: 'different' }] },
    { summary: [{ ...summary, latest_krw: 'broken' }] }, { trust: [null] },
    { trust: [{ trust_level: 'HIGH' }] }, { trust: [{ ...high, display_krw: NaN }] }]) {
    assert.equal((await invoke(overrides)).response.status, 503);
  }
});

for (const failure of ['http', 'network', 'json', 'object', 'timeout']) {
  test(`optional Cardmarket ${failure} cannot turn an existing card into an error`, async () => {
    const errors = {
      http: () => new Response('PRIVATE_CM_ERROR', { status: 500 }),
      network: () => { throw new Error('PRIVATE_CM_ERROR'); },
      json: () => ({ ok: true, status: 200, json: async () => { throw new Error('PRIVATE_CM_ERROR'); } }),
      object: () => Response.json({ error: 'PRIVATE_CM_ERROR' }),
      timeout: () => new Promise(() => {}),
    };
    const { response, body } = await invoke({ cm: errors[failure] }, { timeoutMs: 30 });
    assert.equal(response.status, 200);
    assert.equal(body.cardmarket, null);
    assert.equal(body.best.latest_krw, 138100);
  });
}

test('metadata and later body parsing share one request deadline', async () => {
  const started = performance.now();
  const { response } = await invoke({
    cards: async () => { await pause(20); return Response.json([card]); },
    summary: async () => ({ ok: true, status: 200, json: async () => { await pause(50); return [summary]; } }),
  }, { timeoutMs: 40 });
  assert.equal(response.status, 503);
  assert.ok(performance.now() - started < 1000);
});

test('API leaves parsed provider objects unchanged and selects the existing variant priority', async () => {
  const rows = Object.freeze([Object.freeze({ ...summary, variant: 'holofoil' }), Object.freeze({ ...summary })]);
  const trustRows = Object.freeze([Object.freeze({ ...high, trust_level: 'MEDIUM', display_krw: 10000 })]);
  const before = JSON.stringify([rows, trustRows]);
  const { body } = await invoke({ summary: rows, trust: trustRows });
  assert.equal(body.best.variant, 'normal');
  assert.equal(JSON.stringify([rows, trustRows]), before);
});

test('cache uses a new contract key and a cache failure does not look like a deleted card', async () => {
  const urls = [];
  const { response } = await invoke({}, { cache: { match: async key => { urls.push(key.url); throw new Error('CACHE_FAIL'); },
    put: async key => { urls.push(key.url); throw new Error('CACHE_FAIL'); } } });
  assert.equal(response.status, 200);
  assert.equal(urls.length, 2);
  for (const url of urls) assert.match(url, /__card_summary_v2_display_contract\//);
});

test('missing slug performs no provider calls', async () => {
  const handler = createCardSummaryHandler({ fetchImpl: () => { throw new Error('must not fetch'); }, cache: null });
  const response = await handler({ request: new Request('https://cardpick.kr/api/card-summary') });
  assert.equal(response.status, 400);
});

test('shared row validators reject malformed rows without changing valid source arrays', () => {
  const s = Object.freeze([Object.freeze({ ...summary })]);
  const t = Object.freeze([Object.freeze({ ...high })]);
  assert.equal(validateSummaryRows(s, SLUG), s);
  assert.equal(validateTrustRows(t), t);
  for (const invalid of [{}, [null], [{ ...summary, variant: '' }], [{ ...summary, latest_usd: Infinity }]]) {
    assert.throws(() => validateSummaryRows(invalid, SLUG), /upstream_invalid_data/);
  }
  for (const invalid of [{}, [null], [high, high], [{ ...high, trust_level: 'unknown' }]]) {
    assert.throws(() => validateTrustRows(invalid), /upstream_invalid_data/);
  }
});

test('an expired unused deadline stays handled and is still rejected by its next read', async () => {
  const reader = createJsonDeadline({ timeoutMs: 10, fetchImpl: async () => Response.json([]) });
  await pause(25);
  try { await assert.rejects(reader.fetchJson('https://example.invalid/'), /upstream_timeout/); }
  finally { reader.close(); }
});

// Capture production SSR element handlers against mocked data. This is a unit
// test seam, not a replacement for Cloudflare HTMLRewriter/browser verification.
async function invokePage(overrides = {}, options = {}) {
  const slug = options.slug ?? SLUG;
  const saved = { fetch: globalThis.fetch, caches: globalThis.caches, HTMLRewriter: globalThis.HTMLRewriter };
  const elements = new Map();
  const calls = [];
  const pending = [];
  const source = provider(overrides);
  const element = selector => {
    if (!elements.has(selector)) {
      const state = { text: '', tagName: options.tagNames?.[selector], attributes: new Map(), appends: [], removed: false };
      state.setInnerContent = value => { state.text = String(value); };
      state.setAttribute = (key, value) => state.attributes.set(key, String(value));
      state.getAttribute = key => state.attributes.get(key) ?? '';
      state.removeAttribute = key => state.attributes.delete(key);
      state.remove = () => { state.removed = true; };
      state.append = value => state.appends.push(String(value));
      elements.set(selector, state);
    }
    return elements.get(selector);
  };
  class CaptureRewriter {
    constructor() { this.handlers = []; }
    on(selector, handler) { this.handlers.push([selector, handler]); return this; }
    transform() {
      if (options.transformError) throw new Error('PRIVATE_TRANSFORM_ERROR');
      for (const [selector, handler] of this.handlers) handler.element(element(selector));
      return new Response('<html>SSR unit-test capture</html>');
    }
  }
  try {
    globalThis.caches = { default: options.cache };
    globalThis.HTMLRewriter = CaptureRewriter;
    globalThis.fetch = async (url, init) => {
      calls.push(String(url));
      const parsed = new URL(url);
      if (parsed.pathname.endsWith('/cards') && parsed.searchParams.get('slug')?.startsWith('neq.')) {
        return Response.json([]);
      }
      return source(url, init);
    };
    const response = await cardPage({
      request: new Request(`https://cardpick.kr/cards/${slug}`),
      params: { slug },
      env: { ASSETS: { fetch: async () => new Response('<html>mock template</html>') } },
      waitUntil: promise => pending.push(promise),
    });
    await Promise.all(pending);
    const head = elements.get('head')?.appends.join('') ?? '';
    const json = [...head.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)]
      .map(match => JSON.parse(match[1]));
    const injected = head.match(/window\.CARDPICK_BEST=([\s\S]*?);window\.CARDPICK_PRICE_DISPLAY=([\s\S]*?);<\/script>/);
    return { response, body: await response.text(), elements, calls, head, json,
      best: injected ? JSON.parse(injected[1]) : null,
      display: injected ? JSON.parse(injected[2]) : null };
  } finally {
    for (const [key, value] of Object.entries(saved)) {
      if (value === undefined) delete globalThis[key]; else globalThis[key] = value;
    }
  }
}

test('SSR compact header matches hydrated names and set codes, preserving full identity in H1', async () => {
  const result = await invokePage({ cards: [{ ...card, set_code: 'RS' }] }, { tagNames: { '[data-c-name]': 'li' } });
  assert.equal(result.elements.get('[data-c-name]').text, 'Fixture Card');
  assert.equal(result.elements.get('[data-c-set-chip]').text, 'RS · 영문판');
  assert.match(result.elements.get('[data-c-h1-full]').text, /Fixture Card #1/);
  const noCode = await invokePage();
  assert.equal(noCode.elements.get('[data-c-set-chip]').text, '— · 영문판');
  assert.match(noCode.elements.get('[data-c-name]').text, /Fixture Card #1/);
});

test('SSR keeps a real card available when optional Cardmarket fails', async () => {
  const result = await invokePage({ cm: () => { throw new Error('PRIVATE_CM_ERROR'); } });
  assert.equal(result.response.status, 200);
  assert.equal(result.elements.get('#hero-price').text, '₩ 138,100');
  assert.equal(result.elements.get('[data-c-src-cm]').text, '—');
  assert.deepEqual(result.display, buildCardPriceDisplay(summary, high));
  assert.doesNotMatch(result.head, /PRIVATE_CM_ERROR/);
});

for (const table of ['cards', 'summary', 'trust']) {
  for (const failure of ['http', 'network', 'json', 'object', 'malformed']) {
    test(`SSR essential ${table} ${failure} failure is a non-cacheable 503, not 404`, async () => {
      const errors = {
        http: () => new Response('PRIVATE_PROVIDER_ERROR', { status: 500 }),
        network: () => { throw new Error('PRIVATE_PROVIDER_ERROR'); },
        json: () => ({ ok: true, status: 200, json: async () => { throw new Error('PRIVATE_PROVIDER_ERROR'); } }),
        object: () => Response.json({ error: 'PRIVATE_PROVIDER_ERROR' }),
        malformed: () => Response.json([null]),
      };
      const result = await invokePage({ [table]: errors[failure] });
      assert.equal(result.response.status, 503);
      assert.equal(result.response.headers.get('Cache-Control'), 'no-store, max-age=0');
      assert.equal(result.response.headers.get('Retry-After'), '60');
      assert.doesNotMatch(result.body, /PRIVATE|supabase|TypeError|stack/);
    });
  }
}

test('SSR retries legacy metadata columns only for an HTTP 400 extended-select response', async () => {
  const selects = [];
  const result = await invokePage({ cards: url => {
    const select = new URL(url).searchParams.get('select');
    selects.push(select);
    return select.includes('hp,supertype,subtypes')
      ? new Response('unknown column', { status: 400 }) : Response.json([card]);
  } });
  assert.equal(result.response.status, 200);
  assert.equal(selects.length, 2);
  assert.match(selects[0], /hp,supertype,subtypes/);
  assert.doesNotMatch(selects[1], /hp,supertype,subtypes/);
  const forbidden = await invokePage({ cards: () => new Response('PRIVATE_FORBIDDEN', { status: 403 }) });
  assert.equal(forbidden.response.status, 503);
  assert.equal(forbidden.calls.filter(url => new URL(url).pathname.endsWith('/cards')).length, 1);
});

test('SSR successful empty metadata and alias lookup is the card-not-found case', async () => {
  const result = await invokePage({ cards: [] });
  assert.equal(result.response.status, 404);
  assert.match(result.body, /Card not found/);
});

test('SSR retains authoritative HIGH for a cheap card and uses distinct observation counts', async () => {
  const result = await invokePage({ summary: [{ ...summary, latest_krw: 235, latest_usd: 0.17 }],
    trust: [{ ...high, display_krw: 235 }] });
  assert.equal(result.response.status, 200);
  assert.equal(result.elements.get('#hero-price').text, '₩ 235');
  assert.equal(result.elements.get('[data-c-trust-label]').text, '신뢰도 높음');
  assert.match(result.elements.get('[data-c-samples]').text, /7일 관측 표본 10건/);
  assert.doesNotMatch(result.elements.get('[data-c-samples]').text, /4건/);
  // Trust presentation is not an expansion of the existing index policy.
  assert.equal(result.elements.get('meta[name="robots"]').attributes.get('content'), 'noindex,follow');
});

test('SSR MEDIUM description, hero and Dataset use the median without a borrowed USD/FX value', async () => {
  const t = { ...high, trust_level: 'MEDIUM', display_krw: 10000 };
  const result = await invokePage({ trust: [t] });
  assert.equal(result.response.status, 200);
  assert.deepEqual(result.display, buildCardPriceDisplay(summary, t));
  assert.equal(result.elements.get('#hero-price').text, '₩ 10,000');
  assert.match(result.elements.get('#hero-secondary').text, /30일 중앙값/);
  assert.doesNotMatch(result.elements.get('#hero-secondary').text, /\$|환율/);
  assert.equal(result.elements.get('[data-c-src-tcg]').text, '—');
  assert.equal(result.elements.get('#pricing-fx').text, '별도 환율값 미제공');
  const dataset = result.json.find(row => row['@type'] === 'Dataset');
  assert.match(dataset.description, /중앙값/);
  assert.deepEqual(dataset.variableMeasured.map(row => [row.name, row.value]), [['display_krw', 10000]]);
  assert.match(result.elements.get('meta[name="description"]').attributes.get('content'), /₩ 10,000/);
  assert.match(result.elements.get('meta[name="robots"]').attributes.get('content'), /^index,/);
});

test('SSR NONE removes raw TCG price fields and does not publish a zero-price Dataset', async () => {
  const result = await invokePage({ trust: [{ ...high, trust_level: 'NONE', display_krw: null }] });
  assert.equal(result.response.status, 200);
  assert.equal(result.elements.get('#hero-price').text, '—');
  assert.equal(result.elements.get('[data-c-src-tcg]').text, '—');
  assert.match(result.elements.get('[data-c-about]').text, /표시하지 않습니다/);
  assert.doesNotMatch(result.elements.get('[data-c-about]').text, /₩\s*0|138,?100/);
  assert.equal(result.best.latest_krw, null);
  assert.equal(result.best.latest_usd, null);
  assert.equal(result.best.median_30d, null);
  assert.equal(result.best.clean_30d_median_krw, null);
  assert.equal(result.json.some(row => row['@type'] === 'Dataset'), false);
  assert.equal(result.elements.get('meta[name="robots"]').attributes.get('content'), 'noindex,follow');
});

test('SSR leaves frozen provider objects unchanged', async () => {
  const s = Object.freeze({ ...summary });
  const t = Object.freeze({ ...high, trust_level: 'MEDIUM', display_krw: 10000 });
  const before = JSON.stringify([s, t]);
  assert.equal((await invokePage({ summary: [s], trust: [t] })).response.status, 200);
  assert.equal(JSON.stringify([s, t]), before);
});

test('SSR does not cache an empty template as a success when rewriting fails', async () => {
  const result = await invokePage({}, { transformError: true });
  assert.equal(result.response.status, 503);
  assert.equal(result.response.headers.get('Cache-Control'), 'no-store, max-age=0');
  assert.doesNotMatch(result.body, /mock template|PRIVATE_TRANSFORM_ERROR/);
});

test('SSR cache failure is independent of card existence and uses the new contract key', async () => {
  const keys = [];
  const result = await invokePage({}, { cache: {
    match: async key => { keys.push(key.url); throw new Error('PRIVATE_CACHE'); },
    put: async key => { keys.push(key.url); throw new Error('PRIVATE_CACHE'); },
  } });
  assert.equal(result.response.status, 200);
  assert.equal(keys.length, 2);
  for (const key of keys) assert.match(key, /__card_ssr_v29_preload_subset\//);
});

test('reviewed price text follows HIGH to NONE and a later changed price', () => {
  const original = buildCardPriceDisplay(summary, high);
  const none = buildCardPriceDisplay(summary, { ...high, trust_level: 'NONE', display_krw: null });
  const changed = buildCardPriceDisplay({ ...summary, latest_krw: 20000, median_7d: 22000 },
    { ...high, display_krw: 20000 });
  assert.match(original.reviewedPriceText, /₩138,100/);
  assert.equal(none.reviewedPriceText, '현재 신뢰할 수 있는 참고가가 없습니다. 가격 대신 카드 식별 정보를 확인하세요.');
  assert.doesNotMatch(none.reviewedPriceText, /₩|138,?100|7일 중앙값/);
  assert.match(changed.reviewedPriceText, /₩20,000/);
  assert.match(changed.reviewedPriceText, /10\.0% 높습니다/);
  assert.doesNotMatch(changed.reviewedPriceText, /138,?100/);
});

test('reviewed price comparison uses valid positive seven-day medians and the current basis', () => {
  const t = { ...high, trust_level: 'MEDIUM', display_krw: 10000 };
  for (const [value, expected] of [[10000, /차이가 1% 미만/], ['10050', /차이가 1% 미만/],
    [11000, /10\.0% 높습니다/], [9000, /10\.0% 낮습니다/]]) {
    const d = buildCardPriceDisplay({ ...summary, median_7d: value }, t);
    assert.match(d.reviewedPriceText, /이상치를 제외한 30일 중앙값입니다/);
    assert.match(d.reviewedPriceText, expected);
    assert.doesNotMatch(d.reviewedPriceText, /NaN|Infinity/);
  }
});

test('invalid seven-day medians never produce invented percentages in reviewed text', () => {
  for (const median_7d of [null, undefined, 0, -1, NaN, Infinity, -Infinity, '', 'bad', ' ', true, false, {}, []]) {
    const d = buildCardPriceDisplay({ ...summary, median_7d }, high);
    assert.match(d.reviewedPriceText, /₩138,100/);
    assert.doesNotMatch(d.reviewedPriceText, /7일 중앙값|%|NaN|Infinity/);
  }
});

test('reviewed-card API payload updates its shared text through HIGH, NONE and a changed price', async () => {
  const slug = 'phanpy-205';
  const c = { ...card, slug, name: 'Phanpy', number: '205' };
  const s = { ...summary, card_slug: slug, median_7d: 140000 };
  for (const [source, trust] of [[s, high], [s, { ...high, trust_level: 'NONE', display_krw: null }],
    [{ ...s, latest_krw: 20000, median_7d: 22000 }, { ...high, display_krw: 20000 }]]) {
    const { response, body } = await invoke({ cards: [c], summary: [source], trust: [trust] }, { slug });
    assert.equal(response.status, 200);
    const expected = buildCardPriceDisplay(source, trust).reviewedPriceText;
    assert.equal(body.price_display.reviewedPriceText, expected);
    assert.equal(body.best.price_display.reviewedPriceText, expected);
    if (trust.trust_level === 'NONE') assert.doesNotMatch(expected, /₩|%|138,?100/);
  }
});

test('reviewed Phanpy SSR selector always receives the shared current price interpretation', async () => {
  const slug = 'phanpy-205';
  const c = { ...card, slug, name: 'Phanpy', number: '205' };
  const s = { ...summary, card_slug: slug, median_7d: 140000 };
  for (const [source, trust] of [[s, high], [s, { ...high, trust_level: 'NONE', display_krw: null }],
    [{ ...s, latest_krw: 20000, median_7d: 22000 }, { ...high, display_krw: 20000 }],
    [s, { ...high, trust_level: 'MEDIUM', display_krw: 10000 }]]) {
    const result = await invokePage({ cards: [c], summary: [source], trust: [trust] }, { slug });
    assert.equal(result.response.status, 200);
    assert.equal(result.elements.get('[data-c-reviewed-section]').removed, false);
    assert.equal(result.elements.get('[data-c-reviewed-price]').text, result.display.reviewedPriceText);
    assert.equal(result.display.reviewedPriceText, buildCardPriceDisplay(source, trust).reviewedPriceText);
    if (trust.trust_level === 'NONE') {
      assert.doesNotMatch(result.elements.get('[data-c-reviewed-price]').text, /₩|%|138,?100/);
    }
  }
});

test('SSR valid observed timestamp consistently supplies visible dates and Dataset dateModified', async () => {
  const result = await invokePage();
  assert.equal(result.response.status, 200);
  assert.equal(result.elements.get('#hero-updated').text, '2026.09.29');
  assert.equal(result.elements.get('[data-c-updated-at]').text, '2026.09.29');
  assert.equal(result.json.find(row => row['@type'] === 'Dataset').dateModified, '2026-09-29');
});

for (const last_fetched_at of [null, '', 'not-a-date', true, {}, '2026-13-01T00:00:00Z', '2026-02-30T00:00:00Z']) {
  test(`SSR malformed observed date ${JSON.stringify(last_fetched_at)} does not invent a date or emit NaN`, async () => {
    const result = await invokePage({ summary: [{ ...summary, last_fetched_at }] });
    assert.equal(result.response.status, 200);
    assert.equal(result.display.sourceDate, null);
    assert.equal(result.elements.get('#hero-updated').text, '—');
    assert.equal(result.elements.get('[data-c-updated-at]').text, '—');
    assert.equal(Object.hasOwn(result.json.find(row => row['@type'] === 'Dataset'), 'dateModified'), false);
    assert.doesNotMatch(result.head, /"dateModified":"NaN/);
  });
}

for (const ext_avg_24h of ['bad', '', ' ', 'Infinity', {}, [], true, false, -1, 0, null, NaN, Infinity]) {
  test(`SSR invalid optional EUR price ${JSON.stringify(ext_avg_24h)} is hidden without breaking the card`, async () => {
    const result = await invokePage({ cm: [{ ...cm, ext_avg_24h }] });
    assert.equal(result.response.status, 200);
    assert.equal(result.elements.get('[data-c-src-cm]').text, '—');
    assert.equal(result.elements.get('#hero-price').text, '₩ 138,100');
  });
}

test('SSR retains a valid positive original EUR price without converting it to KRW', async () => {
  for (const ext_avg_24h of [5.13, '5.13']) {
    const result = await invokePage({ cm: [{ ...cm, ext_avg_24h }] });
    assert.equal(result.elements.get('[data-c-src-cm]').text, '€5.13');
    assert.equal(result.elements.get('#hero-price').text, '₩ 138,100');
    assert.equal(result.elements.get('#pricing-fx').text, '별도 환율값 미제공');
  }
});
