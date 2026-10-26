import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { buildCardPriceDisplay } from '../functions/_lib/card-price-display.js';

// Isolated fixtures execute the real script; no provider, browser or logging endpoint is called.
const root = new URL('../', import.meta.url);
const read = file => readFileSync(new URL(file, root), 'utf8').replaceAll('\r\n', '\n');
const source = read('js/cp-card-compare.js');
const KEY = 'cardpick:compare:v1';
const DATE = '2026-10-12T03:04:05.000Z';
const tick = () => new Promise(resolve => setImmediate(resolve));
async function settle() { for (let i = 0; i < 10; i++) await tick(); }
function payload(slug = 'test-only-a', level = 'HIGH', amount = 1200) {
  const summary = { latest_krw: 999999, latest_usd: 123, last_fetched_at: DATE, variant: 'normal' };
  return {
    card: { slug, game: 'pokemon', name: 'Test-only card ' + slug, name_ko: '검사용 카드', set_code: 'TEST', set_name: 'Test-only set', number: '001', rarity: 'Test-only rarity' },
    best: { ...summary, latest_krw: 999999, price_display: { amountKrw: 888888 } },
    variants: [{ variant: 'holofoil', latest_krw: 777777 }],
    price_display: buildCardPriceDisplay(summary, { trust_level: level, display_krw: amount, distinct_7d: 3, distinct_30d: 8 }),
  };
}
class Element {
  constructor(tag = 'div') { this.tag = tag; this.children = []; this.attrs = {}; this.events = {}; this.hidden = true; this.disabled = false; this.className = ''; this.ownText = ''; }
  get textContent() { return this.ownText + this.children.map(node => node.textContent).join(''); }
  set textContent(value) { this.ownText = String(value); this.children = []; }
  appendChild(node) { this.children.push(node); node.parentElement = this; return node; }
  setAttribute(key, value) { this.attrs[key] = String(value); }
  getAttribute(key) { return this.attrs[key] ?? null; }
  addEventListener(name, fn) { (this.events[name] ||= []).push(fn); }
  click(options = {}) {
    const event = { target: this, button: 0, defaultPrevented: false, preventDefault() { this.defaultPrevented = true; }, ...options };
    if (!this.disabled) for (const fn of this.events.click || []) fn(event);
    return event;
  }
  focus() { this.focused = true; }
  all(tag) { return this.children.flatMap(node => [...(node.tag === tag ? [node] : []), ...node.all(tag)]); }
}
function harness({ stored, storageReadError = false, storageWriteError = false, absent = false, missingPart = false, loading = false, noFetch = false, noHeader = false, noShortcut = false, slugs = ['test-only-a', 'test-only-b', 'test-only-c', '../unsafe'] } = {}) {
  const panel = new Element('section'), slots = new Element(), status = new Element('p'), clear = new Element('button'), title = new Element('h2'), header = new Element('input');
  const shortcut = new Element(), shortcutCount = new Element('span'), shortcutLink = new Element('a'), body = new Element('body');
  shortcutLink.setAttribute('href', '#card-compare'); shortcutLink.hidden = false; shortcutCount.hidden = false;
  shortcut.appendChild(shortcutCount); shortcut.appendChild(shortcutLink);
  shortcut.querySelector = selector => {
    if (selector === '[data-cp-compare-count]') return shortcutCount;
    assert.equal(selector, '[data-cp-compare-jump]'); return shortcutLink;
  };
  const parts = { '[data-cp-compare-slots]': slots, '[data-cp-compare-status]': status, '[data-cp-compare-clear]': clear, '#card-compare-title': title };
  panel.querySelector = selector => missingPart && selector === '[data-cp-compare-slots]' ? null : parts[selector];
  const buttons = slugs.map(slug => { const node = new Element('button'); node.type = 'button'; node.setAttribute('data-cp-compare-add', slug); node.setAttribute('aria-pressed', 'false'); return node; });
  const requests = [], timers = new Map(), writes = [], documentEvents = {}, values = new Map();
  if (stored !== undefined) values.set(KEY, typeof stored === 'string' ? stored : JSON.stringify(stored));
  let reads = 0, timerId = 0;
  const document = {
    readyState: loading ? 'loading' : 'complete', body,
    querySelector(selector) {
      if (selector === 'header input[name="q"]') return noHeader ? null : header;
      if (selector === '[data-cp-compare-shortcut]') return noShortcut ? null : shortcut;
      assert.equal(selector, '[data-cp-card-compare]'); return absent ? null : panel;
    },
    querySelectorAll(selector) { assert.equal(selector, '[data-cp-compare-add]'); return buttons; },
    createElement: tag => { const node = new Element(tag); node.focus = () => { node.focused = true; document.activeElement = node; }; return node; },
    addEventListener(name, fn) { (documentEvents[name] ||= []).push(fn); },
  };
  for (const node of [panel, title, header, shortcutLink, body, ...buttons]) {
    node.focus = options => { node.focused = true; node.focusOptions = options; document.activeElement = node; };
  }
  const context = {
    document, AbortController, Date, console,
    sessionStorage: {
      getItem(key) { reads++; assert.equal(key, KEY); if (storageReadError) throw Error('blocked'); return values.get(key) ?? null; },
      setItem(key, value) { writes.push({ key, value }); if (storageWriteError) throw Error('quota'); values.set(key, value); },
      removeItem(key) { writes.push({ key, remove: true }); if (storageWriteError) throw Error('blocked'); values.delete(key); },
    },
    setTimeout(fn, ms) { const id = ++timerId; timers.set(id, { fn, ms }); return id; },
    clearTimeout(id) { timers.delete(id); },
    fetch: noFetch ? undefined : (url, options) => {
      assert.match(url, /^\/api\/card-summary\?slug=/); assert.equal(options.method, 'GET'); assert.equal(options.credentials, 'same-origin');
      const request = { url, options };
      requests.push(request);
      return new Promise((resolve, reject) => {
        request.reject = reject;
        request.resolve = (body = payload(decodeURIComponent(url.split('=')[1])), code = 200) => resolve({ ok: code >= 200 && code < 300, status: code, json: async () => body });
        request.badJson = () => resolve({ ok: true, status: 200, json: async () => { throw Error('invalid json'); } });
        request.hangBody = () => resolve({ ok: true, status: 200, json: () => new Promise(() => {}) });
      });
    },
  };
  vm.createContext(context);
  vm.runInContext(source, context, { timeout: 2000 });
  return { panel, slots, status, clear, title, header, shortcut, shortcutCount, shortcutLink, body, buttons, requests, timers, writes, values, context,
    readCount: () => reads,
    ready() { document.readyState = 'complete'; for (const fn of documentEvents.DOMContentLoaded || []) fn(); },
    expire() { const due = [...timers.values()]; for (const timer of due) { assert.equal(timer.ms, 6000); timer.fn(); } },
    flushJump() { for (const [id, timer] of [...timers]) if (timer.ms === 0) { timers.delete(id); timer.fn(); } },
  };
}
test('absent comparison root, incomplete root or unavailable fetch leave storage and network untouched', async () => {
  for (const options of [{ absent: true }, { missingPart: true }, { noFetch: true }]) {
    const h = harness({ ...options, stored: ['test-only-a'] }); await settle();
    assert.equal(h.readCount(), 0); assert.equal(h.requests.length, 0); assert.equal(h.panel.hidden, true);
  }
});
test('empty initial state makes no request, progressively reveals valid buttons and disables clear', async () => {
  const h = harness(); await settle();
  assert.equal(h.panel.hidden, false); assert.equal(h.clear.disabled, true); assert.equal(h.requests.length, 0);
  assert.equal(h.buttons[0].hidden, false); assert.equal(h.buttons[3].hidden, true);
  assert.match(h.slots.textContent, /카드 두 장을 선택/);
});
test('DOMContentLoaded initializes only when ready and a duplicate execution does not double-bind', async () => {
  const h = harness({ loading: true }); assert.equal(h.readCount(), 0); h.ready();
  vm.runInContext(source, h.context, { timeout: 2000 });
  h.buttons[0].click(); await settle(); assert.equal(h.requests.length, 1); assert.equal(h.readCount(), 1);
});
for (const stored of ['{', 'null', '{}', '123', '"card"', ['test-only-a', 'test-only-b', 'test-only-c'], 'x'.repeat(2049)]) {
  test('malformed or over-limit stored root is ignored: ' + JSON.stringify(stored).slice(0, 60), async () => {
    const h = harness({ stored }); await settle(); assert.equal(h.requests.length, 0); assert.equal(h.clear.disabled, true);
  });
}
for (const value of [null, {}, [], 1, '', '.', '..', '/card', 'card/name', 'card?x', 'card#x', 'card%2f', 'card\\name', 'card name', 'a\u0000b', 'x'.repeat(241)]) {
  test('unsafe stored slug is not requested: ' + JSON.stringify(value).slice(0, 50), async () => {
    const h = harness({ stored: [value] }); await settle(); assert.equal(h.requests.length, 0);
  });
}
test('restoration deduplicates, accepts only two valid slugs and issues exactly two GET reads', async () => {
  const h = harness({ stored: ['test-only-a', 'test-only-b'] }); await settle();
  assert.equal(h.requests.length, 2); assert.equal(h.writes.length, 0);
  const d = harness({ stored: ['test-only-a', 'test-only-a'] }); await settle(); assert.equal(d.requests.length, 1);
});
test('select, duplicate toggle, third-card limit and clear persist only slug arrays', async () => {
  const h = harness(); h.buttons[0].click(); h.buttons[1].click(); await settle();
  assert.equal(h.requests.length, 2); assert.equal(h.buttons[0].getAttribute('aria-pressed'), 'true');
  h.buttons[2].click(); await settle(); assert.equal(h.requests.length, 2); assert.match(h.status.textContent, /최대 2장/);
  assert.deepEqual(JSON.parse(h.values.get(KEY)), ['test-only-a', 'test-only-b']);
  h.buttons[0].click(); assert.equal(h.requests[0].options.signal.aborted, true); assert.equal(h.buttons[0].focused, true);
  h.buttons[2].click(); await settle(); assert.equal(h.requests.length, 3);
  h.clear.click(); assert.equal(h.values.has(KEY), false); assert.equal(h.clear.disabled, true); assert.equal(h.buttons[0].focused, true);
  assert.ok(h.requests.every(request => request.options.signal.aborted));
  assert.ok(h.writes.every(write => write.remove || JSON.parse(write.value).every(value => typeof value === 'string')));
});
test('blocked reads and quota writes keep selection functional in memory with honest guidance', async () => {
  for (const options of [{ storageReadError: true }, { storageWriteError: true }]) {
    const h = harness(options); h.buttons[0].click(); await settle(); h.requests[0].resolve(); await settle();
    assert.match(h.status.textContent, /브라우저 저장을 사용할 수 없어/); assert.match(h.slots.textContent, /Test-only card/);
    h.clear.click(); assert.match(h.status.textContent, /모두 비웠습니다/);
  }
});
test('clearing before the pending request starts avoids the read altogether', async () => {
  const h = harness(); h.buttons[0].click(); h.clear.click(); await settle();
  assert.equal(h.requests.length, 0); assert.equal(h.clear.disabled, true); assert.equal(h.timers.size, 0);
});
for (const level of ['HIGH', 'MEDIUM', 'LOW']) {
  test(level + ' displays only reviewed amount, basis, actual date and representative variant', async () => {
    const h = harness(); h.buttons[0].click(); await settle(); const body = payload('test-only-a', level);
    h.requests[0].resolve(body); await settle();
    const copy = h.slots.textContent;
    assert.match(copy, /₩ 1,200/); assert.doesNotMatch(copy, /999,999|888,888|777,777|NaN/);
    assert.match(copy, /2026\.10\.12 \(UTC\)/); assert.match(copy, /대표 가격 변형normal/); assert.match(copy, /이 응답에는 언어판 정보가 없습니다/);
    if (level !== 'HIGH') assert.match(copy, /30일 중앙값/);
    if (level === 'LOW') assert.match(copy, /표본 부족 · 참고용/);
    assert.equal(h.timers.size, 0);
  });
}
test('NONE retains identity with unavailable price rather than zero or raw fallback', async () => {
  const h = harness(); h.buttons[0].click(); await settle(); h.requests[0].resolve(payload('test-only-a', 'NONE', null)); await settle();
  assert.match(h.slots.textContent, /Test-only card/); assert.match(h.slots.textContent, /가격 정보 없음/);
  assert.doesNotMatch(h.slots.textContent, /₩|999,999|777,777/);
});
test('missing best, optional metadata and missing source date are honest empty fields', async () => {
  const h = harness(); h.buttons[0].click(); await settle(); const body = payload();
  body.best = null; body.card.set_name = {}; body.card.number = null; body.price_display.sourceDate = null;
  h.requests[0].resolve(body); await settle();
  assert.match(h.slots.textContent, /기준일 확인 불가/); assert.match(h.slots.textContent, /정보 없음/); assert.doesNotMatch(h.slots.textContent, /\[object Object\]/);
});
for (const code of [404, 503, 500, 429]) {
  test('HTTP ' + code + ' distinguishes absent metadata from temporary failure without retry', async () => {
    const h = harness(); h.buttons[0].click(); await settle(); h.requests[0].resolve({}, code); await settle();
    assert.match(h.slots.textContent, code === 404 ? /카드 정보를 찾지 못했습니다/ : /불러오지 못했습니다/);
    assert.equal(h.requests.length, 1); assert.equal(h.timers.size, 0);
  });
}
for (const mutate of [
  body => null, body => [], body => ({ ...body, card: null }), body => ({ ...body, card: { ...body.card, slug: 'different' } }),
  body => ({ ...body, card: { ...body.card, game: 'another-game' } }), body => ({ ...body, card: { ...body.card, name: {} } }),
  body => ({ ...body, price_display: undefined }), body => ({ ...body, price_display: { ...body.price_display, amountKrw: '1200' } }),
  body => ({ ...body, price_display: { ...body.price_display, amountKrw: 0 } }), body => ({ ...body, price_display: { ...body.price_display, amountKrw: Infinity } }),
  body => ({ ...body, price_display: { ...body.price_display, trustLevel: 'NONE' } }), body => ({ ...body, price_display: { ...body.price_display, basis: 'median30d' } }),
  body => ({ ...body, price_display: { ...body.price_display, sourceDate: '2026-10-12' } }),
  body => ({ ...body, price_display: { ...body.price_display, sourceDate: '2026-02-30T00:00:00Z' } }),
  body => ({ ...body, price_display: { ...body.price_display, sourceDate: undefined } }),
  body => ({ ...body, price_display: { ...body.price_display, label: {} } }),
]) {
  test('invalid 200 payload fails closed: ' + mutate.toString().slice(0, 100), async () => {
    const h = harness(); h.buttons[0].click(); await settle(); h.requests[0].resolve(mutate(payload())); await settle();
    assert.match(h.slots.textContent, /불러오지 못했습니다/); assert.doesNotMatch(h.slots.textContent, /찾지 못했습니다|₩/);
  });
}
test('malformed JSON and network failure are temporary failures', async () => {
  for (const kind of ['badJson', 'reject']) {
    const h = harness(); h.buttons[0].click(); await settle(); h.requests[0][kind](Error('private upstream detail')); await settle();
    assert.match(h.slots.textContent, /불러오지 못했습니다/); assert.doesNotMatch(h.slots.textContent, /private|찾지 못했습니다/);
  }
});
test('one six-second deadline covers both headers and body even when abort is ignored', async () => {
  for (const bodyHang of [false, true]) {
    const h = harness(); h.buttons[0].click(); await settle(); if (bodyHang) { h.requests[0].hangBody(); await settle(); }
    h.expire(); await settle(); assert.equal(h.requests[0].options.signal.aborted, true);
    assert.match(h.slots.textContent, /불러오지 못했습니다/); assert.equal(h.requests.length, 1);
  }
});
test('late results after remove, same-slug reselect and clear cannot resurrect stale cards', async () => {
  const h = harness(); h.buttons[0].click(); await settle(); const old = h.requests[0]; h.buttons[0].click(); h.buttons[0].click(); await settle();
  old.resolve({ ...payload(), card: { ...payload().card, name: 'STALE CARD' } }); await settle();
  assert.doesNotMatch(h.slots.textContent, /STALE CARD/); assert.match(h.slots.textContent, /확인하고 있습니다/);
  h.requests[1].resolve(); await settle(); assert.match(h.slots.textContent, /Test-only card/);
  h.buttons[1].click(); await settle(); h.clear.click(); h.requests[2].resolve(payload('test-only-b')); await settle();
  assert.doesNotMatch(h.slots.textContent, /Test-only card/); assert.equal(h.clear.disabled, true);
});
test('all untrusted metadata is text and card hrefs are encoded, without image or HTML insertion', async () => {
  const attack = '<img src=x onerror=alert(1)>', value = 'test-"unsafe';
  const h = harness({ slugs: [value] }); h.buttons[0].click(); await settle(); const body = payload(value);
  body.card.name = attack; body.card.name_ko = attack; body.card.set_name = attack; body.price_display.secondaryText = attack;
  h.requests[0].resolve(body); await settle();
  assert.match(h.slots.textContent, /<img src=x/); assert.equal(h.slots.all('img').length, 0); assert.equal(h.slots.all('script').length, 0);
  assert.equal(h.slots.all('a')[0].getAttribute('href'), '/cards/' + encodeURIComponent(value));
});
test('remove and clear are native buttons with focus restored to available controls', async () => {
  const h = harness(); h.buttons[0].click(); await settle(); const remove = h.slots.all('button')[0];
  assert.equal(remove.type, 'button'); assert.match(remove.getAttribute('aria-label'), /비교 선택 해제/);
  remove.click(); assert.equal(h.buttons[0].focused, true); assert.equal(h.buttons[0].getAttribute('aria-pressed'), 'false');
});
test('a second card response preserves focus on the first card remove button', async () => {
  const h = harness(); h.buttons[0].click(); h.buttons[1].click(); await settle();
  h.requests[0].resolve(); await settle(); h.slots.all('button')[0].focus();
  h.requests[1].resolve(payload('test-only-b')); await settle();
  assert.equal(h.slots.all('button')[0].focused, true);
});
test('a second card response preserves focus on the first card detail link', async () => {
  const h = harness(); h.buttons[0].click(); h.buttons[1].click(); await settle();
  h.requests[0].resolve(); await settle(); h.slots.all('a')[0].focus();
  h.requests[1].resolve(payload('test-only-b')); await settle();
  assert.equal(h.slots.all('a')[0].focused, true);
  assert.equal(h.slots.all('a')[0].getAttribute('data-cp-compare-detail'), 'test-only-a');
});
for (const noHeader of [false, true]) {
  test('stored selections without result buttons use ' + (noHeader ? 'heading' : 'header input') + ' focus fallback after remove and clear', async () => {
    const h = harness({ stored: ['test-only-a', 'test-only-b'], slugs: [], noHeader }); await settle();
    h.slots.all('button')[0].click(); h.slots.all('button')[0].click();
    assert.equal(h.clear.disabled, true); assert.equal((noHeader ? h.title : h.header).focused, true);
    if (noHeader) assert.equal(h.title.getAttribute('tabindex'), '-1');
    const cleared = harness({ stored: ['test-only-a', 'test-only-b'], slugs: [], noHeader }); await settle();
    cleared.clear.click(); assert.equal(cleared.clear.disabled, true);
    assert.equal((noHeader ? cleared.title : cleared.header).focused, true);
  });
}
test('search-only CSS preserves hidden controls, safe mobile wrapping, panel padding and keyboard focus', () => {
  const css = read('styles/card-compare.css');
  assert.match(css, /\.cp-card-compare\[hidden\],\.cp-compare-add\[hidden\]/);
  assert.match(css, /min-height:44px;min-width:44px/); assert.match(css, /:focus-visible\{outline:2px solid #26E0C2/);
  assert.match(css, /@media\(max-width:768px\)/); assert.match(css, /padding:20px 16px/);
  assert.doesNotMatch(css, /\.tool-link|\.guide-card|body\s*\{|overflow[^;]*hidden|outline:none|content-visibility/);
});
test('comparison has no analytics, raw price fallbacks, language inference or outbound assets', () => {
  assert.doesNotMatch(source, /innerHTML|latest_krw|latest_usd|cardmarket|\.variants|localStorage|gtag|search-log|request-update|https?:\/\/|createElement\(['"]img/);
  assert.match(source, /method: 'GET'/); assert.match(source, /sessionStorage\.setItem\(KEY, JSON\.stringify\(selected\)\)/);
  const tools = read('tools.html');
  assert.equal(tools.split('href="/search#card-compare"').length - 1, 1);
  assert.equal((tools.match(/<article class="tool-card ready"/g) || []).length, 13);
});

test('comparison shortcut hides with zero selections and reports one or two without extra reads', async () => {
  const h = harness(); await settle();
  assert.equal(h.shortcut.hidden, true); assert.equal(h.shortcutCount.textContent, '0/2장 선택');
  h.header.focus(); h.buttons[0].click(); await settle();
  assert.equal(h.context.document.activeElement, h.header, 'selection never moves focus or scrolls');
  assert.equal(h.shortcut.hidden, false); assert.equal(h.shortcutCount.textContent, '1/2장 선택');
  assert.equal(h.shortcutLink.getAttribute('href'), '#card-compare');
  h.buttons[1].click(); await settle();
  assert.equal(h.shortcutCount.textContent, '2/2장 선택');
  assert.equal(h.shortcutLink.getAttribute('aria-label'), '선택한 카드 2장 비교 보기');
  assert.equal(h.requests.length, 2); assert.equal(h.title.focused, undefined);
  h.buttons[2].click(); assert.equal(h.shortcutCount.textContent, '2/2장 선택');
  h.clear.click(); assert.equal(h.shortcut.hidden, true); assert.equal(h.shortcutCount.textContent, '0/2장 선택');
});
test('restored selections expose the shortcut and cached markup without it still works', async () => {
  const h = harness({ stored: ['test-only-a', 'test-only-b'] }); await settle();
  assert.equal(h.shortcut.hidden, false); assert.equal(h.shortcutCount.textContent, '2/2장 선택'); assert.equal(h.requests.length, 2);
  const legacy = harness({ stored: ['test-only-a'], noShortcut: true }); await settle();
  legacy.requests[0].resolve(); await settle(); assert.match(legacy.slots.textContent, /Test-only card/); assert.equal(legacy.requests.length, 1);
});
test('explicit native fragment activation focuses only the comparison heading after navigation', async () => {
  const h = harness({ stored: ['test-only-a', 'test-only-b'] }); await settle();
  h.shortcutLink.focus(); const event = h.shortcutLink.click();
  assert.equal(event.defaultPrevented, false, 'native fragment URL/history are not rewritten');
  assert.equal(h.title.focused, undefined);
  h.body.focus(); h.flushJump();
  assert.equal(h.context.document.activeElement, h.title); assert.equal(h.title.getAttribute('tabindex'), '-1');
  assert.equal(h.title.focusOptions.preventScroll, true); assert.equal(h.requests.length, 2);
  assert.equal(h.shortcutLink.getAttribute('href'), '#card-compare');
});
for (const modified of [{ ctrlKey: true }, { metaKey: true }, { shiftKey: true }, { altKey: true }, { button: 1 }, { button: 2 }, { defaultPrevented: true }]) {
  test('comparison shortcut preserves modified/native navigation ' + JSON.stringify(modified), async () => {
    const h = harness({ stored: ['test-only-a'] }); await settle(); h.shortcutLink.focus();
    h.shortcutLink.click(modified); h.flushJump();
    assert.equal(h.context.document.activeElement, h.shortcutLink); assert.equal(h.title.focused, undefined);
    assert.equal(h.requests.length, 1); assert.equal([...h.timers.values()].filter(row => row.ms === 0).length, 0);
  });
}
test('shortcut with no selection or a later user focus change cannot steal focus', async () => {
  const empty = harness(); empty.shortcutLink.click(); empty.flushJump(); assert.equal(empty.title.focused, undefined);
  const h = harness({ stored: ['test-only-a'] }); await settle(); h.shortcutLink.focus(); h.shortcutLink.click();
  h.header.focus(); h.flushJump(); assert.equal(h.context.document.activeElement, h.header); assert.equal(h.title.focused, undefined);
});
test('remove and clear cancel pending shortcut focus and retain their existing fallback', async () => {
  for (const action of ['remove', 'clear']) {
    const h = harness({ stored: ['test-only-a'] }); await settle(); h.shortcutLink.focus(); h.shortcutLink.click();
    if (action === 'remove') h.slots.all('button')[0].click(); else h.clear.click();
    h.flushJump(); assert.equal(h.title.focused, undefined); assert.equal(h.context.document.activeElement, h.buttons[0]);
    assert.equal(h.shortcut.hidden, true); assert.equal(h.requests.length, 1);
  }
});
test('one live status distinguishes loading, partial readiness and complete readiness', async () => {
  const h = harness(); h.buttons[0].click(); h.buttons[1].click(); await settle();
  assert.match(h.status.textContent, /2장 정보를 확인하고 있습니다/); assert.doesNotMatch(h.status.textContent, /정보를 확인했습니다|가격의 산출 기준/);
  h.requests[0].resolve(); await settle();
  assert.match(h.status.textContent, /1장 정보를 확인하고 있습니다/); assert.match(h.status.textContent, /1장 정보를 확인했습니다/);
  assert.doesNotMatch(h.status.textContent, /가격의 산출 기준/);
  h.requests[1].resolve(payload('test-only-b')); await settle();
  assert.match(h.status.textContent, /2장 정보를 확인했습니다/); assert.match(h.status.textContent, /가격의 산출 기준/);
  assert.doesNotMatch(h.status.textContent, /확인하고 있습니다|불러오지 못했습니다/);
  assert.equal(h.shortcut.getAttribute('aria-live'), null); assert.equal(h.shortcutCount.getAttribute('aria-live'), null);
  assert.equal(h.requests.length, 2);
});
for (const code of [404, 503, 500, 429]) {
  test('live status reports the actual HTTP failure class ' + code, async () => {
    const h = harness(); h.buttons[0].click(); await settle(); h.requests[0].resolve({}, code); await settle();
    assert.match(h.status.textContent, code === 404 ? /1장의 카드 정보를 찾지 못했습니다/ : /1장 정보를 불러오지 못했습니다/);
    if (code === 503) assert.match(h.status.textContent, /서비스를 일시적으로 이용할 수 없습니다/);
    if (code !== 503) assert.doesNotMatch(h.status.textContent, /서비스를 일시적으로 이용할 수 없습니다/);
    assert.doesNotMatch(h.status.textContent, /정보를 확인했습니다|가격의 산출 기준/);
    assert.equal(h.requests.length, 1); assert.equal(h.timers.size, 0);
  });
}
test('deadline failures are announced as timeout for headers or body without retries', async () => {
  for (const hangBody of [false, true]) {
    const h = harness(); h.buttons[0].click(); await settle(); if (hangBody) { h.requests[0].hangBody(); await settle(); }
    h.expire(); await settle(); assert.match(h.status.textContent, /응답 시간이 초과되었습니다/);
    assert.match(h.slots.textContent, /응답 시간이 초과되었습니다/); assert.equal(h.requests.length, 1);
    assert.doesNotMatch(h.status.textContent, /정보를 확인했습니다|가격의 산출 기준/);
  }
});
test('mixed success and failure is announced as partial and stale errors disappear after removal', async () => {
  const h = harness(); h.buttons[0].click(); h.buttons[1].click(); await settle();
  h.requests[0].resolve(); h.requests[1].resolve({}, 503); await settle();
  assert.match(h.status.textContent, /일부 카드 정보를 확인하지 못했습니다/);
  assert.match(h.status.textContent, /1장 정보를 확인했습니다/); assert.match(h.status.textContent, /서비스를 일시적으로/);
  assert.doesNotMatch(h.status.textContent, /가격의 산출 기준/); assert.equal(h.requests.length, 2);
  h.buttons[1].click(); assert.match(h.status.textContent, /비교할 카드 한 장을 더 선택/);
  assert.doesNotMatch(h.status.textContent, /일부|서비스|불러오지 못했습니다/);
});
test('network and malformed contract failures announce no private details or invented cause', async () => {
  for (const fail of [request => request.reject(Error('private-only cause')), request => request.badJson(), request => request.resolve({})]) {
    const h = harness(); h.buttons[0].click(); await settle(); fail(h.requests[0]); await settle();
    assert.match(h.status.textContent, /불러오지 못했습니다/);
    assert.doesNotMatch(h.status.textContent, /private|서비스를 일시적으로|응답 시간이 초과|카드 정보를 찾지/);
  }
});
test('shortcut styling is in-flow, touch-safe, hidden-safe and offset from the existing sticky header', () => {
  const css = read('styles/card-compare.css');
  assert.match(css, /\.cp-compare-shortcut\{display:flex/); assert.match(css, /\.cp-compare-shortcut\[hidden\]/);
  assert.match(css, /\.cp-compare-shortcut a\{[^}]*min-height:44px;min-width:44px/);
  assert.match(css, /\.cp-card-compare,#card-compare-title\{scroll-margin-top:80px\}/);
  assert.match(css, /@media\(max-width:640px\)\{\.cp-card-compare,#card-compare-title\{scroll-margin-top:144px\}\}/);
  assert.doesNotMatch(css, /position:\s*(?:fixed|sticky|absolute)/);
  assert.doesNotMatch(source, /scrollIntoView|scrollTo|location\.hash|history\.(?:pushState|replaceState)/);
});
