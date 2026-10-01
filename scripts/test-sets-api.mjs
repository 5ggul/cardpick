#!/usr/bin/env node
// Isolated test fixtures only. No real provider requests or production writes.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
// Node requires JSON import attributes, while the production Wrangler 3 builder
// expects a plain JSON import. Inline only that import for the Node test harness.
const handlerSource = readFileSync(new URL('../functions/api/sets.js', import.meta.url), 'utf8');
const snapshotSource = readFileSync(new URL('../data/pokemon-sets-snapshot.json', import.meta.url), 'utf8');
const snapshotImport = "import setsSnapshot from '../../data/pokemon-sets-snapshot.json';";
assert.ok(handlerSource.includes(snapshotImport), 'Keep the production-compatible JSON import');
const testModuleSource = handlerSource.replace(snapshotImport, `const setsSnapshot = ${JSON.stringify(JSON.parse(snapshotSource))};`);
const { createSetsHandler } = await import(`data:text/javascript;base64,${Buffer.from(testModuleSource).toString('base64')}`);

const NOW = '2026-09-30T15:00:00.000Z';
const REVISION = '1111111111111111111111111111111111111111';
const SNAPSHOT_UPDATED = '2026-09-20T08:00:00.000Z';
const SNAPSHOT_RETRIEVED = '2026-09-29T10:00:00.000Z';
const SNAPSHOT_URL = `https://github.com/PokemonTCG/pokemon-tcg-data/blob/${REVISION}/sets/en.json`;
const PRIVATE_ERROR = 'PRIVATE_TEST_TOKEN=do-not-echo-network-errors';

function providerSet(id, releaseDate, extra = {}) {
  return {
    id,
    name: `TEST FIXTURE ${id}`,
    releaseDate,
    series: 'Test fixtures, not real products',
    printedTotal: 10,
    total: 12,
    images: { symbol: 'https://example.test/symbol.png' },
    ptcgoCode: 'TEST',
    updatedAt: '2026/09/01 00:00:00',
    ...extra,
  };
}

function snapshotFixture() {
  return {
    source: {
      name: 'Pokemon TCG Data',
      url: SNAPSHOT_URL,
      revision: REVISION,
      updated_at: SNAPSHOT_UPDATED,
      retrieved_at: SNAPSHOT_RETRIEVED,
    },
    data: [
      providerSet('snapshot-a', '2026/08/01'),
      providerSet('snapshot-b', '2026/09/01'),
    ],
  };
}

function jsonResponse(value, status = 200) {
  return new Response(JSON.stringify(value), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function apiFetcher(data) {
  return async () => jsonResponse({ data });
}

async function invoke({
  fetchImpl,
  snapshot = snapshotFixture(),
  now = () => new Date(NOW),
  timeoutMs = 100,
} = {}) {
  const handler = createSetsHandler({ fetchImpl, snapshot, now, timeoutMs });
  const response = await handler({
    request: new Request('https://cardpick.test/api/sets'),
    env: {},
  });
  const text = await response.text();
  return { response, body: JSON.parse(text), text };
}

function allRows(body) {
  return [...body.upcoming, ...body.recent, ...body.archive];
}

function assertSnapshot(result, reason) {
  assert.equal(result.response.status, 200);
  assert.equal(result.body.fallback, true);
  assert.equal(result.body.fallback_reason, reason);
  assert.equal(result.body.source.kind, 'snapshot');
  assert.equal(result.body.source.url, SNAPSHOT_URL);
  assert.equal(result.body.source.revision, REVISION);
  assert.equal(result.body.source.updated_at, SNAPSHOT_UPDATED);
  assert.equal(result.body.fetched_at, NOW);
  assert.equal(result.body.total, 2);
  assert.match(result.response.headers.get('Cache-Control') || '', /no-store/i);
  assert.deepEqual(allRows(result.body).map(row => row.id).sort(), ['snapshot-a', 'snapshot-b']);
  assert.ok(!result.text.includes(PRIVATE_ERROR), 'upstream private diagnostics must not reach clients');
}

function assertUnavailable(result) {
  assert.equal(result.response.status, 503);
  assert.match(result.response.headers.get('Cache-Control') || '', /no-store/i);
  assert.match(result.response.headers.get('Content-Type') || '', /application\/json/i);
  assert.equal(typeof result.body.error, 'string');
  assert.ok(result.body.error.length > 0);
  assert.ok(!result.text.includes(PRIVATE_ERROR), 'error payload must not expose upstream diagnostics');
  assert.ok(!result.text.includes('C:\\private\\'), 'error payload must not expose local paths');
  assert.notEqual(result.body.source?.kind, 'api', 'failed upstream must not be labeled a successful API result');
}

test('healthy API keeps the existing fields and exposes honest API provenance', async () => {
  const result = await invoke({ fetchImpl: apiFetcher([
    providerSet('future', '2026/10/02'),
    providerSet('past', '2026/09/30'),
    providerSet('today', '2026/10/01'),
  ]) });
  assert.equal(result.response.status, 200);
  assert.equal(result.body.today, '2026-10-01');
  assert.equal(result.body.fallback, false);
  assert.equal(result.body.source.kind, 'api');
  assert.equal(typeof result.body.source.name, 'string');
  assert.ok(result.body.source.name.length > 0);
  assert.match(result.body.source.url, /^https:\/\/(?:api\.)?pokemontcg\.io(?:\/|$)/);
  assert.equal(result.body.source.updated_at, null, 'request time is not the provider update time');
  assert.equal(result.body.fetched_at, NOW);
  assert.equal(result.body.total, 3);
  assert.deepEqual(result.body.upcoming.map(row => row.id), ['today', 'future']);
  assert.deepEqual(result.body.recent.map(row => row.id), ['past']);
  assert.deepEqual(result.body.archive, []);
  assert.equal(result.body.upcoming[0].release_date, '2026-10-01');
  assert.equal(result.body.upcoming[0].is_upcoming, true);
  assert.equal(result.body.recent[0].is_upcoming, false);
  assert.equal(result.body.upcoming[0].printed_total, 10);
  assert.equal(result.body.upcoming[0].symbol_url, 'https://example.test/symbol.png');
  assert.equal(result.body.upcoming[0].ptcgo_code, 'TEST');
  assert.match(result.response.headers.get('Content-Type') || '', /application\/json/i);
});

test('HTTP 500 falls back with unchanged snapshot provenance', async () => {
  let calls = 0;
  const result = await invoke({ fetchImpl: async () => {
    calls += 1;
    return jsonResponse({ error: PRIVATE_ERROR }, 500);
  } });
  assert.equal(calls, 1, 'the request must not create an automatic retry storm');
  assertSnapshot(result, 'upstream_http_error');
});

test('network exceptions fall back without disclosing exception messages', async () => {
  const result = await invoke({ fetchImpl: async () => {
    throw new Error(`${PRIVATE_ERROR}; C:\\private\\provider.env`);
  } });
  assertSnapshot(result, 'upstream_network_error');
});

test('fetch timeout is bounded even when the provider ignores its abort signal', { timeout: 1500 }, async () => {
  const result = await invoke({ fetchImpl: () => new Promise(() => {}), timeoutMs: 20 });
  assertSnapshot(result, 'upstream_timeout');
});

test('the timeout also bounds a response body that never finishes parsing', { timeout: 1500 }, async () => {
  const result = await invoke({
    fetchImpl: async () => ({ ok: true, status: 200, json: () => new Promise(() => {}) }),
    timeoutMs: 20,
  });
  assertSnapshot(result, 'upstream_timeout');
});

test('invalid JSON falls back instead of returning a successful empty calendar', async () => {
  const result = await invoke({ fetchImpl: async () => new Response('{broken-json', { status: 200 }) });
  assertSnapshot(result, 'upstream_invalid_json');
});

for (const [label, payload] of [
  ['missing data', {}],
  ['null payload', null],
  ['wrong data type', { data: {} }],
  ['empty data', { data: [] }],
  ['non-object row', { data: [null] }],
]) {
  test(`${label} is not accepted as authoritative source data`, async () => {
    const result = await invoke({ fetchImpl: async () => jsonResponse(payload) });
    assertSnapshot(result, 'upstream_invalid_data');
  });
}

for (const [label, record] of [
  ['non-leap February 29', providerSet('bad', '2025/02/29')],
  ['February 30', providerSet('bad', '2024/02/30')],
  ['month 13', providerSet('bad', '2026/13/01')],
  ['day zero', providerSet('bad', '2026/10/00')],
  ['month-only date', providerSet('bad', '2026/10')],
  ['missing ID', providerSet('', '2026/10/01')],
  ['blank name', providerSet('bad', '2026/10/01', { name: ' ' })],
  ['negative total', providerSet('bad', '2026/10/01', { total: -1 })],
  ['fractional printed total', providerSet('bad', '2026/10/01', { printedTotal: 2.5 })],
  ['non-HTTPS image', providerSet('bad', '2026/10/01', { images: { symbol: 'javascript:alert(1)' } })],
]) {
  test(`${label} rejects the malformed payload without publishing a partial calendar`, async () => {
    const result = await invoke({ fetchImpl: apiFetcher([
      providerSet('otherwise-valid', '2026/10/02'), record,
    ]) });
    assertSnapshot(result, 'upstream_invalid_data');
  });
}

test('valid leap dates and dashed provider dates are accepted', async () => {
  const result = await invoke({ fetchImpl: apiFetcher([
    providerSet('leap', '2024/02/29'),
    providerSet('dashed', '2026-10-01'),
  ]) });
  assert.equal(result.response.status, 200);
  assert.equal(result.body.fallback, false);
  assert.deepEqual(result.body.upcoming.map(row => row.id), ['dashed']);
  assert.equal(result.body.recent[0].release_date, '2024-02-29');
});

test('KST midnight moves a month-end release into past exactly once', async () => {
  const data = [providerSet('month-end', '2026/09/30'), providerSet('next-month', '2026/10/01')];
  const before = await invoke({ fetchImpl: apiFetcher(data), now: () => new Date('2026-09-30T14:59:59.000Z') });
  const after = await invoke({ fetchImpl: apiFetcher(data), now: () => new Date('2026-09-30T15:00:00.000Z') });
  assert.equal(before.body.today, '2026-09-30');
  assert.deepEqual(before.body.upcoming.map(row => row.id), ['month-end', 'next-month']);
  assert.deepEqual(before.body.recent, []);
  assert.equal(after.body.today, '2026-10-01');
  assert.deepEqual(after.body.upcoming.map(row => row.id), ['next-month']);
  assert.deepEqual(after.body.recent.map(row => row.id), ['month-end']);
});

test('KST year boundary and snapshot classification use the same date rules', async () => {
  const snapshot = snapshotFixture();
  snapshot.data = [providerSet('year-end', '2026/12/31'), providerSet('new-year', '2027/01/01')];
  const result = await invoke({
    fetchImpl: async () => { throw new Error('offline'); }, snapshot,
    now: () => new Date('2026-12-31T15:00:00.000Z'),
  });
  assert.equal(result.body.today, '2027-01-01');
  assert.equal(result.body.fallback, true);
  assert.deepEqual(result.body.upcoming.map(row => row.id), ['new-year']);
  assert.deepEqual(result.body.recent.map(row => row.id), ['year-end']);
  assert.equal(result.body.source.updated_at, SNAPSHOT_UPDATED);
});

test('duplicate identical IDs collapse but different products on one date survive', async () => {
  const first = providerSet('same-id', '2026/10/01');
  const result = await invoke({ fetchImpl: apiFetcher([
    first, structuredClone(first), providerSet('different-id', '2026/10/01'),
  ]) });
  assert.equal(result.body.fallback, false);
  assert.equal(result.body.total, 2);
  assert.deepEqual(result.body.upcoming.map(row => row.id).sort(), ['different-id', 'same-id']);
});

test('a conflicting repeated ID invalidates the upstream response', async () => {
  const result = await invoke({ fetchImpl: apiFetcher([
    providerSet('conflict', '2026/10/01'), providerSet('conflict', '2026/10/02'),
  ]) });
  assertSnapshot(result, 'upstream_invalid_data');
});

test('recent/archive preserve a descending date order and disjoint rows', async () => {
  const data = Array.from({ length: 14 }, (_, i) => providerSet(`past-${i + 1}`, `2026/09/${String(i + 1).padStart(2, '0')}`));
  const result = await invoke({ fetchImpl: apiFetcher(data) });
  assert.equal(result.body.total, 14);
  assert.equal(result.body.recent.length, 12);
  assert.equal(result.body.archive.length, 2);
  assert.deepEqual(allRows(result.body).map(row => row.id), data.toReversed().map(row => row.id));
  assert.equal(new Set(allRows(result.body).map(row => row.id)).size, 14);
});

test('the existing archive limit remains separate from the source record count', async () => {
  const data = Array.from({ length: 70 }, (_, i) => {
    const date = new Date(Date.UTC(2026, 0, i + 1)).toISOString().slice(0, 10);
    return providerSet(`archive-${i}`, date);
  });
  const result = await invoke({ fetchImpl: apiFetcher(data) });
  assert.equal(result.body.total, 70);
  assert.equal(result.body.recent.length, 12);
  assert.equal(result.body.archive.length, 48);
  assert.deepEqual(allRows(result.body).map(row => row.id), data.toReversed().slice(0, 60).map(row => row.id));
});

test('normalization never mutates provider objects or the checked-in snapshot', async () => {
  const snapshot = snapshotFixture();
  const snapshotBefore = JSON.stringify(snapshot);
  const providerData = [providerSet('immutable', '2026/10/01')];
  const providerBefore = JSON.stringify(providerData);
  const healthy = await invoke({ fetchImpl: async () => ({ ok: true, status: 200, json: async () => ({ data: providerData }) }), snapshot });
  assert.equal(healthy.body.fallback, false);
  assert.equal(JSON.stringify(providerData), providerBefore);
  const fallback = await invoke({ fetchImpl: async () => jsonResponse({}, 500), snapshot });
  assertSnapshot(fallback, 'upstream_http_error');
  assert.equal(JSON.stringify(snapshot), snapshotBefore);
  assert.notEqual(fallback.body.source.updated_at, fallback.body.fetched_at);
});

for (const [label, invalidSnapshot] of [
  ['no snapshot', null],
  ['empty snapshot data', { ...snapshotFixture(), data: [] }],
  ['missing provenance', { data: snapshotFixture().data }],
  ['missing original update date', { ...snapshotFixture(), source: { ...snapshotFixture().source, updated_at: undefined } }],
  ['invalid source timestamp', { ...snapshotFixture(), source: { ...snapshotFixture().source, updated_at: 'not-a-date' } }],
  ['mutable source URL', { ...snapshotFixture(), source: { ...snapshotFixture().source, url: 'https://github.com/PokemonTCG/pokemon-tcg-data/blob/master/sets/en.json' } }],
  ['revision and URL mismatch', { ...snapshotFixture(), source: { ...snapshotFixture().source, revision: '2222222222222222222222222222222222222222' } }],
  ['invalid snapshot release date', { ...snapshotFixture(), data: [providerSet('bad-snapshot', '2026/02/30')] }],
]) {
  test(`both sources fail safely when there is ${label}`, async () => {
    const result = await invoke({
      fetchImpl: async () => { throw new Error(`${PRIVATE_ERROR}; C:\\private\\token.json`); },
      snapshot: invalidSnapshot,
    });
    assertUnavailable(result);
  });
}

test('unusable fallback data does not stop a healthy upstream API', async () => {
  const result = await invoke({ fetchImpl: apiFetcher([providerSet('live-only', '2026/10/01')]), snapshot: null });
  assert.equal(result.response.status, 200);
  assert.equal(result.body.fallback, false);
  assert.deepEqual(result.body.upcoming.map(row => row.id), ['live-only']);
});

// Execute the actual release-list browser code with isolated DOM and fetch doubles.
// The official calendar is intentionally outside this lower third-party data list.
const releaseHtml = readFileSync(new URL('../releases.html', import.meta.url), 'utf8');
const inlineScripts = [...releaseHtml.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)];
const listScript = inlineScripts.find(([, attributes, body]) => !attributes.includes('src=') && body.includes('function daysFromToday'))?.[2];
assert.ok(listScript, 'the real release-list script must be found');
const clientCode = listScript.slice(listScript.indexOf('(async function(){'));
const clientIds = [
  'rel-upcoming', 'rel-recent', 'rel-archive-body', 'rel-source-status',
  'rel-upcoming-heading', 'rel-recent-heading', 'rel-archive-heading',
  'news-events-list', 'trend-events-list', 'news-events-meta', 'trend-events-meta',
];
const protectedIds = ['cal', 'cal-upcoming', 'cal-recent', 'cal-pending', 'faq'];

async function renderClient(body, { ok = true, now = NOW } = {}) {
  const nodes = Object.fromEntries(clientIds.map(id => [id, { innerHTML: '', textContent: '' }]));
  const touched = [];
  for (const id of protectedIds) {
    const sentinel = {};
    for (const key of ['innerHTML', 'textContent']) {
      Object.defineProperty(sentinel, key, {
        get: () => `UNCHANGED:${id}`,
        set: () => assert.fail(`third-party data must not overwrite ${id}`),
      });
    }
    nodes[id] = sentinel;
  }
  const FixedDate = class extends Date {
    constructor(...args) { super(...(args.length ? args : [now])); }
    static now() { return Date.parse(now); }
  };
  await vm.runInNewContext(clientCode, {
    Date: FixedDate, Set, Number, String,
    console: { warn() {} },
    document: {
      querySelectorAll: () => [],
      getElementById: id => { touched.push(id); return nodes[id] || null; },
    },
    fetch: async url => {
      assert.ok(url === '/api/sets' || url === '/api/trend-events?limit=18', 'tests must not call external providers');
      return {
        ok, status: ok ? 200 : 503,
        json: async () => structuredClone(url.includes('trend-events') ? { items: [] } : body),
      };
    },
  });
  assert.deepEqual(touched.filter(id => protectedIds.includes(id)), [], 'the reference list must not target official calendar or FAQ');
  for (const id of protectedIds) assert.equal(nodes[id].innerHTML, `UNCHANGED:${id}`);
  return nodes;
}

test('release HTML inline scripts compile and structured data remains valid JSON', () => {
  for (const [, attributes, code] of inlineScripts) {
    if (attributes.includes('ld+json')) JSON.parse(code);
    else if (!attributes.includes('src=')) new vm.Script(code);
  }
});

function plainInlineText(html) {
  return html.replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();
}

function assertCompactApiSource(html) {
  assert.equal(plainInlineText(html), '영문판 기준 · 출처: Pokémon TCG API');
  assert.match(html, /<a\b[^>]*href="https:\/\/pokemontcg\.io\/"[^>]*>Pokémon TCG API<\/a>/);
  assert.match(html, /target="_blank"/);
  assert.match(html, /rel="noopener nofollow"/);
}

test('static reference-list source stays visible as one compact line without the old explanation panel', () => {
  const introduction = releaseHtml.match(/<section\b[^>]*id="release-schedule"[\s\S]*?(?=<div\b[^>]*id="upcoming")/)?.[0];
  assert.ok(introduction, 'reference-list introduction must be found');
  const source = introduction.match(/<p\b[^>]*id="rel-source-status"[^>]*>([\s\S]*?)<\/p>/)?.[1];
  assert.ok(source, 'source link must be present before JavaScript runs');
  assertCompactApiSource(source);
  assert.equal((introduction.match(/<p\b/g) || []).length, 1, 'the short source line must not grow back into explanation paragraphs');
  assert.doesNotMatch(introduction, /class="[^"]*\bpanel\b|데이터 갱신 안내|오늘 조회했다는 이유|원본 변경일과 출처를 표시|조회가 되지 않으면 같은 제공자/);
});

test('the normal client shows KST today exactly once without inventing an update date', async () => {
  const { body } = await invoke({ fetchImpl: apiFetcher([
    providerSet('today-ui', '2026/10/01'),
    providerSet('tomorrow-ui', '2026/10/02'),
    providerSet('yesterday-ui', '2026/09/30', { name: 'Past <Set>' }),
  ]) });
  const nodes = await renderClient(body);
  assert.match(nodes['rel-upcoming'].innerHTML, /오늘 발매/);
  assert.match(nodes['rel-upcoming'].innerHTML, /D-1/);
  assert.match(nodes['rel-recent'].innerHTML, /D\+1/);
  assert.match(nodes['rel-recent'].innerHTML, /Past &lt;Set&gt;/);
  assert.doesNotMatch(nodes['rel-recent'].innerHTML, /TEST FIXTURE today-ui/);
  assertCompactApiSource(nodes['rel-source-status'].innerHTML);
  assert.doesNotMatch(nodes['rel-source-status'].innerHTML, /2026|보관 자료/);
  assert.doesNotMatch(nodes['rel-recent'].innerHTML, /tcg\.pokemon\.com\/en-us\/expansions/);
});

test('fallback UI shows original source date and does not claim a current release schedule', async () => {
  const { body } = await invoke({ fetchImpl: async () => jsonResponse({}, 500) });
  const nodes = await renderClient(body);
  assert.equal(plainInlineText(nodes['rel-source-status'].innerHTML), '보관 자료 · 원본 수정일 2026.09.20');
  assert.match(nodes['rel-source-status'].innerHTML, /<a\b[^>]*>보관 자료<\/a>/);
  assert.ok(nodes['rel-source-status'].innerHTML.includes(SNAPSHOT_URL));
  assert.doesNotMatch(nodes['rel-source-status'].innerHTML, /2026\.09\.30|2026\.10\.01/);
  assert.match(nodes['rel-upcoming'].innerHTML, /보관 자료만으로 현재 예정 발매를 판단하지 않습니다/);
  assert.doesNotMatch(nodes['rel-upcoming'].innerHTML, /예정 세트가 없습니다/);
  assert.match(nodes['rel-recent'].innerHTML, /보관 기록/);
  assert.doesNotMatch(nodes['rel-recent'].innerHTML, /D\+\d|D-\d|오늘 발매/);
  for (const id of ['rel-upcoming-heading', 'rel-recent-heading', 'rel-archive-heading']) {
    assert.match(nodes[id].textContent, /보관 자료/);
  }
});

test('a snapshot future date is presented as an archived record, not a live countdown', async () => {
  const snapshot = snapshotFixture();
  snapshot.data = [providerSet('archived-future', '2026/10/02')];
  const { body } = await invoke({ fetchImpl: async () => jsonResponse({}, 500), snapshot });
  const nodes = await renderClient(body);
  assert.match(nodes['rel-upcoming'].innerHTML, /TEST FIXTURE archived-future/);
  assert.match(nodes['rel-upcoming'].innerHTML, /보관 기록/);
  assert.doesNotMatch(nodes['rel-upcoming'].innerHTML, /D-1|오늘 발매/);
});

test('an authoritative empty reference list remains distinct from an unavailable list', async () => {
  const { body } = await invoke({ fetchImpl: apiFetcher([providerSet('past-ui', '2026/09/30')]) });
  body.upcoming = []; body.recent = []; body.archive = [];
  const empty = await renderClient(body);
  assert.match(empty['rel-upcoming'].innerHTML, /이 제3자 목록에 등록된 예정 세트가 없습니다/);
  assert.match(empty['rel-upcoming'].innerHTML, /공식 발표 전체를 뜻하지 않습니다/);
  const failed = await renderClient({}, { ok: false });
  assert.match(failed['rel-source-status'].textContent, /예정 발매가 없다는 뜻은 아닙니다/);
  assert.match(failed['rel-upcoming'].innerHTML, /불러오지 못했습니다/);
  assert.doesNotMatch(failed['rel-upcoming'].innerHTML, /예정 세트가 없습니다/);
});

test('client rejects absent or inconsistent provenance instead of presenting fresh-looking data', async () => {
  const { body } = await invoke({ fetchImpl: async () => jsonResponse({}, 500) });
  const invalid = [
    { ...body, source: undefined },
    { ...body, fallback: false },
    { ...body, source: { ...body.source, url: 'https://github.com/PokemonTCG/pokemon-tcg-data/blob/master/sets/en.json' } },
    { ...body, source: { ...body.source, updated_at: 'not-a-date' } },
    { ...body, recent: [{ id: 'invalid-date', release_date: '2026-02-30' }], archive: [] },
  ];
  for (const payload of invalid) {
    const nodes = await renderClient(payload);
    assert.match(nodes['rel-source-status'].textContent, /확인하지 못했습니다/);
    assert.match(nodes['rel-upcoming'].innerHTML, /불러오지 못했습니다/);
    assert.doesNotMatch(nodes['rel-upcoming'].innerHTML, /예정 세트가 없습니다/);
  }
});
