#!/usr/bin/env node
// Execute the real card-detail renderer with isolated DOM/network doubles.
// These fixtures are test-only; no provider, database, or production writes occur.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { buildCardPriceDisplay } from '../functions/_lib/card-price-display.js';

const html = readFileSync(new URL('../card-detail.html', import.meta.url), 'utf8');
const client = readFileSync(new URL('../card-detail.js', import.meta.url), 'utf8');
test('related cards keep all fields in a shrinkable mobile grid', () => {
  assert.match(html, /\.related-card-row > \*\s*\{[^}]*min-width:0;[^}]*overflow-wrap:anywhere/);
  assert.match(html, /@media \(max-width:639px\)\s*\{\s*\.related-card-row\s*\{\s*grid-template-columns:28px minmax\(0,1fr\) 24px/);
  assert.match(html, /\.related-card-row \.related-card-price\s*\{[^}]*grid-column:2; grid-row:2; text-align:left/);
  assert.doesNotMatch(html, /grid-cols-\[28px_1fr_120px_72px\]/);
});

test('real related-card renderer retains links, long names, prices and missing-price fields', () => {
  const body = client.split('var rows = cards.slice(0,5).map(function(card, i){')[1].split('el.innerHTML = rows;')[0];
  assert.ok(body);
  const card = { slug:'test-only', name:'Long test-only card '.repeat(12), name_ko:'테스트 카드', game:'pokemon', set_code:'TEST', number:'123/456', rarity_class:'SAR' };
  const escapeHtmlSimple = value => String(value).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;');
  const render = priceMap => vm.runInNewContext('var rows = cards.slice(0,5).map(function(card, i){' + body + '\nrows;', { cards:[card], priceMap, escapeHtmlSimple, rarityCls:()=>'rb-sar' });
  const priced = render({ 'test-only':{price_krw:123456789} });
  assert.match(priced, /class="related-card-row /);
  assert.ok(priced.includes(card.name));
  assert.match(priced, /href="\/cards\/test-only"/);
  assert.match(priced, /₩ 123,456,789/);
  assert.match(priced, /TEST · #123\/456/);
  assert.match(priced, /related-card-price/);
  assert.match(priced, /related-card-change/);
  assert.doesNotMatch(render({}), /₩ 0/);
});
const startMarker = '// CARDPICK_PRICE_DISPLAY_START';
const endMarker = '// CARDPICK_PRICE_DISPLAY_END';
assert.equal(html.split(startMarker).length, 2, 'one renderer start marker is required');
assert.equal(html.split(endMarker).length, 2, 'one renderer end marker is required');
const code = html.split(startMarker)[1].split(endMarker)[0];
const CARD = { slug: 'seaking-21', name: 'Seaking', name_ko: '왕콘치', number: '21', set_name: 'Test fixture set' };
const REVIEWED_CARD = { slug: 'phanpy-205', name: 'Phanpy', name_ko: '코코리', number: '205', set_name: 'Surging Sparks' };
const CARD_URL = 'https://cardpick.kr/cards/seaking-21';
const SOURCE_DATE = '2026-09-30T00:00:00.000Z';
const PRIVATE_ERROR = 'PRIVATE_TEST_ONLY_ERROR_DO_NOT_DISPLAY';

function fixture({ level = 'HIGH', amount = 235, rawAmount = amount, usd = 0.17, d7 = 10, d30 = 22, median7 = null } = {}) {
  const summary = { latest_krw: rawAmount, latest_usd: usd, samples_7d: 999, samples_30d: 998, last_fetched_at: SOURCE_DATE, median_7d: median7 };
  const trust = { trust_level: level, display_krw: amount, distinct_7d: d7, distinct_30d: d30 };
  const display = buildCardPriceDisplay(summary, trust);
  return {
    best: { ...summary, latest_krw: display.amountKrw, latest_usd: display.sourceUsd, trust_level: display.trustLevel, price_display: display },
    price_display: display,
    cardmarket: null,
  };
}

class Element {
  constructor(tagName, attributes = {}, text = '') {
    this.tagName = tagName.toLowerCase();
    this.attributes = new Map(Object.entries(attributes));
    this.textContent = text;
    this.style = {};
    this.removed = false;
    const classes = new Set((attributes.class || '').split(/\s+/).filter(Boolean));
    this.classList = {
      add: (...names) => names.forEach(name => classes.add(name)),
      remove: (...names) => names.forEach(name => classes.delete(name)),
      contains: name => classes.has(name),
      toggle: (name, force) => {
        const add = force === undefined ? !classes.has(name) : force;
        if (add) classes.add(name); else classes.delete(name);
        return add;
      },
    };
  }
  setAttribute(name, value) { this.attributes.set(name, String(value)); }
  getAttribute(name) { return this.attributes.has(name) ? this.attributes.get(name) : null; }
  remove() { this.removed = true; }
  set type(value) { this.setAttribute('type', value); }
  get type() { return this.getAttribute('type'); }
}

function matches(element, selector) {
  if (selector.startsWith('#')) return element.getAttribute('id') === selector.slice(1);
  const parsed = selector.match(/^([\w-]+)?(?:\[([^=\]]+)(?:="([^"]*)")?\])?$/);
  assert.ok(parsed, `unsupported test selector: ${selector}`);
  const [, tag, attr, value] = parsed;
  return (!tag || element.tagName === tag.toLowerCase())
    && (!attr || (value === undefined ? element.attributes.has(attr) : element.getAttribute(attr) === value));
}

function createDocument({ withPriceSchema = true, cardUrl = CARD_URL, reviewed = false } = {}) {
  const nodes = [];
  // Register actual HTML elements, not strings inside unrelated inline scripts.
  const markup = html.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '');
  for (const [, tag, attributeText] of markup.matchAll(/<([a-z][\w-]*)\b([^>]*?)>/gi)) {
    const attributes = {};
    for (const [, name, double, single, unquoted] of attributeText.matchAll(/([\w:-]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+)))?/g)) {
      attributes[name] = double ?? single ?? unquoted ?? '';
    }
    nodes.push(new Element(tag, attributes));
  }
  const document = {
    nodes,
    head: { appendChild: element => { nodes.push(element); return element; } },
    createElement: tag => new Element(tag),
    getElementById: id => nodes.find(element => !element.removed && element.getAttribute('id') === id) || null,
    querySelectorAll: selectors => nodes.filter(element => !element.removed && selectors.split(',').some(selector => matches(element, selector.trim()))),
    querySelector: selector => document.querySelectorAll(selector)[0] || null,
  };
  const canonical = document.querySelector('link[rel="canonical"]');
  assert.ok(canonical, 'real template must contain a canonical element');
  canonical.setAttribute('href', cardUrl);
  if (reviewed) {
    const section = document.querySelector('[data-c-reviewed-section]');
    assert.ok(section, 'the actual reviewed-card section must exist');
    // A reviewed card's SSR removes this attribute before browser hydration.
    section.attributes.delete('hidden');
  }
  // SSR inserts these schemas into the template. Include all three to detect
  // Dataset replacement without accidentally deleting the other schema types.
  const initialSchemas = [
    { '@context': 'https://schema.org', '@type': 'WebPage', description: 'SSR old description', url: cardUrl },
    { '@context': 'https://schema.org', '@type': 'BreadcrumbList', itemListElement: [] },
  ];
  if (withPriceSchema) initialSchemas.push({ '@context': 'https://schema.org', '@type': 'Dataset', variableMeasured: [{ name: 'display_krw', value: 99999 }] });
  for (const data of initialSchemas) nodes.push(new Element('script', { type: 'application/ld+json' }, JSON.stringify(data)));
  return document;
}

async function settle() { await new Promise(resolve => setImmediate(resolve)); }

function startClient({ ssr = fixture(), useBestOnly = false, withSlug = true, card = CARD, reviewed = false } = {}) {
  const document = createDocument({ withPriceSchema: Boolean(ssr), cardUrl: `https://cardpick.kr/cards/${card.slug}`, reviewed });
  const timers = new Map();
  let timerId = 0;
  let resolveFetch;
  let rejectFetch;
  const fetchPromise = new Promise((resolve, reject) => { resolveFetch = resolve; rejectFetch = reject; });
  const fetchCalls = [];
  const window = { CARDPICK_CARD: structuredClone(card) };
  if (withSlug) window.CARDPICK_SLUG = card.slug;
  if (ssr) {
    window.CARDPICK_BEST = structuredClone(ssr.best);
    if (!useBestOnly) window.CARDPICK_PRICE_DISPLAY = structuredClone(ssr.price_display);
  }
  const context = vm.createContext({
    window, document,
    location: { pathname: withSlug ? `/cards/${card.slug}` : '/' },
    AbortController, Number, Object, String, JSON,
    setTimeout: (callback, delay) => { const id = ++timerId; timers.set(id, { callback, delay }); return id; },
    clearTimeout: id => timers.delete(id),
    fetch: (url, options) => {
      assert.equal(url, `/api/card-summary?slug=${encodeURIComponent(card.slug)}`);
      fetchCalls.push({ url, options });
      options.signal.addEventListener('abort', () => rejectFetch(new Error(PRIVATE_ERROR)), { once: true });
      return fetchPromise;
    },
  });
  vm.runInContext(code, context);
  return {
    document, window, timers, fetchCalls,
    async succeed(payload, status = 200) {
      resolveFetch({ ok: status >= 200 && status < 300, status, json: async () => structuredClone(payload) });
      await settle();
    },
    async fail(error = new Error(PRIVATE_ERROR)) { rejectFetch(error); await settle(); },
    async invalidJson() { resolveFetch({ ok: true, status: 200, json: async () => { throw new Error(PRIVATE_ERROR); } }); await settle(); },
    async timeout() { for (const timer of [...timers.values()]) timer.callback(); await settle(); },
  };
}

function text(client, selector) {
  const element = client.document.querySelector(selector);
  assert.ok(element, `real template element missing: ${selector}`);
  return element.textContent;
}

function schemas(client) {
  return client.document.querySelectorAll('script[type="application/ld+json"]').map(element => JSON.parse(element.textContent));
}

function dataset(client) {
  const values = schemas(client).filter(value => value['@type'] === 'Dataset');
  assert.equal(values.length, 1, 'an available card must have exactly one current Dataset');
  return values[0];
}

const descriptionSelector = 'meta[name="description"],meta[property="og:description"],meta[name="twitter:description"]';
const priceSelectors = [
  '#hero-price', '#hero-price-label', '#hero-secondary', '#hero-judgement',
  '[data-c-h1-lede]', '[data-c-about]', '[data-c-trust-label]', '[data-c-trust-level]',
  '[data-c-trust-basis]', '[data-c-samples]', '[data-c-citation-1]', '[data-c-citation-3]',
  '[data-c-citation-4]', '[data-c-src-tcg]', '[data-c-updated-at]', '#pricing-basis', '#pricing-fx',
  '[data-c-reviewed-price]',
];

function priceSnapshot(client) {
  return {
    text: Object.fromEntries(priceSelectors.map(selector => [selector, text(client, selector)])),
    descriptions: client.document.querySelectorAll(descriptionSelector).map(element => element.getAttribute('content')),
    schemas: schemas(client),
    level: client.document.querySelector('[data-c-trust-label]').getAttribute('data-level'),
  };
}

function assertDescriptionsAgree(client, amount) {
  const sentence = text(client, '#hero-judgement');
  assert.equal(text(client, '[data-c-h1-lede]'), sentence);
  const descriptions = client.document.querySelectorAll(descriptionSelector);
  assert.ok(client.document.querySelector('meta[name="description"]'));
  assert.ok(client.document.querySelector('meta[property="og:description"]'));
  assert.ok(descriptions.length >= 2);
  for (const element of descriptions) assert.equal(element.getAttribute('content'), sentence);
  assert.equal(schemas(client).find(schema => schema['@type'] === 'WebPage').description, sentence);
  if (amount !== null) {
    const price = `₩ ${amount.toLocaleString('ko-KR')}`;
    for (const selector of ['#hero-price', '#hero-judgement', '[data-c-citation-1]', '[data-c-about]']) {
      assert.ok(text(client, selector).includes(price), `${selector} must use the same contract amount`);
    }
    assert.equal(dataset(client).variableMeasured.find(value => value.name === 'display_krw').value, amount);
  }
}

function assertFailedButPreserved(client, before) {
  assert.deepEqual(priceSnapshot(client), before, 'failed refresh must retain the entire last good display contract');
  const status = client.document.getElementById('price-refresh-status');
  assert.equal(status.classList.contains('hidden'), false);
  assert.match(status.textContent, /재확인에 실패/);
  assert.doesNotMatch(status.textContent, new RegExp(PRIVATE_ERROR));
  assert.equal(client.timers.size, 0, 'completed request must release its deadline timer');
}

test('the real template renderer is syntactically valid and targets actual price elements', () => {
  new vm.Script(code);
  const client = startClient();
  for (const selector of priceSelectors) assert.ok(client.document.querySelector(selector), selector);
  assert.equal(client.fetchCalls.length, 1);
  assert.equal(client.fetchCalls[0].options.cache, 'no-cache');
  assert.equal([...client.timers.values()][0].delay, 6000);
});

test('HIGH at 235 KRW stays HIGH and uses distinct samples instead of raw row counts', async () => {
  const client = startClient();
  await client.succeed(fixture());
  assert.equal(text(client, '#hero-price'), '₩ 235');
  assert.equal(text(client, '[data-c-trust-label]'), '신뢰도 높음');
  assert.equal(text(client, '[data-c-trust-level]'), 'HIGH');
  assert.equal(client.document.querySelector('[data-c-trust-label]').getAttribute('data-level'), 'HIGH');
  assert.equal(text(client, '[data-c-samples]'), '최근 7일 관측 표본 10건 · 30일 22건');
  assert.doesNotMatch(JSON.stringify(priceSnapshot(client)), /999|998|표본 부족/);
  assert.equal(text(client, '[data-c-src-tcg]'), '$0.17 (raw)');
  assert.equal(text(client, '[data-c-updated-at]'), '2026.09.30');
  assertDescriptionsAgree(client, 235);
});

test('a successful refresh synchronizes the hero, explanation, metadata and Dataset', async () => {
  const client = startClient();
  await client.succeed(fixture({ amount: 777, usd: 0.56, d7: 11, d30: 23 }));
  assertDescriptionsAgree(client, 777);
  assert.doesNotMatch(JSON.stringify(priceSnapshot(client)), /₩ 235/);
  assert.equal(text(client, '[data-c-samples]'), '최근 7일 관측 표본 11건 · 30일 23건');
  assert.equal(client.document.getElementById('price-refresh-status').classList.contains('hidden'), true);
  assert.equal(client.timers.size, 0);
});

test('HIGH to NONE clears visible stale prices and removes only the price Dataset', async () => {
  const client = startClient();
  for (const [id, value] of [['hero-low', '최저 $0.15'], ['hero-high', '최고 $0.25'], ['live-price-panel', '₩ 235']]) {
    const node = client.document.getElementById(id);
    if (node) node.textContent = value;
  }
  await client.succeed(fixture({ level: 'NONE', amount: null, rawAmount: 235, d7: 2, d30: 3 }));
  assert.equal(text(client, '#hero-price'), '—');
  assert.equal(text(client, '[data-c-src-tcg]'), '—');
  assert.equal(text(client, '[data-c-trust-label]'), '참고가 산출 불가');
  assert.equal(text(client, '[data-c-trust-level]'), 'NONE');
  assert.equal(client.document.getElementById('trust-none-banner').classList.contains('hidden'), false);
  assert.equal(client.document.getElementById('hero-range-wrap').classList.contains('hidden'), true);
  assert.equal(text(client, '#hero-low'), '최저 —');
  assert.equal(text(client, '#hero-high'), '최고 —');
  assert.equal(text(client, '#live-price-panel'), '');
  assert.equal(schemas(client).filter(schema => schema['@type'] === 'Dataset').length, 0);
  assert.equal(schemas(client).filter(schema => schema['@type'] === 'WebPage').length, 1);
  assert.equal(schemas(client).filter(schema => schema['@type'] === 'BreadcrumbList').length, 1);
  assert.doesNotMatch(JSON.stringify(priceSnapshot(client)), /235|0\.17|신뢰도 높음/);
  assertDescriptionsAgree(client, null);
});

test('a reviewed Phanpy card refreshes its separate price explanation and comparison together', async () => {
  const client = startClient({
    card: REVIEWED_CARD, reviewed: true,
    ssr: fixture({ amount: 300, usd: 0.22, median7: 330 }),
  });
  assert.equal(client.document.querySelector('[data-c-reviewed-section]').attributes.has('hidden'), false);
  assert.match(text(client, '[data-c-reviewed-price]'), /₩300/);
  assert.match(text(client, '[data-c-reviewed-price]'), /10\.0% 높습니다/);
  await client.succeed(fixture({ amount: 600, usd: 0.43, median7: 600 }));
  assert.match(text(client, '[data-c-reviewed-price]'), /₩600/);
  assert.match(text(client, '[data-c-reviewed-price]'), /차이가 1% 미만/);
  assert.doesNotMatch(text(client, '[data-c-reviewed-price]'), /₩300|10\.0%/);
  assertDescriptionsAgree(client, 600);
  assert.equal(dataset(client).url, 'https://cardpick.kr/cards/phanpy-205');
});

test('a reviewed Phanpy card changing to NONE removes the old amount and comparison', async () => {
  const client = startClient({
    card: REVIEWED_CARD, reviewed: true,
    ssr: fixture({ amount: 300, usd: 0.22, median7: 330 }),
  });
  await client.succeed(fixture({ level: 'NONE', amount: null, rawAmount: 300, median7: 330 }));
  const reviewed = text(client, '[data-c-reviewed-price]');
  assert.equal(reviewed, '현재 신뢰할 수 있는 참고가가 없습니다. 가격 대신 카드 식별 정보를 확인하세요.');
  assert.doesNotMatch(reviewed, /₩|300|330|10\.0%/);
  assert.equal(text(client, '#hero-price'), '—');
  assert.equal(schemas(client).filter(schema => schema['@type'] === 'Dataset').length, 0);
  assertDescriptionsAgree(client, null);
});

for (const level of ['MEDIUM', 'LOW']) {
  test(`${level} displays the 30-day median without fabricating current USD or exchange rates`, async () => {
    const client = startClient();
    await client.succeed(fixture({ level, amount: 20000, rawAmount: 23456, usd: 17, d7: 3, d30: 12 }));
    assert.equal(text(client, '#hero-price'), '₩ 20,000');
    assert.equal(text(client, '#hero-price-label'), '최근 30일 중앙값 참고가');
    assert.match(text(client, '#hero-secondary'), /이상치를 제외한 최근 30일 중앙값/);
    assert.equal(text(client, '[data-c-src-tcg]'), '—');
    assert.equal(text(client, '#pricing-fx'), '별도 환율값 미제공');
    assert.doesNotMatch(text(client, '#hero-secondary'), /\$|1,381|1381|USD\/KRW/);
    assert.equal(dataset(client).variableMeasured.some(value => value.name === 'latest_usd'), false);
    assertDescriptionsAgree(client, 20000);
    if (level === 'LOW') assert.match(text(client, '[data-c-trust-label]'), /표본 부족/);
  });
}

test('HIGH with a mismatched source snapshot does not pair an unrelated USD price', async () => {
  const client = startClient();
  await client.succeed(fixture({ amount: 1000, rawAmount: 23456, usd: 17 }));
  assert.equal(text(client, '[data-c-src-tcg]'), '—');
  assert.doesNotMatch(text(client, '#hero-secondary'), /\$17/);
  assert.equal(dataset(client).variableMeasured.some(value => value.name === 'latest_usd'), false);
  assertDescriptionsAgree(client, 1000);
});

test('SSR can hydrate from best.price_display without a duplicate top-level object', async () => {
  const client = startClient({ useBestOnly: true });
  assertDescriptionsAgree(client, 235);
  const payload = fixture({ amount: 321 });
  delete payload.price_display;
  await client.succeed(payload);
  assertDescriptionsAgree(client, 321);
});

test('repeated identical hydration does not accumulate Dataset scripts', async () => {
  const client = startClient();
  assert.equal(schemas(client).filter(schema => schema['@type'] === 'Dataset').length, 1);
  await client.succeed(fixture());
  assert.equal(schemas(client).filter(schema => schema['@type'] === 'Dataset').length, 1);
  assert.equal(dataset(client).url, CARD_URL);
});

test('identical price refresh preserves SSR text nodes', async () => {
  const client = startClient();
  const selectors = ['#hero-price', '[data-c-h1-lede]', '#hero-judgement'];
  const counters = selectors.map(selector => {
    const el = client.document.querySelector(selector);
    let value = el.textContent, writes = 0;
    Object.defineProperty(el, 'textContent', { get: () => value, set: next => { value = next; writes++; } });
    return { selector, count: () => writes };
  });
  await client.succeed(fixture());
  for (const counter of counters) assert.equal(counter.count(), 0, counter.selector);
  assertDescriptionsAgree(client, 235);
});

test('Cardmarket is shown in original EUR without an assumed conversion rate', async () => {
  const client = startClient();
  const payload = fixture();
  payload.cardmarket = { ext_avg_24h: 3.5 };
  await client.succeed(payload);
  assert.equal(text(client, '[data-c-src-cm]'), '€3.50');
  assert.doesNotMatch(text(client, '[data-c-src-cm]'), /₩|1491|1,491/);
});

for (const status of [500, 503]) {
  test(`HTTP ${status} preserves SSR prices and schemas while showing refresh failure`, async () => {
    const client = startClient();
    const before = priceSnapshot(client);
    await client.succeed({ error: PRIVATE_ERROR }, status);
    assertFailedButPreserved(client, before);
  });
}

test('network rejection preserves SSR values and does not display private diagnostics', async () => {
  const client = startClient();
  const before = priceSnapshot(client);
  await client.fail();
  assertFailedButPreserved(client, before);
});

test('invalid response JSON preserves SSR values and reports failure', async () => {
  const client = startClient();
  const before = priceSnapshot(client);
  await client.invalidJson();
  assertFailedButPreserved(client, before);
});

test('the browser request deadline preserves SSR values when it aborts', async () => {
  const client = startClient();
  const before = priceSnapshot(client);
  await client.timeout();
  assert.equal(client.fetchCalls[0].options.signal.aborted, true);
  assertFailedButPreserved(client, before);
});

for (const [label, mutate] of [
  ['missing display', () => ({ best: null })],
  ['unrecognized basis', payload => ({ ...payload, price_display: { ...payload.price_display, basis: 'unverified' } })],
  ['missing display label', payload => ({ ...payload, price_display: { ...payload.price_display, label: null } })],
  ['available amount is null', payload => ({ ...payload, price_display: { ...payload.price_display, amountKrw: null } })],
  ['unavailable amount is non-null', payload => ({ ...payload, price_display: { ...payload.price_display, basis: 'unavailable' } })],
  ['missing source USD', payload => ({ ...payload, price_display: { ...payload.price_display, sourceUsd: undefined } })],
  ['string source USD', payload => ({ ...payload, price_display: { ...payload.price_display, sourceUsd: '0.56' } })],
  ['negative source USD', payload => ({ ...payload, price_display: { ...payload.price_display, sourceUsd: -1 } })],
  ['non-finite source USD', payload => ({ ...payload, price_display: { ...payload.price_display, sourceUsd: Infinity } })],
  ['missing source date', payload => ({ ...payload, price_display: { ...payload.price_display, sourceDate: undefined } })],
  ['numeric source date', payload => ({ ...payload, price_display: { ...payload.price_display, sourceDate: 12345 } })],
  ['invalid source date', payload => ({ ...payload, price_display: { ...payload.price_display, sourceDate: '2026-99-99T00:00:00Z' } })],
  ['source date lacks time', payload => ({ ...payload, price_display: { ...payload.price_display, sourceDate: '2026-09-30' } })],
  ['missing reviewed price text', payload => ({ ...payload, price_display: { ...payload.price_display, reviewedPriceText: undefined } })],
  ['null reviewed price text', payload => ({ ...payload, price_display: { ...payload.price_display, reviewedPriceText: null } })],
  ['numeric reviewed price text', payload => ({ ...payload, price_display: { ...payload.price_display, reviewedPriceText: 777 } })],
  ['object reviewed price text', payload => ({ ...payload, price_display: { ...payload.price_display, reviewedPriceText: { amount: 777 } } })],
  ['median incorrectly includes USD', () => {
    const payload = fixture({ level: 'MEDIUM', amount: 777, rawAmount: 999 });
    payload.price_display.sourceUsd = 0.56;
    return payload;
  }],
  ['unavailable price incorrectly includes USD', () => {
    const payload = fixture({ level: 'NONE', amount: null });
    payload.price_display.sourceUsd = 0.56;
    return payload;
  }],
]) {
  test(`invalid contract (${label}) is rejected before altering the last good display`, async () => {
    const client = startClient({ card: REVIEWED_CARD, reviewed: true });
    const before = priceSnapshot(client);
    await client.succeed(mutate(fixture({ amount: 777 })));
    assertFailedButPreserved(client, before);
  });
}

test('a successful API response can populate a page without an SSR price contract', async () => {
  const client = startClient({ ssr: null });
  await client.succeed(fixture());
  assertDescriptionsAgree(client, 235);
});

test('explicitly absent source USD and date do not generate replacement values', async () => {
  const client = startClient();
  const payload = fixture();
  payload.price_display.sourceUsd = null;
  payload.price_display.sourceDate = null;
  payload.price_display.secondaryText = 'TCGplayer 북미 기준 해외 참고가 · 국내 거래가와 다를 수 있습니다.';
  await client.succeed(payload);
  assert.equal(text(client, '[data-c-src-tcg]'), '—');
  assert.equal(text(client, '[data-c-updated-at]'), '—');
  assert.equal(dataset(client).dateModified, undefined);
  assert.equal(dataset(client).variableMeasured.some(value => value.name === 'latest_usd'), false);
  assertDescriptionsAgree(client, 235);
});

test('no card slug means no summary fetch and no added price Dataset', () => {
  const client = startClient({ ssr: null, withSlug: false });
  assert.equal(client.fetchCalls.length, 0);
  assert.equal(client.timers.size, 0);
  assert.equal(schemas(client).filter(schema => schema['@type'] === 'Dataset').length, 0);
});
