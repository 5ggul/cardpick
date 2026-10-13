#!/usr/bin/env node
// Actual SSR function and inline page scripts, with an isolated DOM/event model.
// No network, database or browser is used. These tests do not measure CLS.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const read = path => readFileSync(new URL(path, import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const html = read('../index.html');
const middleware = read('../functions/_middleware.js');
const inline = [...html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/gi)];
const bootstrap = inline.filter(match => match[0].includes('id="home-price-layout-bootstrap"'));
assert.equal(bootstrap.length, 1);
const pageScripts = inline.filter(match => match[1].includes('function renderPrices(tab)'));
assert.equal(pageScripts.length, 1);
const boundary = pageScripts[0][1].indexOf('  // Other tab groups: visual only');
assert.ok(boundary > 0);
// Execute the unchanged helpers, renderer, API loader and price-tab wiring together.
const priceScript = pageScripts[0][1].slice(0, boundary) + '\n})();';

// Slim projection of the real /api/ticker?tab=all capture observed on 2026-10-12.
// Source artifact: cardpick-perf-20261013/api-snapshots.json. No invented prices.
const capturedCards = [
  ['reshiram-ex---173086-173086', 'Reshiram ex', '173/086', 647302],
  ['reshiram-ex---166086-166086', 'Reshiram ex', '166/086', 247144],
  ['bloodmoon-ursaluna-ex---216167-216167', 'Bloodmoon Ursaluna ex', '216/167', 63236],
  ['team-rockets-mewtwo-ex-240', "Team Rocket's Mewtwo ex", '240', 69906],
  ['sawsbuck---166162-166162', 'Sawsbuck', '166/162', 71840],
  ['gastly---177162-177162', 'Gastly', '177/162', 126058],
  ['duskull---068064-068064', 'Duskull', '068/064', 65598],
  ['terapagos-ex---169131-169131', 'Terapagos ex', '169/131', 39372],
  ['horsea---067064-067064', 'Horsea', '067/064', 65142],
  ['glaceon-ex-150', 'Glaceon ex', '150', 355649],
  ['zorua---142086-142086', 'Zorua', '142/086', 56096],
  ['chandelure-103', 'Chandelure', '103', 92113],
  ['walking-wake-ex-205', 'Walking Wake ex', '205', 54840],
  ['carmine-217', 'Carmine', '217', 68843],
  ['mega-charizard-x-ex-125', 'Mega Charizard X ex', '125', 876755],
  ['dragapult-ex-165', 'Dragapult ex', '165', 140558],
  ['pikachu-ex-179', 'Pikachu ex', '179', 63485],
  ['litten-167', 'Litten', '167', 53983],
  ['fezandipiti-ex---092064-092064', 'Fezandipiti ex', '092/064', 47506],
  ['metagross---178162-178162', 'Metagross', '178/162', 44026],
  ['roaring-moon-ex-162', 'Roaring Moon ex', '162', 223915],
  ['palafin-ex-151', 'Palafin ex', '151', 54701],
  ['samurott-107', 'Samurott', '107', 70334],
  ['basic-darkness-energy-098064', 'Basic Darkness Energy', '098/064', 80043],
  ['gengar-ex-193', 'Gengar ex', '193', 69782],
  ['team-rockets-moltres-ex---229182-229182', "Team Rocket's Moltres ex", '229/182', 108049],
  ['zoroark---143086-143086', 'Zoroark', '143/086', 104141],
  ['mortys-conviction---211162-211162', "Morty's Conviction", '211/162', 68415],
  ['ethans-ho-oh-ex---230182-230182', "Ethan's Ho-Oh ex", '230/182', 196116],
  ['jolteon-ex---153131-153131', 'Jolteon ex', '153/131', 236496],
  ['bloodmoon-ursaluna-ex-168', 'Bloodmoon Ursaluna ex', '168', 80291],
  ['leafeon-ex-144', 'Leafeon ex', '144', 435567],
  ['emboar-98', 'Emboar', '98', 51470],
  ['kieran-218', 'Kieran', '218', 39207],
  ['iron-crown-ex-206', 'Iron Crown ex', '206', 70210],
  ['mistys-psyduck-193', "Misty's Psyduck", '193', 62463],
  ['pikachu-131', 'Pikachu', '131', 102070],
  ['cinccino---183162-183162', 'Cinccino', '183/162', 50351],
  ['ns-zoroark-ex-185', "N's Zoroark ex", '185', 49191],
  ['vaporeon-ex-149', 'Vaporeon ex', '149', 365868],
  ['gholdengo-ex-164131', 'Gholdengo ex', '164/131', 60626],
  ['greninja-ex---214167-214167', 'Greninja ex', '214/167', 442942],
  ['arbok-176', 'Arbok', '176', 39994],
  ['ethans-adventure-236', "Ethan's Adventure", '236', 40615],
  ['tepig---096086-096086', 'Tepig', '096/086', 42341],
  ['persian---078064-078064', 'Persian', '078/064', 102374],
  ['cynthias-garchomp-ex---241182-241182', "Cynthia's Garchomp ex", '241/182', 38737],
  ['ionos-bellibolt-ex---183159-183159', "Iono's Bellibolt ex", '183/159', 42424],
  ['team-rockets-nidoking-ex-233', "Team Rocket's Nidoking ex", '233', 107359],
  ['iron-valiant-ex-157', 'Iron Valiant ex', '157', 68083],
].map(([slug, name, number, krw]) => ({ slug, name, number, krw }));
assert.equal(capturedCards.length, 50);

// Only the three selectors used by the actual SSR function are emulated here.
class HTMLRewriter {
  handlers = [];
  on(selector, handler) { this.handlers.push([selector, handler]); return this; }
  transform(response) {
    const handlers = this.handlers;
    return new Response(new ReadableStream({ async start(controller) {
      let value = await response.text();
      for (const [selector, handler] of handlers) {
        let content;
        let appended = '';
        handler.element({ setInnerContent(text) { content = text; }, append(text) { appended += text; } });
        if (selector === 'body') value = value.replace('</body>', appended + '</body>');
        else {
          const [tag, id] = selector.split('#');
          const pattern = new RegExp('(<'+tag+'\\b[^>]*\\bid="'+id+'"[^>]*>)[\\s\\S]*?(</'+tag+'>)');
          assert.match(value, pattern);
          value = value.replace(pattern, (_, start, end) => start + content + end);
        }
      }
      controller.enqueue(new TextEncoder().encode(value));
      controller.close();
    } }), response);
  }
}

async function renderSSR() {
  const requests = [];
  const context = vm.createContext({ URL, Request, Response, Headers, HTMLRewriter,
    caches: { default: { match: async () => null, put: async () => {} } },
    fetch: async url => {
      requests.push(url);
      if (url.includes('/card_price_trust?')) return Response.json(capturedCards.map(c => ({ card_slug: c.slug, display_krw: c.krw })));
      if (url.includes('/cards?')) return Response.json(capturedCards);
      throw new Error('Unexpected request');
    },
  });
  vm.runInContext(middleware.replace('export async function onRequest', 'async function onRequest'), context);
  const response = await context.onRequest({ request: new Request('https://cardpick.kr/'),
    env: { ASSETS: { fetch: async () => new Response(html) } }, waitUntil() {},
  });
  assert.equal(requests.length, 2);
  return response.text();
}
const ssrHTML = await renderSSR();
const ssrBody = ssrHTML.match(/<tbody id="priceBody">([\s\S]*?)<\/tbody>/)[1];
const attrs = source => Object.fromEntries([...source.matchAll(/([\w-]+)(?:="([^"]*)")?/g)].map(([, name, value]) => [name, value ?? '']));
const flush = async () => { for (let i = 0; i < 8; i++) await Promise.resolve(); };

function harness({ boot = true, parsed = true, initialRows = ssrBody } = {}) {
  const events = [];
  const requests = [];
  const listeners = new Map();
  const elements = new Map();
  const observers = [];
  let document;
  class Element {
    constructor(tag, attributes = {}) {
      this.tagName = tag.toUpperCase(); this.attributes = attributes; this.listeners = new Map();
      this.disabled = Object.hasOwn(attributes, 'disabled'); this.textContent = ''; this.parent = null;
    }
    get dataset() { return { tab: this.attributes['data-tab'] }; }
    setAttribute(name, value) { this.attributes[name] = String(value); }
    getAttribute(name) { return this.attributes[name] ?? null; }
    addEventListener(type, callback) {
      const group = this.listeners.get(type) || []; group.push(callback); this.listeners.set(type, group);
    }
    closest(selector) {
      if (selector === 'a[href]' && this.tagName === 'A' && this.getAttribute('href')) return this;
      if (selector === '#cp-expand-prices' && this.getAttribute('id') === 'cp-expand-prices') return this;
      return this.parent?.closest(selector) || null;
    }
    focus(options) { document.activeElement = this; this.focusOptions = options; }
    getClientRects() {
      if (!this.row || !body.links.includes(this)) return [];
      return this.row.ssr && root.classes.has('cp-home-prices-folded') && this.row.index >= 5 ? [] : [{}];
    }
  }
  const root = new Element('html');
  root.classes = new Set();
  root.classList = { contains: name => root.classes.has(name), toggle(name, force) {
    events.push(['class', name, force, (listeners.get('click') || []).length]);
    if (force) root.classes.add(name); else root.classes.delete(name);
  } };
  const body = new Element('tbody', { id: 'priceBody' });
  body.rows = []; body.links = []; body.writes = 0;
  body.querySelectorAll = selector => {
    if (selector === 'tr[data-ssr="1"]') return body.rows.filter(row => row.ssr);
    if (selector === 'a[href]') return body.links;
    throw new Error('Unexpected tbody selector: ' + selector);
  };
  body.querySelector = selector => body.querySelectorAll(selector)[0] || null;
  body.contains = element => body.links.includes(element) || body.links.includes(element?.parent);
  let rowMarkup = '';
  function setRows(value, countWrite = true) {
    if (countWrite) body.writes++;
    if (body.contains(document.activeElement)) document.activeElement = document.body;
    rowMarkup = value; body.rows = []; body.links = [];
    for (const [markup, attributes, content] of value.matchAll(/<tr\b([^>]*)>([\s\S]*?)<\/tr>/g)) {
      const row = { ssr: attrs(attributes)['data-ssr'] === '1', index: body.rows.length, markup };
      body.rows.push(row);
      for (const [, attributes] of content.matchAll(/<a\b([^>]*)>/g)) {
        const link = new Element('a', attrs(attributes)); link.row = row; body.links.push(link);
      }
    }
  }
  Object.defineProperty(body, 'innerHTML', { get: () => rowMarkup, set: setRows });
  const buttonMarkup = html.match(/<button\b([^>]*id="cp-expand-prices"[^>]*)>([^<]*)<\/button>/);
  assert.ok(buttonMarkup);
  const button = new Element('button', attrs(buttonMarkup[1])); button.textContent = buttonMarkup[2];
  const note = new Element('div', { id: 'prices-tab-note' });
  const tabGroup = new Element('div');
  const tabs = [...html.matchAll(/<button class="tab" role="tab"([^>]*)>/g)].map(([, attributes]) => new Element('button', attrs(attributes)));
  assert.equal(tabs.length, 5);
  tabGroup.querySelectorAll = selector => { assert.equal(selector, '.tab'); return tabs; };
  document = {
    documentElement: root, body: null, activeElement: root,
    addEventListener(type, callback) {
      const group = listeners.get(type) || []; group.push(callback); listeners.set(type, group);
      events.push(['listener', type]);
    },
    getElementById: id => elements.get(id) || null,
    querySelector(selector) {
      assert.equal(selector, '#prices .tab[aria-selected="true"]');
      return tabs.find(tab => tab.getAttribute('aria-selected') === 'true') || null;
    },
    querySelectorAll(selector) { assert.equal(selector, '#prices .panel-head .tabs'); return [tabGroup]; },
    createElement: tag => new Element(tag),
    head: { appendChild(element) { elements.set(element.id, element); } },
  };
  const context = vm.createContext({ document, console: { warn() {} },
    MutationObserver: class {
      constructor(callback) { this.callback = callback; observers.push(this); }
      observe() { this.observing = true; }
      disconnect() { this.observing = false; }
    },
    fetch(url, options) {
      let resolve, reject;
      const promise = new Promise((a, b) => { resolve = a; reject = b; });
      requests.push({ url, options, resolve, reject }); return promise;
    },
  });
  context.window = context;
  function parse() {
    document.body = new Element('body'); document.activeElement = document.body;
    elements.set('priceBody', body); elements.set('cp-expand-prices', button); elements.set('prices-tab-note', note);
    setRows(initialRows, false);
    for (const observer of observers) if (observer.observing) observer.callback([]);
  }
  if (boot) vm.runInContext(bootstrap[0][1], context);
  if (parsed) parse();
  function click(target = button) {
    if (target.disabled) return;
    const event = { target, preventDefault() { this.defaultPrevented = true; } };
    for (const callback of target.listeners?.get('click') || []) callback(event);
    for (const callback of listeners.get('click') || []) callback(event);
  }
  async function respond(payload = { cards: capturedCards }, { ok = true, jsonError = false } = {}) {
    const pending = requests.find(request => !request.settled); assert.ok(pending);
    pending.settled = true;
    pending.resolve({ ok, json: async () => { if (jsonError) throw new SyntaxError('bad JSON'); return payload; } });
    await flush();
  }
  return { context, document, root, body, button, tabs, note, events, requests, listeners, observers, parse, click, respond,
    runBody: () => vm.runInContext(priceScript, context),
    visibleLinks: () => body.links.filter(link => link.getClientRects().length),
  };
}

test('actual SSR keeps twenty card links and the trust gate; no JavaScript leaves all twenty visible', () => {
  const h = harness({ boot: false });
  assert.equal(h.body.rows.length, 20); assert.equal(h.body.links.length, 20);
  assert.equal(h.visibleLinks().length, 20);
  assert.equal(h.body.writes, 0); assert.equal(h.button.disabled, true);
  assert.doesNotMatch(ssrHTML.match(/<html[^>]*>/)[0], /cp-home-prices-folded/);
  assert.match(middleware, /display_krw=not\.is\.null&display_krw=gte\.3000/);
  assert.match(middleware, /krw: Math\.round\(Number\(s\.display_krw\)\)/);
});

test('head registers its single owner before folding, and enables SSR controls as HTML parses', () => {
  const h = harness({ parsed: false });
  assert.equal(h.listeners.get('click').length, 1);
  assert.ok(h.events.filter(event => event[0] === 'class' && event[2]).every(event => event[3] === 1));
  h.parse();
  assert.equal(h.body.links.length, 20); assert.equal(h.visibleLinks().length, 5);
  assert.equal(h.body.writes, 0); assert.equal(h.button.disabled, false);
  assert.equal(h.button.textContent, '현재 참고가 20건 보기 ▾');
  assert.equal(h.button.getAttribute('aria-expanded'), 'false');
  assert.ok(h.observers.every(observer => !observer.observing));
  assert.ok(html.indexOf('id="home-price-layout-css"') < html.indexOf('</head>'));
  assert.match(html, /html\.cp-home-prices-folded #priceBody > tr\[data-ssr="1"\]:nth-child\(n\+6\)\{display:none\}/);
});

test('without body scripts or SDKs the native control expands twenty SSR rows and reduces to five', () => {
  const h = harness();
  assert.equal(h.button.tagName, 'BUTTON'); assert.equal(h.button.getAttribute('type'), 'button');
  assert.equal(h.button.getAttribute('aria-controls'), 'priceBody');
  assert.equal(h.button.getAttribute('onclick'), null);
  assert.equal(h.button.getAttribute('onkeydown'), null, 'native Enter/Space activation uses the same click owner');
  assert.match(html, /#cp-expand-prices\{[^}]*padding:12px 0;margin:-12px 0;min-height:44px;box-sizing:border-box/);
  h.button.focus(); h.click();
  assert.equal(h.visibleLinks().length, 20); assert.equal(h.button.textContent, '간단히 보기 ▴');
  assert.equal(h.button.getAttribute('aria-expanded'), 'true'); assert.equal(h.document.activeElement, h.button);
  h.click();
  assert.equal(h.visibleLinks().length, 5); assert.equal(h.button.textContent, '현재 참고가 20건 보기 ▾');
  assert.equal(h.body.writes, 0); assert.equal(h.requests.length, 0);
  const child = { closest: () => h.button }; h.click(child);
  assert.equal(h.visibleLinks().length, 20, 'delegation also handles a child target');
});

test('pending API keeps SSR intact and fallback expansion remains usable', () => {
  const h = harness(); h.runBody();
  assert.equal(h.requests.length, 1); assert.equal(h.requests[0].url, '/api/ticker?tab=all');
  assert.equal(h.requests[0].options.cache, 'no-cache');
  assert.equal(h.body.innerHTML, ssrBody); assert.equal(h.body.writes, 0);
  assert.equal(h.listeners.get('click').length, 1); assert.equal(h.button.listeners.size, 0);
  h.click(); assert.equal(h.visibleLinks().length, 20);
  h.click(); assert.equal(h.visibleLinks().length, 5);
});

test('successful API replaces twenty SSR rows with five and normal expand/reduce uses fifty', async () => {
  const h = harness(); h.runBody(); await h.respond();
  assert.equal(h.body.rows.length, 5); assert.equal(h.visibleLinks().length, 5);
  assert.equal(h.body.querySelectorAll('tr[data-ssr="1"]').length, 0);
  assert.equal(h.button.textContent, '전체 참고가 50건 보기 ▾');
  h.click(); assert.equal(h.body.rows.length, 50); assert.equal(h.button.textContent, '간단히 보기 ▴');
  h.click(); assert.equal(h.body.rows.length, 5); assert.equal(h.button.textContent, '전체 참고가 50건 보기 ▾');
  assert.equal(h.listeners.get('click').length, 1); assert.equal(h.button.listeners.size, 0);
});

test('expanding during the pending request remains expanded when fifty cards arrive', async () => {
  const h = harness(); h.runBody(); h.click(); await h.respond();
  assert.equal(h.body.rows.length, 50); assert.equal(h.button.getAttribute('aria-expanded'), 'true');
  h.click(); assert.equal(h.body.rows.length, 5);
});

test('empty, HTTP, payload and JSON errors retain SSR and usable fallback controls', async t => {
  for (const failure of ['empty', 'http', 'error', 'missing', 'json', 'reject']) await t.test(failure, async () => {
    const h = harness(); h.runBody();
    if (failure === 'reject') { h.requests[0].reject(new Error('offline')); await flush(); }
    else await h.respond(failure === 'empty' ? { cards: [] } : failure === 'error' ? { error: 'unavailable' } : failure === 'missing' ? {} : { cards: capturedCards }, { ok: failure !== 'http', jsonError: failure === 'json' });
    assert.equal(h.body.innerHTML, ssrBody); assert.equal(h.body.writes, 0);
    assert.equal(h.visibleLinks().length, 5); assert.equal(h.button.textContent, '현재 참고가 20건 보기 ▾');
    h.click(); assert.equal(h.visibleLinks().length, 20);
    h.click(); assert.equal(h.visibleLinks().length, 5);
  });
});

test('missing SSR has an honest empty state and disabled controls until cards arrive', async () => {
  const h = harness({ initialRows: '' }); h.runBody();
  assert.equal(h.button.disabled, true); assert.match(h.body.innerHTML, /불러오는 중/);
  await h.respond({ cards: [] });
  assert.match(h.body.innerHTML, /데이터 수집 중/); assert.equal(h.button.disabled, true);
  h.click(); assert.notEqual(h.context.cardpickExpanded, true);
  const populated = harness({ initialRows: '' }); populated.runBody(); await populated.respond();
  assert.equal(populated.visibleLinks().length, 5); assert.equal(populated.button.disabled, false);
});

test('CSR replacement preserves a focused card href and does not steal focus from outside the table', async () => {
  const h = harness(); h.runBody();
  const previous = h.body.links[0]; previous.focus(); await h.respond();
  assert.notEqual(h.document.activeElement, previous);
  assert.equal(h.document.activeElement.getAttribute('href'), previous.getAttribute('href'));
  assert.equal(h.document.activeElement.focusOptions.preventScroll, true);
  const outside = harness(); outside.runBody(); outside.button.focus(); await outside.respond();
  assert.equal(outside.document.activeElement, outside.button);
});

test('reducing moves a hidden row focus to the control; visible row focus survives replacements', async () => {
  const h = harness(); h.runBody(); await h.respond(); h.click();
  h.body.links[40].focus(); h.click();
  assert.equal(h.document.activeElement, h.button); assert.equal(h.document.activeElement.focusOptions.preventScroll, true);
  h.body.links[2].focus(); const href = h.document.activeElement.getAttribute('href'); h.click();
  assert.equal(h.document.activeElement.getAttribute('href'), href); assert.equal(h.visibleLinks().length, 50);
  const ssr = harness(); ssr.click(); ssr.body.links[15].focus(); ssr.click();
  assert.equal(ssr.document.activeElement, ssr.button); assert.equal(ssr.visibleLinks().length, 5);
});

test('existing all/up/down/high/watch tab requests and active states remain connected', async () => {
  const h = harness(); h.runBody(); await h.respond();
  for (const tab of h.tabs.filter(tab => tab.dataset.tab !== 'watch')) {
    h.click(tab);
    assert.equal(h.requests.at(-1).url, '/api/ticker?tab=' + tab.dataset.tab);
    assert.equal(tab.getAttribute('aria-selected'), 'true');
    assert.equal(h.tabs.filter(item => item.getAttribute('aria-selected') === 'true').length, 1);
    await h.respond(); assert.equal(h.visibleLinks().length, 5);
  }
  h.context.cardpickAuth = { getClient: () => ({ auth: { getSession: async () => ({ data: { session: {} } }) } }),
    getWatchlist: async () => [{ card_slug: capturedCards[0].slug }],
  };
  const watch = h.tabs.find(tab => tab.dataset.tab === 'watch'); h.click(watch); await flush();
  assert.equal(h.requests.at(-1).url, '/api/ticker?tab=watch&slugs=' + encodeURIComponent(capturedCards[0].slug));
  await h.respond({ cards: capturedCards.slice(0, 1) });
  assert.equal(h.visibleLinks().length, 1); assert.equal(h.button.disabled, true);
});

test('home brand/footer semantics preserve their page-owned visual rules', () => {
  assert.match(html, /class="brand" aria-label="카드픽 CARDPICK 홈"/);
  assert.match(html, /\.foot h2\{font-size:11px;[^}]*margin:0 0 10px;font-weight:500\}/);
  assert.doesNotMatch(html, /\.foot h4|<h4>/);
  const footer = html.match(/<footer\b[\s\S]*?<\/footer>/)[0];
  assert.deepEqual([...footer.matchAll(/<h2>([^<]*)<\/h2>/g)].map(([, text]) => text), ['데이터', '가이드', '운영']);
});
