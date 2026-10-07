#!/usr/bin/env node
// Run with: node --experimental-vm-modules --test scripts/test-search-dropdown.mjs
// Execute the actual classic search IIFE and actual dynamically imported policy.
// Provider requests, timers, DOM and logs below are isolated test fixtures only.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const source = readFileSync(new URL('../search.js', import.meta.url), 'utf8');
const helperUrl = new URL('../search-query.mjs', import.meta.url);
const turn = () => new Promise(resolve => setImmediate(resolve));
async function settle() { for (let i = 0; i < 8; i++) await turn(); }
async function until(predicate, message) {
  const deadline = Date.now() + 1500;
  while (!predicate()) {
    if (Date.now() > deadline) assert.fail(message);
    await new Promise(resolve => setTimeout(resolve, 1));
  }
}

class Element {
  constructor(id) { this.id = id; this.style = { display: 'none' }; this.innerHTML = ''; this.value = ''; this.attributes = new Map(); this.listeners = new Map(); }
  setAttribute(key, value) { this.attributes.set(key, String(value)); }
  getAttribute(key) { return this.attributes.get(key) ?? null; }
  addEventListener(name, callback) {
    if (!this.listeners.has(name)) this.listeners.set(name, []);
    this.listeners.get(name).push(callback);
  }
  fire(name, extra = {}) { for (const callback of this.listeners.get(name) || []) callback({ target: this, preventDefault() {}, ...extra }); }
  closest() { return this.bar; }
  blur() { this.blurCount = (this.blurCount || 0) + 1; }
  focus() { this.fire('focus'); }
  querySelector(selector) {
    assert.equal(selector, 'a');
    const match = this.innerHTML.match(/<a\b[^>]*href="([^"]+)"/);
    return match ? { href: match[1] } : null;
  }
}

function harness(hostname = 'localhost') {
  const input = new Element('cp-search'), box = new Element('cp-search-results');
  const bar = { contains: node => node === input || node === box || node === bar };
  input.bar = bar;
  const docListeners = new Map();
  const document = {
    readyState: 'complete',
    getElementById: id => id === input.id ? input : id === box.id ? box : null,
    addEventListener: (name, callback) => {
      if (!docListeners.has(name)) docListeners.set(name, []);
      docListeners.get(name).push(callback);
    },
  };
  let now = 0, nextTimer = 0;
  const timers = new Map();
  function tick(milliseconds) {
    now += milliseconds;
    while (true) {
      const due = [...timers].filter(([, timer]) => timer.at <= now).sort((a, b) => a[1].at - b[1].at)[0];
      if (!due) break;
      timers.delete(due[0]); due[1].callback();
    }
  }
  const requests = [];
  class Query {
    constructor(table) { this.table = table; this.filters = []; this.settled = false; }
    select(fields, options = {}) { this.fields = fields; this.options = options; return this; }
    eq(field, value) { this.filters.push({ kind: 'eq', field, value }); return this; }
    ilike(field, value) { this.filters.push({ kind: 'ilike', field, value }); return this; }
    in(field, values) { this.filters.push({ kind: 'in', field, values: [...values] }); return this; }
    limit(value) { this.limitValue = value; return this; }
    abortSignal(signal) { this.signal = signal; return this; }
    then(resolve, reject) {
      if (!this.promise) {
        // Store a plain request record, not this thenable builder. Returning a
        // builder from an async fixture helper would await the controlled query.
        const request = {
          table: this.table, fields: this.fields, options: this.options,
          filters: this.filters, limitValue: this.limitValue, signal: this.signal,
          index: requests.length, settled: false,
        };
        this.promise = new Promise((fulfill, fail) => {
          request.resolve = value => { request.settled = true; fulfill(value); };
          request.reject = error => { request.settled = true; fail(error); };
        });
        requests.push(request);
      }
      // Intentionally ignore cancellation here: late responses must also be
      // rejected by the real generation guard, even when an upstream ignores abort.
      return this.promise.then(resolve, reject);
    }
  }
  const client = { from: table => new Query(table) };
  const posts = [], imports = [];
  const location = { hostname, pathname: '/', href: '' };
  const context = {
    window: { cardpickAuth: { getClient: () => client }, location }, document, location,
    AbortController, Promise,
    setTimeout: (callback, delay) => { timers.set(++nextTimer, { callback, at: now + delay, delay }); return nextTimer; },
    clearTimeout: id => timers.delete(id),
    fetch: async (url, options) => {
      assert.equal(url, '/api/search-log', 'only the isolated log stub may be fetched');
      posts.push({ url, options, body: JSON.parse(options.body) });
      return { ok: true };
    },
    console: { warn() {}, error() {} },
  };
  vm.createContext(context);
  new vm.Script(source, {
    filename: 'search.js',
    importModuleDynamically: async specifier => {
      assert.match(specifier, /^\/search-query\.mjs(?:\?v=\d+)?$/);
      imports.push(specifier);
      return import(helperUrl.href);
    },
  }).runInContext(context);
  function type(query) { input.value = query; input.fire('input'); }
  function outsideClick() { for (const callback of docListeners.get('click') || []) callback({ target: {} }); }
  function resolveCounts(start = 0) {
    requests.slice(start).filter(request => request.table === 'cards' && request.options.head && !request.settled)
      .forEach(request => request.resolve({ data: null, count: 1, error: null }));
  }
  async function start(query) {
    const first = requests.length;
    type(query); tick(200);
    await until(() => {
      resolveCounts(first);
      return requests.slice(first).some(request => request.table === 'cards' && !request.options.head);
    }, `card request must start for ${query}`);
    return requests.slice(first).find(request => request.table === 'cards' && !request.options.head);
  }
  async function trustFor(cardRequest, cards) {
    cardRequest.resolve({ data: cards.map(card => ({ ...card })), error: null });
    await until(() => requests.slice(cardRequest.index + 1).some(request => request.table === 'card_price_trust' && !request.settled), 'trust join must start');
    return requests.slice(cardRequest.index + 1).find(request => request.table === 'card_price_trust' && !request.settled);
  }
  async function complete(cardRequest, cards, trust = []) {
    const query = await trustFor(cardRequest, cards);
    query.resolve({ data: trust, error: null });
    await until(() => box.innerHTML.includes(cards[0].name), 'card results must finish rendering');
    await settle();
    return query;
  }
  async function releaseLate(cardRequest, cards) {
    cardRequest.resolve({ data: cards.map(card => ({ ...card })), error: null });
    await settle();
    requests.filter(request => request.table === 'card_price_trust' && !request.settled)
      .forEach(request => request.resolve({ data: [], error: null }));
    await settle();
  }
  return { input, box, requests, posts, imports, timers, type, tick, start, trustFor, complete, releaseLate, outsideClick, location };
}

function card(slug = 'test-card', name = 'Fixture card') {
  return { slug, name, name_en: name, name_ko: '', game: 'pokemon', set_name: 'Fixture Set', number: '1', rarity_class: 'SAR', popularity_rank: 1, price_krw: 99999 };
}
const trusted = (slug, level = 'HIGH', price = 1250) => ({ card_slug: slug, trust_level: level, display_krw: price });
const tokenFilters = request => request.filters.filter(filter => filter.kind === 'ilike').map(filter => filter.value);

test('startup leaves the shared query module unloaded until a search is requested', () => {
  const page = harness();
  assert.deepEqual(page.imports, []);
  assert.deepEqual(page.requests, []);
  assert.equal(page.input.getAttribute('aria-expanded'), 'false');
  assert.equal(page.box.getAttribute('aria-live'), 'polite');
});

for (const [input, tokens] of [['에브이', ['%espeon%']], ['뮤츠 ex', ['%mewtwo%', '%ex%']], ['메가리자몽 ex', ['%mega%', '%charizard%', '%ex%']]]) {
  test(`actual dynamic alias policy filters ${input} with the intended longest name`, async () => {
    const page = harness();
    const request = await page.start(input);
    assert.deepEqual(tokenFilters(request), tokens);
    assert.equal(page.imports.length, 1);
    assert.ok(request.signal instanceof AbortSignal);
    await page.complete(request, [card()], [trusted('test-card')]);
    assert.ok(page.box.innerHTML.includes('₩ 1,250'));
  });
}

test('one-character 뮤 is searchable while unrelated one-character inputs stay closed', async () => {
  const page = harness();
  page.type('가'); page.tick(200); await settle();
  assert.equal(page.requests.length, 0);
  assert.equal(page.box.style.display, 'none');
  const request = await page.start('뮤');
  assert.deepEqual(tokenFilters(request), ['%mew%']);
  await page.complete(request, [card('mew-fixture', 'Mew')], []);
  assert.ok(page.box.innerHTML.includes('/cards/mew-fixture'));
});

test('late card response A cannot replace successful newer query B even if abort is ignored', async () => {
  const page = harness('cardpick.kr');
  const first = await page.start('alpha');
  const second = await page.start('beta');
  assert.equal(first.signal.aborted, true);
  await page.complete(second, [card('beta-fixture', 'Beta result')], [trusted('beta-fixture')]);
  const successful = page.box.innerHTML;
  await page.releaseLate(first, [card('alpha-fixture', 'Alpha stale result')]);
  assert.equal(page.box.innerHTML, successful);
  assert.equal(page.posts.length, 1);
  assert.equal(page.posts[0].body.query, 'beta');
});

test('late trust response A cannot replace B after A has already finished card lookup', async () => {
  const page = harness();
  const first = await page.start('alpha');
  const firstTrust = await page.trustFor(first, [card('alpha-fixture', 'Alpha stale result')]);
  const second = await page.start('beta');
  assert.equal(firstTrust.signal.aborted, true);
  await page.complete(second, [card('beta-fixture', 'Beta result')], [trusted('beta-fixture')]);
  const successful = page.box.innerHTML;
  firstTrust.resolve({ data: [trusted('alpha-fixture')], error: null });
  await settle();
  assert.equal(page.box.innerHTML, successful);
});

test('clearing input cancels both the debounce and an already running result', async () => {
  const page = harness();
  page.type('alpha'); page.type(''); page.tick(200); await settle();
  assert.equal(page.requests.length, 0);
  const pending = await page.start('alpha');
  page.type('');
  assert.equal(pending.signal.aborted, true);
  await page.releaseLate(pending, [card('alpha-fixture', 'Alpha stale result')]);
  assert.equal(page.box.style.display, 'none');
  assert.equal(page.box.innerHTML, '');
  assert.equal(page.input.getAttribute('aria-expanded'), 'false');
});

for (const [name, close] of [['Escape', page => page.input.fire('keydown', { key: 'Escape' })], ['outside click', page => page.outsideClick()]]) {
  test(`${name} invalidates pending debounce and in-flight results`, async () => {
    const page = harness();
    page.type('alpha'); close(page); page.tick(200); await settle();
    assert.equal(page.requests.length, 0);
    const pending = await page.start('alpha');
    close(page);
    assert.equal(pending.signal.aborted, true);
    await page.releaseLate(pending, [card('alpha-fixture', 'Alpha stale result')]);
    assert.equal(page.box.style.display, 'none');
    assert.equal(page.box.innerHTML, '');
    if (name === 'Escape') assert.equal(page.input.blurCount, 2);
  });
}

test('refocusing the same query after closing reopens and reruns the search', async () => {
  const page = harness();
  await page.complete(await page.start('alpha'), [card('first-fixture', 'First result')], []);
  page.input.fire('keydown', { key: 'Escape' });
  page.input.focus(); page.tick(200);
  await until(() => page.requests.filter(request => request.table === 'cards' && !request.options.head).length === 2, 'same-query focus must start another lookup');
  page.requests.filter(request => request.table === 'cards' && request.options.head && !request.settled)
    .forEach(request => request.resolve({ count: 1, error: null }));
  const second = page.requests.filter(request => request.table === 'cards' && !request.options.head)[1];
  await page.complete(second, [card('second-fixture', 'Refocused result')], []);
  assert.equal(page.box.style.display, 'block');
  assert.ok(page.box.innerHTML.includes('Refocused result'));
});

for (const mode of ['error response', 'rejected request']) {
  test(`card ${mode} replaces loading with a public error message`, async () => {
    const page = harness();
    const request = await page.start('alpha');
    if (mode === 'error response') request.resolve({ data: null, error: { message: 'PRIVATE_TEST_ERROR' } });
    else request.reject(new Error('PRIVATE_TEST_ERROR'));
    await until(() => page.box.innerHTML.includes('다시 시도'), 'failed lookup must finish loading');
    assert.doesNotMatch(page.box.innerHTML, /검색 중|PRIVATE_TEST_ERROR/);
    assert.equal(page.box.style.display, 'block');
    assert.equal(page.posts.length, 0);
    assert.equal(page.requests.filter(query => query.table === 'card_price_trust').length, 0);
  });
}

test('missing, unknown, NONE, nonfinite, zero and negative trust values never expose raw card prices', async () => {
  const rows = [
    [], [trusted('test-card', 'UNKNOWN')], [trusted('test-card', 'NONE')],
    [trusted('test-card', 'HIGH', Infinity)], [trusted('test-card', 'HIGH', 'not-a-number')],
    [trusted('test-card', 'HIGH', -1250)], [trusted('test-card', 'HIGH', 0)],
  ];
  for (const trust of rows) {
    const page = harness();
    await page.complete(await page.start('fixture'), [card()], trust);
    assert.match(page.box.innerHTML, /참고가 산출 불가/);
    assert.doesNotMatch(page.box.innerHTML, /₩|99,999|Infinity|not-a-number/);
    assert.deepEqual([...new Set(page.requests.map(request => request.table))], ['cards', 'card_price_trust']);
  }
});

test('valid HIGH/MEDIUM/LOW prices come exclusively from the trust join with a LOW warning', async () => {
  const page = harness();
  const cards = [card('high-fixture', 'High fixture'), card('medium-fixture', 'Medium fixture'), card('low-fixture', 'Low fixture')];
  await page.complete(await page.start('fixture'), cards, [trusted('high-fixture', 'HIGH', 1250), trusted('medium-fixture', 'MEDIUM', '2500'), trusted('low-fixture', 'LOW', 3750)]);
  assert.match(page.box.innerHTML, /₩ 1,250/);
  assert.match(page.box.innerHTML, /₩ 2,500/);
  assert.match(page.box.innerHTML, /₩ 3,750/);
  assert.match(page.box.innerHTML, /표본 부족/);
  assert.doesNotMatch(page.box.innerHTML, /99,999/);
});

test('trust query failure still renders cards without raw prices or a production search log', async () => {
  const page = harness('cardpick.kr');
  const request = await page.start('fixture');
  const trust = await page.trustFor(request, [card()]);
  trust.resolve({ data: null, error: { message: 'PRIVATE_TRUST_ERROR' } });
  await until(() => page.box.innerHTML.includes('Fixture card'), 'partial search must render cards');
  assert.match(page.box.innerHTML, /가격 정보를 불러오지 못했습니다/);
  assert.doesNotMatch(page.box.innerHTML, /₩|99,999|PRIVATE_TRUST_ERROR|검색 중/);
  assert.equal(page.posts.length, 0);
});

for (const hostname of ['localhost', '127.0.0.1', '[::1]']) {
  test(`${hostname} never sends a production search-log POST`, async () => {
    const page = harness(hostname);
    await page.complete(await page.start('뮤츠 ex'), [card('mewtwo-fixture', 'Mewtwo ex')], [trusted('mewtwo-fixture')]);
    assert.equal(page.posts.length, 0);
  });
}

test('production logs the original query rather than its translated alias', async () => {
  const page = harness('cardpick.kr');
  await page.complete(await page.start('뮤츠 ex'), [card('mewtwo-fixture', 'Mewtwo ex')], [trusted('mewtwo-fixture')]);
  assert.equal(page.posts.length, 1);
  assert.equal(page.posts[0].options.method, 'POST');
  assert.deepEqual(page.posts[0].body, { query: '뮤츠 ex', game: 'pokemon', result_count: 1, has_price: true, matched_slug: 'mewtwo-fixture' });
});

test('IME composition cancels debounce and ignores intermediate input events', async () => {
  const page = harness();
  page.type('alpha');
  page.input.fire('compositionstart');
  page.input.value = '뮤';
  page.input.fire('input', { isComposing: true });
  page.input.value = '뮤츠';
  page.input.fire('input'); // Some engines omit isComposing on intermediate events.
  page.tick(400);
  await settle();
  assert.equal(page.requests.length, 0);
  assert.equal(page.imports.length, 0);
  assert.equal(page.box.style.display, 'none');
  assert.equal(page.input.getAttribute('aria-expanded'), 'false');
});

test('an isComposing input event is ignored even without a preceding compositionstart', async () => {
  const page = harness();
  page.input.value = '뮤츠';
  page.input.fire('input', { isComposing: true });
  page.tick(400);
  await settle();
  assert.equal(page.requests.length, 0);
  assert.equal(page.imports.length, 0);
});

for (const [name, prepare, event] of [
  ['active composition', page => page.input.fire('compositionstart'), {}],
  ['isComposing', () => {}, { isComposing: true }],
  ['legacy keyCode 229', () => {}, { keyCode: 229 }],
]) {
  test(`IME Enter with ${name} neither navigates nor prevents composition completion`, () => {
    const page = harness();
    page.input.value = '뮤츠';
    page.box.innerHTML = '<a href="/cards/should-not-open">Fixture result</a>';
    page.location.href = '/unchanged';
    prepare(page);
    let prevented = false;
    page.input.fire('keydown', { key: 'Enter', ...event, preventDefault: () => { prevented = true; } });
    assert.equal(page.location.href, '/unchanged');
    assert.equal(prevented, false);
    assert.equal(page.requests.length, 0);
  });
}

test('compositionend plus the final browser input event starts exactly one real search', async () => {
  const page = harness();
  page.input.fire('compositionstart');
  page.input.value = '뮤';
  page.input.fire('input', { isComposing: true });
  page.input.value = '뮤츠 ex';
  page.input.fire('compositionend');
  page.input.fire('input', { isComposing: false });
  page.tick(200);
  await until(() => page.requests.some(request => request.table === 'cards' && !request.options.head), 'committed IME text must start a search');
  page.requests.filter(request => request.table === 'cards' && request.options.head)
    .forEach(request => request.resolve({ count: 1, error: null }));
  const request = page.requests.find(request => request.table === 'cards' && !request.options.head);
  assert.deepEqual(tokenFilters(request), ['%mewtwo%', '%ex%']);
  await page.complete(request, [card('ime-fixture', 'Mewtwo ex')], [trusted('ime-fixture')]);
  page.tick(400);
  await settle();
  assert.equal(page.requests.filter(query => query.table === 'cards' && !query.options.head).length, 1);
  assert.equal(page.requests.filter(query => query.table === 'cards' && query.options.head).length, 1);
  assert.equal(page.imports.length, 1);
});

test('compositionstart invalidates an already running request before late responses can reopen results', async () => {
  const page = harness();
  const pending = await page.start('alpha');
  page.input.fire('compositionstart');
  assert.equal(pending.signal.aborted, true);
  page.input.value = '뮤츠';
  page.input.fire('input', { isComposing: true });
  await page.releaseLate(pending, [card('stale-fixture', 'Stale pre-composition result')]);
  assert.equal(page.box.style.display, 'none');
  assert.equal(page.box.innerHTML, '');
  assert.equal(page.requests.filter(query => query.table === 'cards' && !query.options.head).length, 1);
});

test('ordinary Enter still selects the first completed card result', async () => {
  const page = harness();
  await page.complete(await page.start('fixture'), [card('enter-fixture', 'Enter fixture')], []);
  let prevented = false;
  page.input.fire('keydown', { key: 'Enter', preventDefault: () => { prevented = true; } });
  assert.equal(prevented, true);
  assert.equal(page.location.href, '/cards/enter-fixture');
});

test('ordinary Enter without a card result still opens the full search with the original input', () => {
  const page = harness();
  page.input.value = '  뮤츠 ex  ';
  let prevented = false;
  page.input.fire('keydown', { key: 'Enter', preventDefault: () => { prevented = true; } });
  assert.equal(prevented, true);
  assert.equal(page.location.href, '/search?q=' + encodeURIComponent('뮤츠 ex'));
});
