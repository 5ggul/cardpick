#!/usr/bin/env node
// Execute the actual page bootstrap, deferred initializer and body consumers.
// Fixtures are isolated: no browser session, provider or database writes occur.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const html = readFileSync(new URL('../card-detail.html', import.meta.url), 'utf8');
const deferred = readFileSync(new URL('../card-detail.js', import.meta.url), 'utf8');
const inlineScripts = [...html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/gi)].map(match => match[1]);
function oneScript(marker) {
  const matches = inlineScripts.filter(source => source.includes(marker));
  assert.equal(matches.length, 1, `one actual inline script must contain ${marker}`);
  return matches[0];
}
const bootstrap = oneScript('Keep one runtime object:');
const watchlist = oneScript("var LS_KEY = 'cardpick:watchlist';").split('// CARDPICK_PRICE_DISPLAY_START')[0];
const recentlyViewed = oneScript('(function recentlyViewed()');
const CARD = {
  slug: 'test-only-205', name: 'Actual SSR Name', name_ko: '테스트 카드',
  game: 'pokemon', set_name: 'Actual SSR Set', set_code: 'TEST',
  number: '205', rarity_class: 'SAR', rarity: 'Special Art Rare',
};

class Element {
  constructor(tagName, attributes = {}, text = '') {
    this.tagName = tagName.toUpperCase();
    this.attributes = new Map(Object.entries(attributes));
    this.value = text;
    this.textWrites = 0;
    this.attributeWrites = 0;
    this.style = {};
    this.listeners = new Map();
    this.classes = new Set();
    this.classList = {
      contains: name => this.classes.has(name),
      toggle: (name, force) => {
        const on = force === undefined ? !this.classes.has(name) : force;
        if (on) this.classes.add(name); else this.classes.delete(name);
        return on;
      },
    };
  }
  get textContent() { return this.value; }
  set textContent(value) { this.value = value; this.textWrites++; }
  getAttribute(name) { return this.attributes.get(name) ?? null; }
  setAttribute(name, value) { this.attributes.set(name, String(value)); this.attributeWrites++; }
  addEventListener(name, callback) { this.listeners.set(name, callback); }
  querySelector() { return this.label || null; }
  snapshot() {
    return { text: this.textContent, attributes: [...this.attributes], textWrites: this.textWrites, attributeWrites: this.attributeWrites };
  }
}

function matches(element, selector) {
  if (selector.startsWith('#')) return element.getAttribute('id') === selector.slice(1);
  const parsed = selector.match(/^([\w-]+)?(?:\[([^=\]]+)(?:="([^"]*)")?\])?$/);
  assert.ok(parsed, `unsupported test selector: ${selector}`);
  const [, tag, attribute, value] = parsed;
  return (!tag || element.tagName.toLowerCase() === tag.toLowerCase())
    && (!attribute || (value === undefined ? element.attributes.has(attribute) : element.getAttribute(attribute) === value));
}

function harness({ pathname = '/cards/test-only-205', search = '' } = {}) {
  const events = [];
  const handlers = new Map();
  const storage = new Map();
  const watch = new Element('button', { id: 'watchlist-btn' });
  const notify = new Element('button', { id: 'notify-btn' });
  watch.label = new Element('span');
  notify.label = new Element('span');
  const preserved = [
    new Element('title', {}, '테스트 카드 해외 참고가 | 카드픽'),
    new Element('h1', { 'data-c-h1-full': '' }, '테스트 카드 (Actual SSR Name) 시세 가격'),
    new Element('p', { 'data-c-h1-lede': '' }, '서버가 완성한 가격 안내문'),
    new Element('p', { 'data-c-about': '' }, '서버가 완성한 카드·가격 설명'),
    new Element('div', { id: 'hero-price' }, '₩ 235'),
    new Element('div', { id: 'hero-secondary' }, '$0.17'),
    new Element('div', { id: 'hero-judgement' }, '서버가 완성한 가격 안내문'),
    new Element('meta', { name: 'description', content: '서버 가격 설명' }),
    new Element('meta', { property: 'og:description', content: '서버 OG 가격 설명' }),
    new Element('meta', { name: 'twitter:description', content: '서버 Twitter 가격 설명' }),
    new Element('meta', { name: 'robots', content: 'noindex,follow' }),
    new Element('link', { rel: 'canonical', href: 'https://cardpick.kr/cards/test-only-205' }),
    new Element('script', { type: 'application/ld+json' }, '{"@type":"WebPage","description":"서버 가격 설명"}'),
    new Element('script', { type: 'application/ld+json' }, '{"@type":"Dataset","name":"서버 가격 데이터"}'),
  ];
  const nodes = [watch, notify, ...preserved];
  const document = {
    readyState: 'loading', hidden: false, title: '테스트 카드 해외 참고가 | 카드픽',
    getElementById: id => nodes.find(node => node.getAttribute('id') === id) || null,
    querySelectorAll: selectors => nodes.filter(node => selectors.split(',').some(selector => matches(node, selector.trim()))),
    querySelector: selector => document.querySelectorAll(selector)[0] || null,
    addEventListener: (name, callback) => {
      if (!handlers.has(name)) handlers.set(name, []);
      handlers.get(name).push(callback);
    },
  };
  let timerId = 0;
  const timers = new Map();
  const context = {
    window: {}, document, URLSearchParams, Date, Promise, console,
    location: { pathname, search, replace: () => assert.fail('valid fixture must not redirect') },
    localStorage: {
      getItem: key => storage.get(key) ?? null,
      setItem: (key, value) => { events.push(`storage:${key}`); storage.set(key, value); },
    },
    // Keep readiness polling pending until a simulated auth client is installed.
    // Never run provider queries or real timers in these startup-order tests.
    setTimeout: (callback, delay) => { timers.set(++timerId, { callback, delay }); return timerId; },
    clearTimeout: id => timers.delete(id),
    fetch: () => assert.fail('startup fixture must not call an upstream provider'),
    confirm: () => true,
    alert: () => assert.fail('fixture must not display an error'),
  };
  vm.createContext(context);
  const run = source => vm.runInContext(source, context);
  run(bootstrap);
  const runtime = context.window.__CARDPICK_CARD__.runtime;
  for (const key of ['name', 'set', 'game']) {
    let value = runtime[key];
    Object.defineProperty(runtime, key, {
      get: () => value,
      set: next => { events.push(`runtime:${key}`); value = next; },
      enumerable: true, configurable: true,
    });
  }
  // Match the real SSR order: the server appends globals at the end of head,
  // after the bootstrap and before parser-executed body consumers.
  context.window.CARDPICK_CARD = { ...CARD };
  context.window.CARDPICK_BEST = { latest_krw: 235, trust_level: 'HIGH' };
  context.window.CARDPICK_PRICE_DISPLAY = { basis: 'latest', amountKrw: 235, trustLevel: 'HIGH' };
  const globalSnapshots = {
    card: JSON.stringify(context.window.CARDPICK_CARD),
    best: JSON.stringify(context.window.CARDPICK_BEST),
    display: JSON.stringify(context.window.CARDPICK_PRICE_DISPLAY),
  };
  const snapshots = preserved.map(node => node.snapshot());
  run(watchlist);
  run(recentlyViewed);
  function dispatchDcl() {
    events.push('dcl:start');
    document.readyState = 'interactive';
    for (const callback of handlers.get('DOMContentLoaded') || []) callback();
    document.readyState = 'complete';
    events.push('dcl:end');
  }
  function assertPreserved() {
    assert.deepEqual(preserved.map(node => node.snapshot()), snapshots, 'startup must not rewrite SSR price, text, metadata or schemas');
    assert.equal(document.title, '테스트 카드 해외 참고가 | 카드픽');
    assert.equal(JSON.stringify(context.window.CARDPICK_CARD), globalSnapshots.card);
    assert.equal(JSON.stringify(context.window.CARDPICK_BEST), globalSnapshots.best);
    assert.equal(JSON.stringify(context.window.CARDPICK_PRICE_DISPLAY), globalSnapshots.display);
  }
  async function saveWatchlist() {
    let saved;
    context.window.cardpickAuth = {
      getClient: () => ({ auth: { getSession: async () => ({ data: { session: { user: { id: 'fixture-user' } } } }) } }),
      addWatch: async card => { saved = card; return {}; },
      removeWatch: async () => assert.fail('initial click must add the card'),
    };
    await watch.listeners.get('click')();
    assert.strictEqual(saved, runtime, 'watchlist must retain the object captured during body parsing');
    assert.equal(saved.slug, CARD.slug);
    assert.equal(saved.name, CARD.name);
    assert.equal(saved.set, CARD.set_name);
    assert.equal(saved.game, CARD.game);
    assert.equal(watch.disabled, false);
    assert.equal(watch.getAttribute('aria-pressed'), 'true');
  }
  function assertRecentView() {
    const record = JSON.parse(storage.get('cardpick:recently_viewed'))[0];
    assert.equal(record.slug, CARD.slug);
    assert.equal(record.name, CARD.name);
    assert.equal(record.name_ko, CARD.name_ko);
    assert.equal(record.set_name, CARD.set_name);
    assert.equal(record.krw, 235);
    assert.equal(events.filter(event => event === 'storage:cardpick:recently_viewed').length, 1);
  }
  return { context, document, runtime, events, handlers, run, dispatchDcl, assertPreserved, saveWatchlist, assertRecentView };
}

test('deferred initializer hydrates the captured runtime before DOMContentLoaded consumers', async () => {
  const client = harness();
  client.document.readyState = 'interactive';
  client.run(deferred);
  assert.strictEqual(client.context.window.__CARDPICK_CARD__.runtime, client.runtime);
  assert.equal(client.runtime.name, CARD.name);
  assert.equal(client.runtime.set, CARD.set_name);
  assert.equal(client.handlers.get('DOMContentLoaded').length, 2, 'only bootstrap fallback and recent-view handlers wait for DCL');
  client.dispatchDcl();
  assert.ok(client.events.indexOf('runtime:name') < client.events.indexOf('dcl:start'));
  assert.ok(client.events.indexOf('storage:cardpick:recently_viewed') > client.events.indexOf('dcl:start'));
  client.assertRecentView();
  client.assertPreserved();
  await client.saveWatchlist();
  client.assertPreserved();
});

test('bootstrap and body consumers remain correct when the deferred script fails to load', async () => {
  const client = harness();
  assert.notEqual(client.runtime.name, CARD.name, 'bootstrap starts with a URL-derived name');
  client.dispatchDcl();
  assert.strictEqual(client.context.window.__CARDPICK_CARD__.runtime, client.runtime);
  assert.ok(client.events.indexOf('runtime:name') > client.events.indexOf('dcl:start'));
  assert.ok(client.events.indexOf('runtime:name') < client.events.indexOf('storage:cardpick:recently_viewed'), 'SSR fallback runs before later DCL consumers');
  client.assertRecentView();
  client.assertPreserved();
  await client.saveWatchlist();
  client.assertPreserved();
});

test('query-string slug fallback keeps the same watchlist metadata when the page script is unavailable', async () => {
  const client = harness({ pathname: '/card-detail', search: '?slug=test-only-205' });
  client.dispatchDcl();
  assert.equal(client.runtime.slug, CARD.slug);
  client.assertRecentView();
  await client.saveWatchlist();
  client.assertPreserved();
});
