#!/usr/bin/env node
// Run with: node --experimental-vm-modules --test scripts/test-search-dropdown.mjs
// Execute the actual classic search IIFE and actual dynamically imported policy.
// Provider requests, timers, DOM and logs below are isolated test fixtures only.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { onRequest } from '../functions/search.js';

const source = readFileSync(new URL('../search.js', import.meta.url), 'utf8');
const helperUrl = new URL('../search-identity.mjs', import.meta.url);
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
  constructor(id, tag = 'div') { this.id = id; this.tag = tag; this.style = { display: 'none' }; this.children = []; this.innerHTML = ''; this.value = ''; this.attributes = new Map(); this.attributeWrites = []; this.listeners = new Map(); }
  set innerHTML(value) { this.markup = String(value); this.children = []; this.ownText = ''; }
  get innerHTML() { return this.markup + escapeMarkup(this.ownText) + this.children.map(child => child.outerHTML).join(''); }
  set textContent(value) { this.innerHTML = ''; this.ownText = String(value); }
  get textContent() { return this.ownText + this.children.map(child => child.textContent).join(''); }
  get outerHTML() { return '<' + this.tag + [...this.attributes].map(([key, value]) => ' ' + key + '="' + escapeMarkup(value) + '"').join('') + '>' + this.innerHTML + '</' + this.tag + '>'; }
  appendChild(node) { this.children.push(node); node.parentElement = this; return node; }
  setAttribute(key, value) { this.attributes.set(key, String(value)); this.attributeWrites.push([key, String(value)]); }
  getAttribute(key) { return this.attributes.get(key) ?? null; }
  addEventListener(name, callback) {
    if (!this.listeners.has(name)) this.listeners.set(name, []);
    this.listeners.get(name).push(callback);
  }
  fire(name, extra = {}) { for (const callback of this.listeners.get(name) || []) callback({ target: this, preventDefault() {}, ...extra }); }
  closest() { return this.bar; }
  blur() { this.blurCount = (this.blurCount || 0) + 1; }
  focus() { this.fire('focus'); }
  contains(node) { return node === this || node?.ownerBox === this || this.children.some(child => child.contains(node)); }
  querySelectorAll(selector) {
    assert.equal(selector, 'a');
    return this.children.flatMap(child => [...(child.tag === 'a' ? [child] : []), ...child.querySelectorAll(selector)]);
  }
  querySelector(selector) {
    assert.equal(selector, 'a');
    const child = this.querySelectorAll(selector)[0];
    if (child) return child;
    const match = this.innerHTML.match(/<a\b[^>]*href="([^"]+)"/);
    return match ? { href: match[1] } : null;
  }
}

function escapeMarkup(value = '') {
  return String(value).replace(/[&<>"']/g, char => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' })[char]);
}

function harness(hostname = 'localhost', options = {}) {
  const input = new Element('cp-search');
  let box = new Element('cp-search-results');
  let inputPresent = !options.generatedInput, boxPresent = !options.generatedInput;
  input.value = options.value || '';
  const bar = {
    style: {},
    contains: node => node === input || node === box || node === bar || box.contains(node),
    set innerHTML(markup) {
      const inputMarkup = markup.match(/<input\b[^>]*id="cp-search"[^>]*>/);
      assert.ok(inputMarkup, 'execute the actual shared input creation markup');
      for (const [, name, value] of inputMarkup[0].matchAll(/([\w-]+)="([^"]*)"/g)) input.setAttribute(name, value);
      inputPresent = true;
    },
    appendChild(node) { assert.equal(node.id, 'cp-search-results'); box = node; boxPresent = true; },
  };
  input.bar = bar;
  const docListeners = new Map();
  const document = {
    readyState: 'complete',
    head: { appendChild() {} },
    createElement: tag => new Element('', tag),
    getElementById: id => id === input.id && inputPresent ? input : id === box.id && boxPresent ? box : null,
    querySelector: selector => { assert.equal(selector, '.cp-search, .search'); return bar; },
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
    window: { cardpickAuth: options.sdkMissing ? undefined : { getClient: () => client }, location }, document, location,
    getComputedStyle: element => { assert.strictEqual(element, bar); return { position: 'static' }; },
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
      assert.match(specifier, /^\/search-identity\.mjs(?:\?v=\d+)?$/);
      imports.push(specifier);
      if (options.policyGate) await options.policyGate;
      return import(helperUrl.href);
    },
  }).runInContext(context);
  function type(query) { input.value = query; input.fire('input'); }
  function outsideClick() { for (const callback of docListeners.get('click') || []) callback({ target: {} }); }
  function docEvent(name, extra = {}) {
    for (const callback of docListeners.get(name) || []) callback({ target: {}, preventDefault() {}, ...extra });
  }
  function readyClient() { context.window.cardpickAuth = { getClient: () => client }; }
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
  return { input, box, requests, posts, imports, timers, type, tick, start, trustFor, complete, releaseLate, outsideClick, location, docEvent, readyClient };
}

function card(slug = 'test-card', name = 'Fixture card') {
  return { slug, name, name_en: name, name_ko: '', game: 'pokemon', set_name: 'Fixture Set', number: '1', rarity_class: 'SAR', popularity_rank: 1, price_krw: 99999 };
}
const trusted = (slug, level = 'HIGH', price = 1250) => ({ card_slug: slug, trust_level: level, display_krw: price });
const tokenFilters = request => request.filters.filter(filter => filter.kind === 'ilike').map(filter => filter.value);

function assertSearchSemantics(page, display) {
  assert.equal(page.input.getAttribute('aria-label'), '카드명 검색');
  assert.equal(page.input.getAttribute('aria-controls'), page.box.id);
  assert.equal(page.input.getAttribute('aria-expanded'), null, 'native search input does not support expanded');
  assert.equal(page.input.getAttribute('role'), null, 'link navigation must not pretend to be a combobox');
  assert.equal(page.input.getAttribute('aria-activedescendant'), null);
  assert.equal(page.box.getAttribute('role'), 'region');
  assert.equal(page.box.getAttribute('aria-label'), '카드 검색 결과');
  assert.equal(page.box.getAttribute('aria-live'), 'polite');
  assert.deepEqual(page.input.attributeWrites.filter(([name]) => name === 'aria-expanded'), [], 'expanded is never transiently written');
  assert.doesNotMatch(page.box.innerHTML, /role=["'](?:listbox|option)["']/);
  if (display) assert.equal(page.box.style.display, display);
}

test('startup leaves the shared query module unloaded until a search is requested', () => {
  const page = harness();
  assert.deepEqual(page.imports, []);
  assert.deepEqual(page.requests, []);
  assertSearchSemantics(page, 'none');
});

for (const generatedInput of [false, true]) {
  test(`${generatedInput ? 'generated' : 'existing'} search input keeps a named link-results region through loading, success and Escape`, async () => {
    const page = harness('localhost', { generatedInput });
    assertSearchSemantics(page, 'none');
    if (generatedInput) assert.equal(page.input.getAttribute('type'), 'search');
    const request = await page.start('fixture');
    assert.match(page.box.innerHTML, /검색 중/);
    assertSearchSemantics(page, 'block');
    await page.complete(request, [card('region-fixture', 'Region fixture')], []);
    assert.match(page.box.innerHTML, /<a href="\/cards\/region-fixture"/);
    assertSearchSemantics(page, 'block');
    const resultLink = { ownerBox: page.box };
    page.docEvent('focusin', { target: resultLink });
    assertSearchSemantics(page, 'block');
    const reads = page.requests.length;
    page.docEvent('keydown', { key: 'Escape', target: resultLink });
    assertSearchSemantics(page, 'none');
    page.tick(200); await settle();
    assert.equal(page.requests.length, reads, 'closing restores focus without another lookup');
    assert.equal(page.posts.length, 0);
  });
}

test('early input and Enter work before the SDK exists, including readiness beyond the old five-second limit', async () => {
  const page = harness('localhost', { sdkMissing:true });
  page.type('블래키 PRE 161'); page.tick(200); await settle();
  assert.match(page.box.innerHTML, /검색 중/);
  assert.equal(page.requests.length, 0);
  page.tick(5100); await settle();
  page.readyClient(); page.tick(100); await settle();
  assert.equal(page.requests.length, 2);
  const request = page.requests.find(row => !row.options.head);
  page.requests.find(row => row.options.head).resolve({ count:1 });
  await page.complete(request, [card()], []);
  assertSearchSemantics(page, 'block');
  const noSdk = harness('localhost', { sdkMissing:true });
  noSdk.input.value = ' 블래키 PRE 161 ';
  noSdk.input.fire('keydown', { key:'Enter' });
  assert.equal(noSdk.location.href, '/search?q=' + encodeURIComponent('블래키 PRE 161'));
  assert.equal(noSdk.requests.length, 0);
});

test('only the latest committed IME input is searched when the SDK becomes ready', async () => {
  const page = harness('localhost', { sdkMissing:true });
  page.type('alpha'); page.tick(200); await settle();
  page.input.fire('compositionstart');
  page.input.value = '블래키'; page.input.fire('input', { isComposing:true });
  page.readyClient(); page.tick(1000); await settle();
  assert.equal(page.requests.length, 0);
  page.input.fire('compositionend'); page.tick(200); await settle();
  assert.equal(page.requests.length, 2);
  assert.deepEqual(tokenFilters(page.requests.find(row => !row.options.head)), ['%umbreon%']);
});

test('an isComposing input cancels an older request even if compositionstart was missed', async () => {
  const page = harness(); const request = await page.start('alpha');
  page.input.value = '블래'; page.input.fire('input', { isComposing:true });
  assert.equal(request.signal.aborted, true); assert.equal(page.box.style.display, 'none');
  await page.releaseLate(request, [card()]);
  assert.equal(page.box.style.display, 'none');
  page.input.value = '블래키'; page.input.fire('compositionend'); page.tick(200); await settle();
  const latest = page.requests.filter(row => row.table === 'cards' && !row.options.head).at(-1);
  assert.deepEqual(tokenFilters(latest), ['%umbreon%']);
});

test('a policy module that never resolves reaches the same deadline without issuing queries', async () => {
  const page = harness('cardpick.kr', { policyGate:new Promise(() => {}) });
  page.type('alpha'); page.tick(200); await settle();
  page.tick(6000); await settle();
  assert.match(page.box.innerHTML, /불러오지 못했습니다/);
  assert.equal(page.requests.length, 0); assert.equal(page.posts.length, 0);
  page.input.fire('focus'); page.tick(200); await settle();
  assert.equal(page.imports.length, 2, 'a user retry is allowed after timeout, never an automatic retry');
});

test('an unavailable SDK times out and a later user retry recovers without a page reload', async () => {
  const page = harness('localhost', { sdkMissing:true });
  page.type('alpha'); page.tick(200); await settle();
  page.tick(6000); await settle();
  assert.match(page.box.innerHTML, /불러오지 못했습니다/);
  assert.equal(page.requests.length, 0);
  page.readyClient();
  const request = await page.start('alpha');
  await page.complete(request, [card()], []);
  assertSearchSemantics(page, 'block');
});

test('the deadline bounds ignored provider aborts and late replies cannot replace its error or write a log', async () => {
  const page = harness('cardpick.kr');
  const request = await page.start('alpha');
  page.tick(6000); await settle();
  assert.equal(request.signal.aborted, true);
  assert.match(page.box.innerHTML, /불러오지 못했습니다/);
  const error = page.box.innerHTML;
  await page.releaseLate(request, [card()]);
  assert.equal(page.box.innerHTML, error); assert.equal(page.posts.length, 0);
});

test('SDK and policy waits share one budget with trust, rather than restarting each stage', async () => {
  const page = harness('cardpick.kr', { sdkMissing:true });
  page.type('alpha'); page.tick(200); await settle();
  page.tick(4000); await settle(); page.readyClient(); page.tick(100); await settle();
  page.requests.find(row => row.options.head).resolve({ count:1 });
  const request = page.requests.find(row => !row.options.head);
  const trust = await page.trustFor(request, [card()]);
  page.tick(1900); await settle();
  assert.match(page.box.innerHTML, /불러오지 못했습니다/);
  trust.resolve({ data:[trusted('test-card')] }); await settle();
  assert.match(page.box.innerHTML, /불러오지 못했습니다/); assert.equal(page.posts.length, 0);
});

test('Tab outside closes and cancels, while dropdown focus remains usable and Escape restores the input', async () => {
  const page = harness();
  const request = await page.start('alpha');
  page.docEvent('focusin');
  assert.equal(request.signal.aborted, true); assert.equal(page.box.style.display, 'none');
  const next = await page.start('beta'); await page.complete(next, [card()], []);
  const resultLink = { ownerBox:page.box };
  page.docEvent('focusin', { target:resultLink });
  assert.equal(page.box.style.display, 'block');
  page.docEvent('keydown', { key:'Escape', target:resultLink });
  assert.equal(page.box.style.display, 'none');
  page.tick(200); await settle();
  assert.equal(page.requests.filter(row => row.table === 'cards' && !row.options.head).length, 2, 'restoring focus must not reopen or start a new query');
});

test('prefilled early text is processed once without waiting for another input event', async () => {
  const page = harness('localhost', { value:'블래키', sdkMissing:true });
  page.tick(200); await settle(); page.readyClient(); page.tick(100); await settle();
  assert.equal(page.requests.length, 2);
  assert.deepEqual(tokenFilters(page.requests.find(row => !row.options.head)), ['%umbreon%']);
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
  assertSearchSemantics(page, 'none');
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
  assertSearchSemantics(page, 'none');
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

test('ordinary Enter opens full search instead of choosing the first completed card result', async () => {
  const page = harness();
  await page.complete(await page.start('fixture'), [card('enter-fixture', 'Enter fixture')], []);
  let prevented = false;
  page.input.fire('keydown', { key: 'Enter', preventDefault: () => { prevented = true; } });
  assert.equal(prevented, true);
  assert.equal(page.location.href, '/search?q=fixture');
  assert.equal(page.box.style.display, 'none');
});

test('ordinary Enter without a card result still opens the full search with the original input', () => {
  const page = harness();
  page.input.value = '  뮤츠 ex  ';
  let prevented = false;
  page.input.fire('keydown', { key: 'Enter', preventDefault: () => { prevented = true; } });
  assert.equal(prevented, true);
  assert.equal(page.location.href, '/search?q=' + encodeURIComponent('뮤츠 ex'));
});

test('Enter preserves the current Korean query with multiple clickable card candidates', async () => {
  const page = harness();
  await page.complete(await page.start('블래키 PRE 161'), [
    card('first-fixture', 'Umbreon ex'), card('second-fixture', 'Umbreon ex')
  ], []);
  assert.match(page.box.innerHTML, /href="\/cards\/first-fixture"/);
  assert.match(page.box.innerHTML, /href="\/cards\/second-fixture"/);
  assert.match(page.box.innerHTML, />검색 결과 보기<\/a>/);
  assert.doesNotMatch(page.box.innerHTML, /검색 결과 전체 보기/);
  page.input.fire('keydown', { key: 'Enter' });
  assert.equal(page.location.href, '/search?q=' + encodeURIComponent('블래키 PRE 161'));
  assert.equal(page.posts.length, 0);
});

test('Enter during debounce opens the current query without starting another provider request', async () => {
  const page = harness();
  page.type('  뮤츠 ex  ');
  page.input.fire('keydown', { key: 'Enter' });
  page.tick(200);
  await settle();
  assert.equal(page.location.href, '/search?q=' + encodeURIComponent('뮤츠 ex'));
  assert.equal(page.requests.length, 0);
  assert.equal(page.posts.length, 0);
});

test('Enter cancels a pending read and late results cannot reopen the dropdown', async () => {
  const page = harness();
  const pending = await page.start('alpha');
  page.input.value = '  블래키 PRE 161  ';
  page.input.fire('keydown', { key: 'Enter' });
  assert.equal(pending.signal.aborted, true);
  await page.releaseLate(pending, [card('late-fixture', 'Late result')]);
  assert.equal(page.location.href, '/search?q=' + encodeURIComponent('블래키 PRE 161'));
  assert.equal(page.box.style.display, 'none');
  assert.equal(page.box.innerHTML, '');
  assert.equal(page.posts.length, 0);
});

test('capped candidates retain the exact total but disclose the sorting scope and 50-card display', async () => {
  const page = harness();
  page.type('fixture'); page.tick(200);
  await until(() => page.requests.filter(request => request.table === 'cards').length === 2, 'both card reads must start');
  const count = page.requests.find(request => request.options.head);
  const pending = page.requests.find(request => !request.options.head);
  count.resolve({ count: 901, error: null });
  const candidates = Array.from({ length: 200 }, (_, index) => card(`candidate-${index}`, `Fixture ${index}`));
  await page.complete(pending, candidates, []);
  assert.equal(pending.limitValue, 200);
  assert.match(page.box.innerHTML, /총 901건/);
  assert.match(page.box.innerHTML, /50장 표시/);
  assert.match(page.box.innerHTML, /data-search-candidate-limit/);
  assert.match(page.box.innerHTML, /최대 200장을 조회해 정렬합니다/);
  assert.doesNotMatch(page.box.innerHTML, /상위 50장/);
  assert.equal((page.box.innerHTML.match(/href="\/cards\//g) || []).length, 50);
});

test('uncapped candidates do not show a limit warning', async () => {
  const page = harness();
  await page.complete(await page.start('fixture'), [card()], []);
  assert.doesNotMatch(page.box.innerHTML, /data-search-candidate-limit|최대 200장/);
});

const gradingTools = [
  ['/tools/grading-cost-compare', '그레이딩 비용 비교'],
  ['/tools/psa-grading-break-even', 'PSA 손익 계산'],
  ['/tools/psa-cert-checker', 'PSA 인증번호 조회 도우미']
];

for (const query of ['리자몽 PSA 10 가격', 'BGS 9.5', 'CGC 10', 'BRG 그레이딩', 'SGC 10', '리자몽 등급']) {
  test(`graded intent ${query} shows existing tools without waiting for the SDK or querying Raw prices`, async () => {
    const page = harness('cardpick.kr', { sdkMissing:true });
    page.type(query); page.tick(200); await settle();
    assert.match(page.box.innerHTML, /data-search-grading-intent/);
    assert.match(page.box.innerHTML, /그레이딩 카드 거래가격은 제공하지 않습니다/);
    assert.match(page.box.innerHTML, /Raw 카드 참고가로 대신 검색하지 않습니다/);
    assert.deepEqual(page.box.querySelectorAll('a').map(link => [link.getAttribute('href'), link.textContent]), gradingTools);
    assert.equal(page.requests.length, 0);
    assert.equal(page.posts.length, 0);
    assert.equal(page.timers.size, 0, 'early grading exit clears the shared deadline');
    assertSearchSemantics(page, 'block');
  });
}

test('grading links are native keyboard targets; Escape restores input and Enter retains full-search semantics', async () => {
  const page = harness();
  page.type('PSA 10'); page.tick(200); await settle();
  for (const link of page.box.querySelectorAll('a')) {
    assert.equal(link.tag, 'a');
    assert.match(link.getAttribute('href'), /^\/tools\//);
    assert.equal(link.getAttribute('tabindex'), null, 'links keep their native tab order');
    assert.equal(link.getAttribute('role'), null);
    assert.match(link.style.cssText, /min-height:44px/);
    page.docEvent('focusin', { target:link });
    assert.equal(page.box.style.display, 'block');
  }
  const finalLink = page.box.querySelectorAll('a')[2];
  let prevented = false;
  page.docEvent('keydown', { key:'Escape', target:finalLink, preventDefault:() => { prevented = true; } });
  assert.equal(prevented, true);
  assert.equal(page.box.style.display, 'none');
  page.tick(200); await settle();
  assert.equal(page.requests.length, 0);
  page.input.fire('keydown', { key:'Enter' });
  assert.equal(page.location.href, '/search?q=PSA%2010');
  assert.notEqual(page.location.href, gradingTools[0][0], 'Enter must not silently select the first tool');
});

test('malicious graded queries are not interpolated into helper DOM and cannot create an arbitrary destination', async () => {
  const page = harness('cardpick.kr');
  page.type('<img src=x onerror=alert(1)> PSA 10'); page.tick(200); await settle();
  assert.match(page.box.innerHTML, /data-search-grading-intent/);
  assert.doesNotMatch(page.box.innerHTML, /<img|onerror|alert\(1\)|javascript:/);
  assert.deepEqual(page.box.querySelectorAll('a').map(link => link.getAttribute('href')), gradingTools.map(([href]) => href));
  assert.equal(page.requests.length, 0);
  assert.equal(page.posts.length, 0);
});

test('a grading query cancels older Raw reads and a later ordinary card query still works', async () => {
  const page = harness('cardpick.kr');
  const old = await page.start('alpha');
  page.type('PSA 10'); page.tick(200); await settle();
  assert.equal(old.signal.aborted, true);
  const guidance = page.box.innerHTML;
  await page.releaseLate(old, [card('stale-raw', 'Stale Raw result')]);
  assert.equal(page.box.innerHTML, guidance);
  assert.equal(page.posts.length, 0);
  const next = await page.start('뮤츠 ex');
  await page.complete(next, [card('normal-after-grade', 'Mewtwo ex')], [trusted('normal-after-grade')]);
  assert.match(page.box.innerHTML, /normal-after-grade/);
  assert.doesNotMatch(page.box.innerHTML, /data-search-grading-intent/);
  assert.deepEqual(tokenFilters(next), ['%mewtwo%', '%ex%']);
  assert.equal(page.posts.length, 1);
});

test('an empty non-grading token plan retains the original input guidance without tool shortcuts', async () => {
  const page = harness();
  page.type('***'); page.tick(200); await settle();
  assert.match(page.box.innerHTML, /카드명·세트 코드·번호를 입력해 주세요/);
  assert.doesNotMatch(page.box.innerHTML, /data-search-grading-intent|\/tools\//);
  assert.equal(page.requests.length, 0);
});

test('actual search SSR gives graded intent the same fixed existing tools, no provider reads or report writes', async () => {
  const savedFetch = globalThis.fetch;
  let providerCalls = 0;
  globalThis.fetch = async () => { providerCalls++; throw new Error('graded search must not read a provider'); };
  try {
    for (const query of ['리자몽 PSA 10 가격', 'BRG 10', '<script>alert(1)</script> CGC']) {
      const url = new URL('https://cardpick.kr/search');
      url.searchParams.set('q', query);
      const response = await onRequest({ request:new Request(url) });
      const html = await response.text();
      assert.equal(response.status, 200);
      assert.match(html, /data-search-grading-intent/);
      assert.match(html, /그레이딩 검색 안내/);
      assert.match(html, /그레이딩 카드 거래가격은 제공하지 않습니다/);
      const guidance = html.match(/<div data-search-grading-intent[\s\S]*?<\/div>\s*<\/div>/)?.[0];
      assert.ok(guidance);
      assert.deepEqual([...guidance.matchAll(/<a href="([^"]+)"[^>]*>([^<]+)<\/a>/g)].map(match => [match[1], match[2]]), gradingTools);
      assert.doesNotMatch(html, /검색어 확인 필요|검색할 카드명·세트 코드·번호를 입력해 주세요|\/api\/(?:search-log|request-update)|<script>alert\(1\)<\/script>/);
      assert.match(html, /name="robots" content="noindex,follow"/);
      assert.match(html, /rel="canonical" href="https:\/\/cardpick.kr\/search"/);
      assert.doesNotMatch(html, /pagead\/js\/adsbygoogle/);
    }
    assert.equal(providerCalls, 0);
  } finally {
    globalThis.fetch = savedFetch;
  }
});

for (const [query, filters] of [
  ['코코리 #205',[['search_text','%phanpy%'],['number','205']]],
  ['sv3pt5 199/091',[['set_id','sv3pt5'],['number','199/091']]],
  ['set:SSP #001',[['set_code','SSP'],['number','001']]],
  ['#TG01/TG30',[['number','TG01/TG30']]],
]) {
  test(`header identity ${query} uses identical literal filters for data and count`,async()=>{
    const page=harness();
    const pending=await page.start(query);
    const actual=pending.filters.filter(item=>item.kind==='ilike').map(item=>[item.field,item.value]);
    assert.deepEqual(actual,filters);
    const count=page.requests.find(item=>item.options.head);
    assert.deepEqual(count.filters.filter(item=>item.kind==='ilike').map(item=>[item.field,item.value]),filters);
    await page.complete(pending,[card('exact-fixture','Identity fixture')],[trusted('exact-fixture')]);
    assert.match(page.box.innerHTML,/data-search-identity-conditions/);
    assert.equal(pending.limitValue,200);
    assert.equal(page.posts.length,0);
  });
}

for(const query of ['set:a%','#001 #002','set:SSP 199 200','199/165 199/091','sv3pt5 swsh12 199']) {
  test(`invalid header identity ${query} makes no SDK or logging request`,async()=>{
    const page=harness('cardpick.kr',{sdkMissing:true});
    page.type(query);page.tick(200);await settle();
    assert.match(page.box.innerHTML,/형식|하나만/);
    assert.equal(page.requests.length,0);assert.equal(page.posts.length,0);assert.equal(page.timers.size,0);
  });
}

test('zero exact header results do not retry without the denominator or log an update',async()=>{
  const page=harness('cardpick.kr');
  const pending=await page.start('#199/091');
  pending.resolve({data:[],error:null});await settle();
  assert.match(page.box.innerHTML,/분모를 생략하거나 다른 카드로 대신 연결하지 않습니다/);
  assert.equal(page.requests.filter(item=>item.table==='cards'&&!item.options.head).length,1);
  assert.equal(page.requests.filter(item=>item.table==='card_price_trust').length,0);
  assert.equal(page.posts.length,0);
});

test('late identity reads cannot replace grading guidance or newer exact results',async()=>{
  const page=harness();const old=await page.start('#001');
  page.type('PSA 10');page.tick(200);await settle();
  assert.equal(old.signal.aborted,true);
  const guidance=page.box.innerHTML;
  await page.releaseLate(old,[card('stale-exact','Stale exact')]);
  assert.equal(page.box.innerHTML,guidance);
  const next=await page.start('set:SSP #205');
  await page.complete(next,[card('new-exact','New exact')],[]);
  assert.match(page.box.innerHTML,/new-exact/);
  assert.doesNotMatch(page.box.innerHTML,/stale-exact|data-search-grading-intent/);
});
