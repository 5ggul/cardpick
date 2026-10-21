#!/usr/bin/env node
// Run the two real inline consumers with isolated storage and DOM fixtures.
// Test-only values never reach a browser, a provider or a production database.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const KEY = 'cardpick:recently_viewed';
const root = new URL('../', import.meta.url);
const pages = {
  home: { file:'index.html', marker:'(function homeRecentlyViewed()', section:'home-recently-viewed', list:'home-rv-list', clear:'home-rv-clear', remove:'data-hrv-remove', limit:5 },
  card: { file:'card-detail.html', marker:'(function recentlyViewed()', section:'recently-viewed-section', list:'recently-viewed-list', clear:'rv-clear-btn', remove:'data-rv-remove', limit:6 },
};
const sources = Object.fromEntries(Object.entries(pages).map(([kind, page]) => {
  const html = readFileSync(new URL(page.file, root), 'utf8');
  const matches = [...html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/g)].filter(match => match[1].includes(page.marker));
  assert.equal(matches.length, 1, `${page.file} exposes exactly one recent-history script`);
  return [kind, matches[0][1]];
}));
const legacy = (slug = 'fixture-old-1', extra = {}) => ({
  slug, name:'Test-only name', name_ko:'검증용 카드', set_name:'Test-only set', number:'1', rarity:'Rare',
  krw:1234, viewed_at:'2026-10-18T10:00:00.000Z', ...extra,
});
const display = (extra = {}) => ({ amountKrw:4567, basis:'median30d', trustLevel:'MEDIUM', sourceDate:'2026-10-17T03:00:00.000Z', ...extra });

function harness(kind, { records = [], raw, current = null, price = null, best = {}, denied = false, writeDenied = false, confirm = true, readyState = 'loading' } = {}) {
  const page = pages[kind];
  const storage = new Map([[KEY, raw === undefined ? JSON.stringify(records) : raw]]);
  const writes = [];
  const handlers = new Map();
  const section = { style:{} };
  const clear = { listeners:new Map(), addEventListener(name, callback){ this.listeners.set(name, callback); } };
  const list = {
    html:'', buttons:[],
    set innerHTML(value){
      this.html = value;
      this.buttons = [...value.matchAll(new RegExp(`${page.remove}="([^"]*)"`, 'g'))].map(match => ({
        slug:match[1].replace(/&quot;/g,'"').replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&amp;/g,'&'),
        listeners:new Map(), addEventListener(name, callback){ this.listeners.set(name, callback); }, getAttribute(){ return this.slug; },
      }));
    },
    get innerHTML(){ return this.html; },
    querySelectorAll(selector){ assert.equal(selector, `[${page.remove}]`); return this.buttons; },
  };
  const nodes = new Map([[page.section, section], [page.list, list], [page.clear, clear]]);
  const context = {
    window:{ CARDPICK_CARD:current, CARDPICK_PRICE_DISPLAY:price, CARDPICK_BEST:best },
    document:{ readyState, getElementById:id => nodes.get(id) || null, addEventListener(name, callback){
      if (!handlers.has(name)) handlers.set(name, []); handlers.get(name).push(callback);
    } },
    location:{ pathname:kind === 'card' ? '/cards/fixture-current-2' : '/' },
    localStorage:{
      getItem(key){ assert.equal(key, KEY); if (denied) throw new Error('storage denied'); return storage.get(key) ?? null; },
      setItem(key, value){ assert.equal(key, KEY); if (denied || writeDenied) throw new Error('storage denied'); writes.push(value); storage.set(key, value); },
    },
    confirm:message => { assert.equal(message,'최근 본 카드 기록을 전체 삭제할까요?'); return confirm; },
    fetch:() => assert.fail('recent-history consumers must not fetch'),
    console,
  };
  vm.runInNewContext(sources[kind], context);
  if (readyState === 'loading') for (const callback of handlers.get('DOMContentLoaded') || []) callback();
  return {
    storage, writes, section, list, context,
    records:() => JSON.parse(storage.get(KEY)),
    remove(index = 0){ list.buttons[index].listeners.get('click')({ preventDefault(){}, stopPropagation(){} }); },
    clear(){ clear.listeners.get('click')(); },
  };
}

for (const kind of Object.keys(pages)) {
  for (const raw of ['null', '{}', '42', '"string"', '{broken']) {
    test(`${kind}: malformed storage root ${raw} stays harmless and is not reset by rendering`, () => {
      const client = harness(kind, { raw });
      assert.equal(client.section.style.display, 'none');
      assert.equal(client.writes.length, 0);
      assert.equal(client.storage.get(KEY), raw);
    });
  }
  test(`${kind}: malformed rows cannot hide a valid legacy row or throw in rarity rendering`, () => {
    const client = harness(kind, { records:[null, [], {}, { slug:'bad/path', name:'bad' }, { slug:'bad-name', name:{} }, legacy('fixture-kept', { set_name:{}, rarity:42, name_ko:[], number:null })] });
    assert.equal(client.section.style.display, 'block');
    assert.equal(client.list.buttons.length, 1);
    assert.match(client.list.html, /fixture-kept/);
    assert.doesNotMatch(client.list.html, /\[object Object\]/);
    assert.equal(client.writes.length, 0, 'merely reading history does not rewrite user storage');
  });
  test(`${kind}: legacy amount is explicitly historical and never uses viewed_at as the price date`, () => {
    const client = harness(kind, { records:[legacy()] });
    assert.match(client.list.html, /확인 당시 참고가/);
    assert.match(client.list.html, /₩1,234/);
    assert.match(client.list.html, /가격 기준일 미기록 · 산출 기준 미기록/);
    assert.doesNotMatch(client.list.html, /2026[.-]10[.-]18/);
    assert.deepEqual(client.records(), [legacy()]);
  });
  test(`${kind}: path-dot records cannot resolve outside the card detail route`, () => {
    const client=harness(kind,{records:[legacy('.'),legacy('..'),legacy()]});
    assert.doesNotMatch(client.list.html,/href="\/cards\/\.{1,2}"/);
    assert.match(client.list.html,/fixture-old-1/);
    assert.equal(client.writes.length,0);
  });
  test(`${kind}: narrow rows can wrap without collapsing the card name or splitting price from delete`, () => {
    const client = harness(kind, { records:[legacy()] });
    assert.match(client.list.html, /<li style="display:flex;flex-wrap:wrap;align-items:center;gap:14px;padding:(?:12|13)px 16px;/);
    assert.match(client.list.html, /<a href="\/cards\/fixture-old-1" style="flex:1 1 120px;min-width:0;/);
    assert.match(client.list.html, /<span style="display:inline-flex;align-items:center;gap:14px;margin-left:auto"><span[^>]*>[\s\S]*?₩1,234<\/span><button[^>]*data-(?:h)?rv-remove="fixture-old-1"/);
    assert.equal(client.records()[0].krw, 1234, 'responsive wrapping must not change the stored amount');
    assert.equal(client.writes.length, 0);
  });
  test(`${kind}: snapshot basis and source date display separately from the view date`, () => {
    const client = harness(kind, { records:[legacy('fixture-medium', { price_basis:'median30d', price_source_date:'2026-10-17T03:00:00Z', price_trust_level:'MEDIUM' }), legacy('fixture-low', { price_basis:'median30d', price_source_date:'2026-10-16T03:00:00Z', price_trust_level:'LOW' }), legacy('fixture-high', { price_basis:'latest', price_source_date:'2026-10-15T03:00:00Z', price_trust_level:'HIGH' })] });
    assert.match(client.list.html, /가격 기준일 2026\.10\.17 · 30일 중앙값/);
    assert.match(client.list.html, /가격 기준일 2026\.10\.16 · 30일 중앙값 · 표본 부족/);
    assert.match(client.list.html, /가격 기준일 2026\.10\.15 · 해외 참고가/);
    assert.doesNotMatch(client.list.html, /2026\.10\.18/);
  });
  test(`${kind}: invalid amount, date and inconsistent basis metadata fail closed`, () => {
    const records = [legacy('fixture-invalid-amount', { krw:'1234' }), legacy('fixture-invalid-date', { price_basis:'latest', price_trust_level:'HIGH', price_source_date:'2026-02-30T00:00:00Z' }), legacy('fixture-invalid-basis', { price_basis:'latest', price_trust_level:'NONE', price_source_date:'2026-10-17T00:00:00Z' })];
    const client = harness(kind, { records });
    assert.match(client.list.html, /가격 (?:정보 )?없음/);
    assert.doesNotMatch(client.list.html, /2026\.02\.30|2026\.10\.17/);
    assert.match(client.list.html, /산출 기준 미기록/);
    assert.equal(client.writes.length, 0);
  });
  test(`${kind}: storage denial and quota errors do not break page initialization`, () => {
    assert.doesNotThrow(() => harness(kind, { denied:true, current:{ slug:'fixture-current-2', name:'Test-only current' }, price:display() }));
    const client = harness(kind, { records:[legacy()], current:kind === 'card' ? { slug:'fixture-current-2', name:'Test-only current' } : null, price:display(), writeDenied:true });
    assert.match(client.list.html, /fixture-old-1/);
    client.remove();
    client.clear();
    assert.equal(client.writes.length, 0);
  });
  test(`${kind}: row limits, duplicate suppression and normal legacy deletion remain usable`, () => {
    const records = [legacy('fixture-old-1'), legacy('fixture-old-1'), ...Array.from({ length:24 }, (_, index) => legacy(`fixture-${index}`))];
    const client = harness(kind, { records });
    assert.equal(client.list.buttons.length, pages[kind].limit);
    client.remove();
    assert.ok(client.records().every(record => record.slug !== 'fixture-old-1'));
    assert.equal(client.records().length, 19);
    assert.equal(client.records()[0].krw, 1234);
    client.clear();
    assert.deepEqual(client.records(), []);
    assert.equal(client.section.style.display, 'none');
  });
  test(`${kind}: clear confirmation cancellation preserves all existing records`, () => {
    const client = harness(kind, { records:[legacy()], confirm:false });
    client.clear();
    assert.equal(client.writes.length, 0);
    assert.deepEqual(client.records(), [legacy()]);
  });
  test(`${kind}: text and attribute escaping remain effective`, () => {
    const client = harness(kind, { records:[legacy('fixture-"quoted', { name:'<img src=x onerror=alert(1)>', name_ko:'"<script>evil</script>', set_name:'&danger', rarity:'<bad>' })] });
    assert.doesNotMatch(client.list.html, /<img|<script>|<bad>/);
    assert.match(client.list.html, /&lt;img/);
    assert.match(client.list.html, /\/cards\/fixture-%22quoted/);
    client.remove();
    assert.deepEqual(client.records(), []);
  });
}

test('card: current snapshot retains the Trust Gate amount and original price date, not raw latest_krw', () => {
  const client = harness('card', { records:[legacy()], current:{ slug:'fixture-current-2', name:'Test-only current', number:'2', rarity_class:'IR' }, price:display(), best:{ latest_krw:99999 } });
  const [current, old] = client.records();
  assert.equal(current.krw, 4567);
  assert.equal(current.price_basis, 'median30d');
  assert.equal(current.price_trust_level, 'MEDIUM');
  assert.equal(current.price_source_date, '2026-10-17T03:00:00.000Z');
  assert.ok(Number.isFinite(Date.parse(current.viewed_at)));
  assert.notEqual(current.price_source_date, current.viewed_at);
  assert.equal(old.slug, 'fixture-old-1');
  assert.equal(old.krw, 1234);
  assert.equal(client.writes.length, 1);
  assert.doesNotMatch(client.list.html, /fixture-current-2/);
});

for (const price of [null, display({ basis:'unavailable', amountKrw:null, trustLevel:'NONE' }), display({ basis:'latest', trustLevel:'NONE' }), display({ amountKrw:0 }), display({ amountKrw:-1 }), display({ amountKrw:1.5 }), display({ amountKrw:Number.MAX_SAFE_INTEGER + 1 })]) {
  test(`card: unavailable or invalid contract cannot fall back to raw price (${JSON.stringify(price)})`, () => {
    const client = harness('card', { current:{ slug:'fixture-current-2', name:'Test-only current' }, price, best:{ latest_krw:99999 } });
    assert.equal(client.records()[0].krw, null);
    assert.equal(client.records()[0].price_basis, null);
    assert.equal(client.records()[0].price_source_date, null);
  });
}

test('card: tracking a repeated current card deduplicates, preserves twenty records and tolerates missing source date', () => {
  const client = harness('card', { records:Array.from({ length:25 }, (_, index) => legacy(`fixture-${index}`)), current:{ slug:'fixture-2', name:'Current same card' }, price:display({ sourceDate:undefined }), readyState:'complete' });
  assert.equal(client.records().length, 20);
  assert.equal(client.records().filter(record => record.slug === 'fixture-2').length, 1);
  assert.equal(client.records()[0].price_source_date, null);
  assert.equal(client.records()[0].krw, 4567);
  assert.equal(client.writes.length, 1);
});
