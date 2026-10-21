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

function cssomColor(value) {
  const hex = String(value).match(/^#([\da-f]{6})$/i);
  if (hex) return `rgb(${[0, 2, 4].map(offset => parseInt(hex[1].slice(offset, offset + 2), 16)).join(', ')})`;
  const rgb = String(value).match(/^(rgba?)\(([^)]+)\)$/);
  if (rgb) return `${rgb[1]}(${rgb[2].split(',').map(part => String(Number(part.trim()))).join(', ')})`;
  return value;
}

class Element {
  constructor(tagName, attributes = {}, text = '') {
    this.tagName = tagName.toUpperCase();
    this.attributes = new Map(Object.entries(attributes));
    this.value = text;
    this.textWrites = 0;
    this.attributeWrites = 0;
    this.classWrites = 0;
    this.hiddenWrites = 0;
    this.styleWrites = 0;
    this.htmlWrites = 0;
    this.style = new Proxy({}, {
      get: (styles, name) => styles[name] || '',
      set: (styles, name, value) => {
        styles[name] = name === 'color' || name === 'borderColor' ? cssomColor(value) : value;
        this.styleWrites++;
        return true;
      },
    });
    this.listeners = new Map();
    this.classes = new Set((attributes.class || '').split(/\s+/).filter(Boolean));
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
  get innerHTML() { return this.value; }
  set innerHTML(value) { this.value = value; this.htmlWrites++; }
  get className() { return this.getAttribute('class') || ''; }
  set className(value) { this.attributes.set('class', value); this.classWrites++; }
  get hidden() { return this.attributes.has('hidden'); }
  set hidden(value) {
    if (value) this.attributes.set('hidden', ''); else this.attributes.delete('hidden');
    this.hiddenWrites++;
  }
  get href() { return this.getAttribute('href') || ''; }
  set href(value) { this.setAttribute('href', value); }
  getAttribute(name) { return this.attributes.get(name) ?? null; }
  setAttribute(name, value) { this.attributes.set(name, String(value)); this.attributeWrites++; }
  addEventListener(name, callback) { this.listeners.set(name, callback); }
  querySelector() { return this.label || null; }
  snapshot() {
    return {
      text: this.textContent, attributes: [...this.attributes], styles: { ...this.style },
      textWrites: this.textWrites, attributeWrites: this.attributeWrites,
      classWrites: this.classWrites, hiddenWrites: this.hiddenWrites,
      styleWrites: this.styleWrites, htmlWrites: this.htmlWrites,
    };
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

const metadataAttributes = [
  'data-c-name', 'data-c-subtitle', 'data-c-info-h2', 'data-c-game-name',
  'data-c-set-en', 'data-c-rarity-full', 'data-c-type',
  'data-c-type-row', 'data-c-card-class', 'data-c-card-class-row',
  'data-c-set-code-jp', 'data-c-name-en',
  'data-c-number', 'data-c-artist', 'data-c-hp', 'data-c-hp-row',
  'data-c-set-link', 'data-c-game-chip', 'data-c-rarity-chip', 'data-c-set-chip',
];
function metadataElements() {
  const markup = html.replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1>/gi, '');
  const elements = [];
  for (const [, tag, attributeText] of markup.matchAll(/<([a-z][\w-]*)\b([^>]*?)>/gi)) {
    const attributes = {};
    for (const [, name, double, single, unquoted] of attributeText.matchAll(/([\w:-]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+)))?/g)) {
      attributes[name] = double ?? single ?? unquoted ?? '';
    }
    if (metadataAttributes.some(name => Object.hasOwn(attributes, name))) elements.push(new Element(tag, attributes));
  }
  for (const name of metadataAttributes) assert.ok(elements.some(element => element.attributes.has(name)), `actual template metadata anchor: ${name}`);
  return elements;
}

function harness({ pathname = '/cards/test-only-205', search = '', ssrCard = CARD, metadata = false } = {}) {
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
  const metadataNodes = metadata ? metadataElements() : [];
  const nodes = [watch, notify, ...preserved, ...metadataNodes];
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
  if (ssrCard) {
    context.window.CARDPICK_CARD = { ...ssrCard };
    context.window.CARDPICK_BEST = { latest_krw: 235, trust_level: 'HIGH' };
    context.window.CARDPICK_PRICE_DISPLAY = { basis: 'latest', amountKrw: 235, trustLevel: 'HIGH', sourceDate: '2026-10-17T03:00:00.000Z' };
  }
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
    assert.equal(record.price_basis, 'latest');
    assert.equal(record.price_trust_level, 'HIGH');
    assert.equal(record.price_source_date, '2026-10-17T03:00:00.000Z');
    assert.notEqual(record.viewed_at, record.price_source_date, 'view time is not a price source date');
    assert.equal(events.filter(event => event === 'storage:cardpick:recently_viewed').length, 1);
  }
  return { context, document, runtime, events, handlers, metadataNodes, run, dispatchDcl, assertPreserved, saveWatchlist, assertRecentView };
}

test('deferred initializer hydrates the captured runtime before DOMContentLoaded consumers', async () => {
  const client = harness({ metadata: true });
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
  assert.equal(client.document.querySelector('[data-c-number]').textContent, CARD.number);
  assert.equal(client.document.querySelector('[data-c-set-link]').href, '/sets/TEST');
  assert.equal(client.document.querySelector('[data-c-rarity-chip]').style.color, 'rgb(242, 201, 76)');
  await client.saveWatchlist();
  client.assertPreserved();
});

test('bootstrap and body consumers remain correct when the deferred script fails to load', async () => {
  const client = harness({ metadata: true });
  assert.notEqual(client.runtime.name, CARD.name, 'bootstrap starts with a URL-derived name');
  client.dispatchDcl();
  assert.strictEqual(client.context.window.__CARDPICK_CARD__.runtime, client.runtime);
  assert.ok(client.events.indexOf('runtime:name') > client.events.indexOf('dcl:start'));
  assert.ok(client.events.indexOf('runtime:name') < client.events.indexOf('storage:cardpick:recently_viewed'), 'SSR fallback runs before later DCL consumers');
  client.assertRecentView();
  client.assertPreserved();
  assert.equal(client.metadataNodes.reduce((total, node) => total + node.textWrites + node.styleWrites + node.hiddenWrites + node.classWrites, 0), 0, 'an unavailable deferred script cannot rewrite SSR metadata');
  await client.saveWatchlist();
  client.assertPreserved();
});

test('parser-time initialization still uses the existing DOMContentLoaded order and captured runtime', async () => {
  const client = harness({ metadata: true });
  client.run(deferred);
  assert.equal(client.handlers.get('DOMContentLoaded').length, 3);
  assert.notEqual(client.runtime.name, CARD.name);
  client.dispatchDcl();
  assert.strictEqual(client.context.window.__CARDPICK_CARD__.runtime, client.runtime);
  assert.equal(client.runtime.name, CARD.name);
  assert.equal(client.document.querySelector('[data-c-number]').textContent, CARD.number);
  assert.equal(client.document.querySelector('[data-c-set-link]').href, '/sets/TEST');
  client.assertRecentView();
  client.assertPreserved();
  await client.saveWatchlist();
});

function metadataHarness(db = { ...CARD, type: 'Grass', supertype: 'Pokémon', hp: 60, artist: 'Test-only Artist' }) {
  const client = harness({ metadata: true });
  // The current template has no ld-bc ID. Retain and exercise the existing
  // optional legacy breadcrumb path without inserting one into service HTML.
  const breadcrumb = new Element('script', { id: 'ld-bc', type: 'application/ld+json' });
  const queryById = client.document.getElementById;
  client.document.getElementById = id => id === 'ld-bc' ? breadcrumb : queryById(id);
  const converterStart = deferred.indexOf('  function rarityColorMap(rc) {');
  const applyEnd = deferred.indexOf('\n  // eBay 거래완료 링크');
  assert.ok(converterStart > 0 && applyEnd > converterStart, 'extract the actual converter, mutation helpers and apply function');
  client.context.db = { ...db };
  client.context.canonicalUrl = 'https://cardpick.kr/cards/test-only-205';
  client.run(deferred.slice(converterStart, applyEnd));
  function update(next = client.context.db) {
    client.context.db = { ...next };
    client.run('var card = dbCardToCard(db); apply();');
  }
  function snapshot() { return [...client.metadataNodes, breadcrumb].map(node => node.snapshot()); }
  function assertNoRepeatedMetadataWrites(before) {
    const after = snapshot();
    for (let index = 0; index < after.length; index++) {
      const node = client.metadataNodes[index];
      if (node?.attributes.has('data-c-set-link')) {
        // Its existing unconditional href assignment is deliberately outside
        // this patch. Still require unchanged link text and target value.
        assert.equal(after[index].attributeWrites, before[index].attributeWrites + 1);
        const { attributeWrites: oldCount, ...oldState } = before[index];
        const { attributeWrites: newCount, ...newState } = after[index];
        assert.deepEqual(newState, oldState);
      } else {
        assert.deepEqual(after[index], before[index], `unchanged metadata node ${index} must not be rewritten`);
      }
    }
  }
  return { ...client, breadcrumb, update, snapshot, assertNoRepeatedMetadataWrites };
}

test('identical metadata refreshes retain text, hidden state, canonical chip styles and optional JSON-LD', () => {
  const client = metadataHarness();
  client.update();
  const before = client.snapshot();
  assert.equal(client.document.querySelector('[data-c-type]').textContent, '풀');
  assert.equal(client.document.querySelector('[data-c-hp]').textContent, '60 HP');
  assert.equal(client.document.querySelector('[data-c-card-class]').textContent, '포켓몬');
  assert.equal(client.document.querySelector('[data-c-game-chip]').className, 'chip chip-pokemon');
  assert.equal(client.document.querySelector('[data-c-rarity-chip]').style.borderColor, 'rgba(242, 201, 76, 0.45)');
  assert.equal(client.document.querySelector('[data-c-rarity-chip]').styleWrites, 2, 'one color and one valid RGBA border write, with no discarded intermediate border');
  assert.equal(JSON.parse(client.breadcrumb.textContent).itemListElement[2].item, 'https://cardpick.kr/sets/TEST');
  let previous = before;
  for (let index = 0; index < 3; index++) {
    client.update();
    client.assertNoRepeatedMetadataWrites(previous);
    previous = client.snapshot();
  }
  client.assertPreserved();
});

test('changed metadata updates actual template anchors once, then becomes stable again', () => {
  const client = metadataHarness();
  client.update();
  const initial = client.snapshot();
  client.update({ ...CARD, name: 'Changed Test-only Name', name_en: 'Changed English Name',
    set_name: 'Changed Test-only Set', set_code: 'TEST /?', number: '206',
    rarity_class: 'AR', rarity: 'Illustration Rare', supertype: 'Trainer', type: '', hp: null,
    artist: 'Changed Test-only Artist' });
  assert.notDeepEqual(client.snapshot(), initial);
  assert.equal(client.document.querySelector('[data-c-name]').textContent, 'Changed Test-only Name');
  assert.equal(client.document.querySelector('[data-c-name-en]').textContent, 'Changed English Name');
  assert.equal(client.document.querySelector('[data-c-number]').textContent, '206');
  assert.equal(client.document.querySelector('[data-c-artist]').textContent, 'Changed Test-only Artist');
  assert.equal(client.document.querySelector('[data-c-type-row]').hidden, true);
  assert.equal(client.document.querySelector('[data-c-hp-row]').hidden, true);
  assert.equal(client.document.querySelector('[data-c-card-class-row]').hidden, false);
  assert.equal(client.document.querySelector('[data-c-card-class]').textContent, '트레이너');
  assert.equal(client.document.querySelector('[data-c-set-link]').href, '/sets/TEST%20%2F%3F');
  assert.equal(client.document.querySelector('[data-c-set-chip]').textContent, 'TEST /? · 영문판');
  assert.equal(client.document.querySelector('[data-c-rarity-chip]').style.color, 'rgb(95, 176, 255)');
  assert.equal(client.document.querySelector('[data-c-rarity-chip]').style.borderColor, 'rgba(95, 176, 255, 0.45)');
  const items = JSON.parse(client.breadcrumb.textContent).itemListElement;
  assert.equal(items[2].name, 'Changed Test-only Set');
  assert.equal(items[2].item, 'https://cardpick.kr/sets/TEST%20%2F%3F');
  assert.equal(items[3].name, 'Changed Test-only Name');
  const updated = client.snapshot();
  client.update();
  client.assertNoRepeatedMetadataWrites(updated);
  client.update({ ...CARD, type: 'Water', supertype: 'Pokémon', hp: 120 });
  assert.equal(client.document.querySelector('[data-c-type-row]').hidden, false);
  assert.equal(client.document.querySelector('[data-c-type]').textContent, '물');
  assert.equal(client.document.querySelector('[data-c-hp-row]').hidden, false);
  assert.equal(client.document.querySelector('[data-c-hp]').textContent, '120 HP');
  const restored = client.snapshot();
  client.update();
  client.assertNoRepeatedMetadataWrites(restored);
  client.assertPreserved();
});

test('normalized fallback chip colors do not cause repeated style writes', () => {
  const client = metadataHarness({ ...CARD, game: 'test-only-unsupported-game' });
  client.update();
  const chip = client.document.querySelector('[data-c-game-chip]');
  assert.equal(chip.style.color, 'rgb(139, 150, 168)');
  assert.equal(chip.style.borderColor, 'rgba(255, 255, 255, 0.1)');
  const before = client.snapshot();
  client.update();
  client.assertNoRepeatedMetadataWrites(before);
});

test('a page without SSR metadata still initializes its URL fallback without querying a provider', () => {
  const client = harness({ metadata: true, ssrCard: null });
  client.document.readyState = 'interactive';
  client.run(deferred);
  assert.strictEqual(client.context.window.__CARDPICK_CARD__.runtime, client.runtime);
  assert.equal(client.runtime.slug, CARD.slug);
  assert.equal(client.document.querySelector('[data-c-name]').textContent, 'Test Only 205');
  assert.equal(client.document.querySelector('[data-c-set-link]').href, '/releases');
  assert.equal(client.document.querySelector('[data-c-number]').textContent, '—');
  assert.equal(client.document.querySelector('[data-c-hp-row]').hidden, true);
  assert.equal(client.handlers.get('DOMContentLoaded').length, 2);
});

test('query-string slug fallback keeps the same watchlist metadata when the page script is unavailable', async () => {
  const client = harness({ pathname: '/card-detail', search: '?slug=test-only-205' });
  client.dispatchDcl();
  assert.equal(client.runtime.slug, CARD.slug);
  client.assertRecentView();
  await client.saveWatchlist();
  client.assertPreserved();
});
