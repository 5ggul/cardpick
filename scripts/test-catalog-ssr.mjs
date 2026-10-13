#!/usr/bin/env node
// Isolated catalog SSR fixtures only; no network, DB or production cache writes.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { createJsonDeadline } from '../functions/_lib/card-price-display.js';

const source = readFileSync(new URL('../functions/catalog.js', import.meta.url), 'utf8');
const executable = source.replace("import { createJsonDeadline } from './_lib/card-price-display.js';", '')
  .replace('export async function onRequest', 'async function onRequest') + '\nthis.handler = onRequest;';
const PRIVATE_ERROR = 'PRIVATE_CATALOG_FIXTURE_ERROR';
const REVIEWED = ['phanpy-205', 'kyurem-ex-28', 'umbreon-ex-161', 'pikachu-with-grey-felt-hat-85',
  'mew-ex-232', 'giratina-v-186', 'mega-charizard-x-ex-125', 'charizard-ex-199'];

function fixtures(size) {
  const cards = Array.from({ length: size }, (_, index) => ({
    slug: `catalog-test-${index + 1}`, name: `TEST FIXTURE ${index + 1}`, name_ko: null,
    set_code: 'TST', set_name: 'Isolated catalog fixture', number: String(index + 1), rarity_class: 'OTHER',
  }));
  const trust = cards.map((card, index) => ({ card_slug: card.slug, trust_level: index % 2 ? 'MEDIUM' : 'HIGH',
    display_krw: 100000 - index * 100, computed_at: '2026-10-01T00:00:00Z' }));
  return { cards, trust };
}

async function invoke({ cards, trust, trustResponse = null, cardsResponse = null, deadlineMs = null } = fixtures(12)) {
  const calls = [], signals = [];
  const sandbox = { Request, Response, Headers,
    createJsonDeadline: options => createJsonDeadline({ ...options, ...(deadlineMs === null ? {} : { timeoutMs: deadlineMs }) }),
    fetch: async (input, init) => {
      const url = new URL(input);
      calls.push(url);
      signals.push(init.signal);
      assert.equal(url.protocol, 'https:');
      assert.equal(url.hostname, 'aqxrmdratnkffvivguqs.supabase.co');
      assert.equal(init.method ?? 'GET', 'GET');
      if (url.pathname === '/rest/v1/card_price_trust') {
        assert.equal(url.searchParams.get('limit'), '100');
        assert.equal(url.searchParams.get('trust_level'), 'in.(HIGH,MEDIUM)');
        assert.equal(url.searchParams.get('display_krw'), 'gte.5000');
        assert.equal(url.searchParams.get('order'), 'display_krw.desc');
        return trustResponse ? trustResponse(url, init) : Response.json(trust ?? []);
      }
      assert.equal(url.pathname, '/rest/v1/cards');
      assert.equal(url.searchParams.get('game'), 'eq.pokemon');
      assert.ok(url.searchParams.get('slug').startsWith('in.('));
      return cardsResponse ? cardsResponse(url, init) : Response.json(cards ?? []);
    },
  };
  vm.runInNewContext(executable, sandbox);
  const response = await sandbox.handler({});
  return { response, html: await response.text(), calls, signals };
}

function assertFallback(result, { failed, calls }) {
  assert.equal(result.response.status, 200, 'keep the existing usable catalog fallback, not a new 503 policy');
  assert.match(result.html, /<meta name="robots" content="noindex,follow">/);
  assert.match(result.html, /<link rel="canonical" href="https:\/\/cardpick.kr\/catalog">/);
  assert.match(result.html, failed ? /카드 목록을 가져오지 못했습니다\. 검색은 정상적으로 이용할 수 있습니다\./
    : /현재 표시할 카드 목록을 준비하고 있습니다\. 검색을 이용해 주세요\./);
  assert.equal(result.response.headers.get('Cache-Control'), 'public, s-maxage=3600, stale-while-revalidate=300');
  for (const slug of REVIEWED) assert.ok(result.html.includes(`href="/cards/${slug}"`));
  assert.match(result.html, /<form class="search" action="\/search" method="get">/);
  assert.equal(result.calls.length, calls);
  assert.doesNotMatch(result.html, new RegExp(PRIVATE_ERROR + '|stack|supabase'));
  assert.ok(result.signals.every(signal => signal.aborted), 'request cleanup releases the shared timer and controller');
}

test('catalog keeps the two-GET contract, 36-card cap and existing indexable threshold', async () => {
  const input = fixtures(80), before = JSON.stringify(input);
  const result = await invoke(input);
  assert.equal(result.response.status, 200);
  assert.equal(result.calls.length, 2);
  assert.deepEqual(result.calls.map(url => url.pathname), ['/rest/v1/card_price_trust', '/rest/v1/cards']);
  assert.match(result.html, /<meta name="robots" content="index,follow,max-image-preview:large">/);
  assert.equal((result.html.match(/class="catalog-row"/g) || []).length, 36);
  assert.match(result.html, /href="\/cards\/catalog-test-1"/);
  assert.match(result.html, /₩100,000/);
  assert.match(result.html, /가격 집계 2026-10-01/);
  assert.doesNotMatch(result.html, /href="\/cards\/catalog-test-37"/);
  assert.equal(JSON.stringify(input), before);
  assert.ok(result.signals[0] === result.signals[1], 'all REST reads share the same request-scoped deadline');
  assert.ok(result.signals.every(signal => signal.aborted));
  const schema = JSON.parse(result.html.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/)[1]);
  assert.equal(schema.mainEntity.numberOfItems, 20);
  assert.equal(schema.mainEntity.itemListElement.length, 20);
  assert.deepEqual(schema.mainEntity.itemListElement.slice(0, 8).map(item => item.url),
    REVIEWED.map(slug => `https://cardpick.kr/cards/${slug}`));
  assert.equal(result.response.headers.get('Cache-Control'), 'public, s-maxage=3600, stale-while-revalidate=300');
});

for (const size of [0, 1, 11, 12]) {
  test(`catalog ${size}-card boundary preserves the original robots and fallback policy`, async () => {
    const result = await invoke(fixtures(size));
    if (size < 12) assertFallback(result, { failed: false, calls: size ? 2 : 1 });
    else {
      assert.match(result.html, /content="index,follow,max-image-preview:large"/);
      assert.equal((result.html.match(/class="catalog-row"/g) || []).length, 12);
    }
  });
}

test('catalog keeps the original printed-number deduplication and canonical-variant preference', async () => {
  const input = fixtures(12);
  input.cards.push({ ...input.cards[0], slug: 'catalog--variant', number: '001/999' });
  input.trust.unshift({ ...input.trust[0], card_slug: 'catalog--variant' });
  const result = await invoke(input);
  assert.equal(result.calls.length, 2);
  assert.equal((result.html.match(/class="catalog-row"/g) || []).length, 12);
  assert.match(result.html, /href="\/cards\/catalog-test-1"/);
  assert.doesNotMatch(result.html, /href="\/cards\/catalog--variant"/);
});

const failures = [
  ['HTTP', () => new Response(PRIVATE_ERROR, { status: 503 })],
  ['network', () => { throw new Error(PRIVATE_ERROR); }],
  ['invalid JSON', () => ({ ok: true, json: async () => { throw new Error(PRIVATE_ERROR); } })],
  ['object payload', () => Response.json({ error: PRIVATE_ERROR })],
  ['malformed rows', () => Response.json([null])],
];
for (const table of ['trust', 'cards']) {
  for (const [label, failure] of failures) {
    test(`catalog ${table} ${label} failure keeps reviewed links and the original usable fallback`, async () => {
      const result = await invoke({ ...fixtures(12), [`${table}Response`]: failure });
      assertFallback(result, { failed: true, calls: table === 'trust' ? 1 : 2 });
    });
  }
}

for (const table of ['trust', 'cards']) {
  for (const part of ['headers', 'body']) {
    test(`catalog bounds ${table} ${part} including an abort-ignoring provider`, async () => {
      const started = performance.now();
      const never = () => part === 'headers' ? new Promise(() => {}) : { ok: true, json: () => new Promise(() => {}) };
      const result = await invoke({ ...fixtures(12), deadlineMs: 20, [`${table}Response`]: never });
      assertFallback(result, { failed: true, calls: table === 'trust' ? 1 : 2 });
      assert.ok(performance.now() - started < 1000);
    });
  }
}

test('catalog metadata parsing cannot restart the single shared deadline', async () => {
  const input = fixtures(12), started = performance.now();
  const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
  const result = await invoke({ ...input, deadlineMs: 40,
    trustResponse: async () => { await pause(20); return Response.json(input.trust); },
    cardsResponse: () => ({ ok: true, json: async () => { await pause(50); return input.cards; } }),
  });
  assertFallback(result, { failed: true, calls: 2 });
  assert.ok(performance.now() - started < 1000);
  assert.match(source, /createJsonDeadline\(\{ fetchImpl: fetch \}\)/, 'production uses the existing shared default deadline');
});

test('catalog mobile header uses page-owned touch targets and keyboard focus without adding SDKs', async () => {
  const result = await invoke();
  assert.match(result.html, /\.site-header a:focus-visible,\.site-header button:focus-visible,\.search button:focus-visible\{outline:2px solid var\(--mint\);outline-offset:3px\}/);
  assert.match(result.html, /@media\(max-width:980px\)\{\.site-header \.brand,\.site-header \.nav a\{min-height:44px;min-width:44px\}/);
  assert.match(result.html, /\.site-header \.nav\{min-width:0;scrollbar-width:thin\}/);
  assert.match(result.html, /<nav class="nav" aria-label="주요 메뉴">/);
  assert.doesNotMatch(result.html, /adsbygoogle|pagead2\.googlesyndication|supabase-js|accounts\.google\.com\/gsi/);
});
