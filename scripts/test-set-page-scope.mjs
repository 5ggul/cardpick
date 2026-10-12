#!/usr/bin/env node
// Isolated test fixtures only: no live provider, DB, cache, or production writes.
import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import vm from 'node:vm';

const source = readFileSync(new URL('../functions/sets/[code].js', import.meta.url), 'utf8');
const executable = source.replace('export async function onRequest', 'async function onRequest') + '\nthis.handler = onRequest;';

function card(number, extra = {}) {
  return {
    slug: `fixture-card-${number}`, name: `TEST FIXTURE ${number}`, name_ko: null,
    number: String(number), rarity: 'Fixture rare', set_code: 'TST',
    set_name: 'Isolated test set', set_id: 'fixture-set', ...extra,
  };
}

function trust(price, level = 'HIGH') {
  return { trust_level: level, display_krw: price, latest_krw: 99999999, distinct_7d: 7, distinct_30d: 30 };
}

async function invoke({ cards = [card(1)], prices = {}, code = 'TST', cached = null } = {}) {
  const calls = [], cacheKeys = [], writes = [], pending = [];
  const sandbox = {
    Request, Response, Headers,
    caches: { default: {
      match: async key => { cacheKeys.push(key.url); return cached?.clone(); },
      put: async (key, response) => { writes.push({ key: key.url, response }); },
    } },
    fetch: async input => {
      const url = new URL(input);
      calls.push(url);
      assert.equal(url.protocol, 'https:');
      assert.equal(url.hostname, 'aqxrmdratnkffvivguqs.supabase.co');
      if (url.pathname === '/rest/v1/cards') {
        assert.equal(url.searchParams.get('game'), 'eq.pokemon');
        assert.equal(url.searchParams.get('limit'), '1000');
        assert.equal(url.searchParams.get('set_code'), `eq.${code.toUpperCase().trim().replace(/[^A-Z0-9-]/g, '')}`);
        return Response.json(cards);
      }
      assert.equal(url.pathname, '/rest/v1/card_price_trust');
      assert.equal(url.searchParams.get('limit'), '1');
      const slug = url.searchParams.get('card_slug').slice(3);
      const value = prices[slug];
      if (value instanceof Error) throw value;
      if (value === 'http-error') return new Response('unavailable', { status: 503 });
      return Response.json(value ? [value] : []);
    },
  };
  vm.runInNewContext(executable, sandbox);
  const response = await sandbox.handler({ params: { code }, waitUntil: promise => pending.push(promise) });
  await Promise.all(pending);
  const html = await response.text();
  return { response, html, calls, cacheKeys, writes };
}

function sampleCalls(result) {
  return result.calls.filter(url => url.pathname.endsWith('/card_price_trust'));
}

function rows(result) {
  return result.html.match(/<tbody>([\s\S]*?)<\/tbody>/)?.[1] || '';
}

function metadata(result) {
  return JSON.parse(result.html.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/)[1]);
}

test('41 registrations remain separate from the 40 queried price candidates', async () => {
  const cards = Array.from({ length: 41 }, (_, i) => card(i + 1));
  const prices = Object.fromEntries(cards.map(c => [c.slug, trust(Number(c.number) * 100)]));
  prices['fixture-card-41'] = trust(90000000);
  const result = await invoke({ cards, prices });
  assert.equal(result.response.status, 200);
  assert.equal(result.calls.length, 41);
  assert.equal(sampleCalls(result).length, 40);
  assert.equal(result.response.headers.get('X-Set-Total-Cards'), '41');
  assert.equal(result.response.headers.get('X-Set-High-Cards'), '40');
  assert.equal(result.response.headers.get('X-Set-Count-Scope'), 'catalog-fetch');
  assert.equal(result.response.headers.get('X-Set-Price-Scope'), 'sample');
  assert.equal(result.response.headers.get('X-Set-Price-Sample-Size'), '40');
  assert.match(result.html, /카드픽 조회 항목 41개/);
  assert.match(result.html, /가격 확인 대상 40개 기준/);
  assert.match(result.html, /표본에서 확인한 참고가 순 20개/);
  assert.match(result.html, /이 목록에서 확인한 가장 높은 참고가는/);
  assert.match(result.html, /세트 전체의 최고가를 뜻하지 않으며/);
  assert.ok(!sampleCalls(result).some(url => url.searchParams.get('card_slug') === 'eq.fixture-card-41'));
  assert.match(rows(result), /TEST FIXTURE 40/);
  assert.doesNotMatch(rows(result), /TEST FIXTURE 41|₩90,000,000|₩99,999,999/);
  assert.ok(rows(result).indexOf('/cards/fixture-card-40') < rows(result).indexOf('/cards/fixture-card-39'));
  assert.equal((rows(result).match(/<tr>/g) || []).length, 20);
  assert.doesNotMatch(result.html, /세트 전체 카드 수|참고가 표시 가능 40장|총 41장|이 세트의 가장 비싼 카드/);
});

test('H+M trust counts are not described as cards with a displayable price', async () => {
  const result = await invoke({
    cards: [card(1), card(2), card(3)],
    prices: { 'fixture-card-1': trust(null), 'fixture-card-2': trust(4300, 'MEDIUM'), 'fixture-card-3': trust(null, 'LOW') },
  });
  assert.equal(result.response.headers.get('X-Set-High-Cards'), '2');
  assert.equal(result.response.headers.get('X-Set-With-Price'), '1');
  assert.match(result.html, /가격 확인 대상 3개 중 신뢰도 HIGH·MEDIUM 2개/);
  assert.match(result.html, /표본에서 확인한 참고가 순 1개/);
  assert.doesNotMatch(rows(result), /TEST FIXTURE 1|TEST FIXTURE 3|₩99,999,999/);
  assert.match(rows(result), /₩4,300/);
  const collection = metadata(result)['@graph'].find(item => item['@type'] === 'CollectionPage');
  const metaDescription = result.html.match(/<meta name="description" content="([^"]*)">/)[1];
  assert.equal(collection.description, metaDescription);
  assert.equal(collection.url, 'https://cardpick.kr/sets/TST');
});

test('unpriced samples keep number-order links without inventing a most expensive card', async () => {
  const result = await invoke({ cards: [card(3), card(1), card(2)] });
  assert.match(result.html, /조회 항목 3개 \(번호순\)/);
  assert.match(result.html, /조회 표본에서 참고가를 확인하지 못했습니다\. 세트 전체의 가격 유무를 뜻하지 않습니다\./);
  assert.doesNotMatch(result.html, /현재 가장 높은 참고가는|조회 표본에서 가장 높은 참고가는|이 세트에는 아직 참고가 표시 가능한 카드가 없습니다/);
  assert.ok(rows(result).indexOf('/cards/fixture-card-1') < rows(result).indexOf('/cards/fixture-card-2'));
  assert.ok(rows(result).indexOf('/cards/fixture-card-2') < rows(result).indexOf('/cards/fixture-card-3'));
  assert.doesNotMatch(rows(result), /₩/);
});

test('HTTP and rejected trust reads never become a claim of no prices in the entire set', async () => {
  const result = await invoke({
    cards: [card(1), card(2), card(3)],
    prices: { 'fixture-card-1': 'http-error', 'fixture-card-2': new Error('isolated fixture failure') },
  });
  assert.equal(result.response.status, 200);
  assert.equal(sampleCalls(result).length, 3);
  assert.match(result.html, /세트 전체의 가격 유무를 뜻하지 않습니다/);
  assert.doesNotMatch(result.html, /isolated fixture failure|세트에는.*카드가 없습니다/);
});

test('registration-only variants do not pretend that all registered rows were price-checked', async () => {
  const result = await invoke({ cards: [card(1, { name: 'TEST FIXTURE (variant)' })] });
  assert.equal(sampleCalls(result).length, 0);
  assert.equal(result.response.headers.get('X-Set-Total-Cards'), '1');
  assert.equal(result.response.headers.get('X-Set-Price-Sample-Size'), '0');
  assert.match(result.html, /가격 확인 대상 0개 기준/);
  assert.match(result.html, /표시할 조회 항목이 없습니다/);
  assert.match(result.html, /가공·변형 항목이 포함될 수 있고 한 번에 최대 1,000개를 조회합니다/);
});

for (const size of [100, 1000]) {
  test(`${size} fetched registrations never expand the 40-request trust limit`, async () => {
    const cards = Array.from({ length: size }, (_, i) => card(i + 1));
    const before = JSON.stringify(cards);
    const result = await invoke({ cards });
    assert.equal(result.calls.length, 41);
    assert.equal(sampleCalls(result).length, 40);
    assert.equal(result.response.headers.get('X-Set-Total-Cards'), String(size));
    assert.match(result.html, new RegExp(`카드픽 조회 항목 ${size}개`));
    assert.match(result.html, /공식 카드 총수를 뜻하지 않습니다/);
    assert.equal(JSON.stringify(cards), before);
  });
}

test('ordinary HTML values stay escaped and JSON-LD stays parseable', async () => {
  const name = 'Fixture <name> & "quoted"';
  const result = await invoke({ cards: [card(1, { set_name: name, name })], prices: { 'fixture-card-1': trust(1000) } });
  assert.match(result.html, /Fixture &lt;name&gt; &amp; &quot;quoted&quot;/);
  assert.equal(metadata(result)['@graph'].find(item => item['@type'] === 'CollectionPage').name, `${name} (TST)`);
  assert.match(rows(result), /Fixture &lt;name&gt; &amp; &quot;quoted&quot;/);
});

test('canonical, robots, pre-existing styles, ad footprint and cache TTL remain unchanged', async () => {
  const result = await invoke();
  assert.match(result.html, /<link rel="canonical" href="https:\/\/cardpick.kr\/sets\/TST">/);
  assert.match(result.html, /<meta name="robots" content="index,follow,max-image-preview:large,max-snippet:-1">/);
  let style = result.html.match(/<style>([\s\S]*?)<\/style>/)[1].replace(/\r\n/g, '\n');
  const approvedAddedStyles = [
    '.grid-2>div{min-width:0}',
    '.top-cards-scroll{max-width:100%;overflow-x:auto}',
    '.top-cards-scroll:focus-visible{outline:2px solid var(--up);outline-offset:4px}',
    '.faq-a a{text-decoration:underline;text-underline-offset:3px}',
    '@media(max-width:360px){.cp-brand{flex:none;white-space:nowrap}.cp-brand .cp-en{display:none}}',
  ];
  for (const rule of approvedAddedStyles) {
    assert.equal(style.split(rule).length - 1, 1, 'only exact approved mobile scroll and link rules are excluded');
    style = style.replace(rule + '\n', '');
  }
  const approvedStatStyle = '.stat .sub{font-size:11.5px;color:var(--sub);font-family:var(--mono);margin-top:4px}';
  assert.equal(style.split(approvedStatStyle).length - 1, 1);
  style = style.replace(approvedStatStyle, approvedStatStyle.replace('color:var(--sub)', 'color:var(--dim)'));
  assert.equal(createHash('sha256').update(style).digest('hex'), 'ba13973e536305148c32fa3897b97248f61bbacc895e6e20f631f7ab0b1019c3');
  assert.doesNotMatch(result.html, /adsbygoogle|pagead2\.googlesyndication/);
  assert.equal(result.response.headers.get('Cache-Control'), 'public, max-age=3600');
  assert.equal(result.writes.length, 1);
  assert.match(result.cacheKeys[0], /__set_ssr_v16_sample_scope_TST$/);
});

test('local font CSS reuses existing licensed faces without changing families or font binaries', async () => {
  const result = await invoke();
  for (const path of ['/styles/releases-fonts.css', '/styles/set-fonts.css']) {
    const deferredLink = `<link rel="stylesheet" href="${path}" media="print" onload="this.media='all'">`;
    assert.equal(result.html.split(deferredLink).length - 1, 1);
    const link = { media: 'print' };
    const actualLink = result.html.match(/<link\b[^>]*>/g).find(tag => tag.includes(`href="${path}"`) && tag.includes('media="print"'));
    const onload = actualLink.match(/onload="([^"]+)"/)[1];
    vm.runInNewContext(`(function(){${onload}}).call(link)`, { link }, { timeout: 1000 });
    assert.equal(link.media, 'all', 'each stylesheet activates after loading without a delay timer');
  }
  assert.match(result.html, /<noscript><link rel="stylesheet" href="\/styles\/releases-fonts\.css"><link rel="stylesheet" href="\/styles\/set-fonts\.css"><\/noscript>/);
  assert.doesNotMatch(result.html, /<link rel="stylesheet"[^>]+href="https:\/\/(?:fonts\.googleapis\.com|cdn\.jsdelivr\.net)/);
  assert.match(result.html, /font-family:Pretendard,system-ui,sans-serif/);
  assert.match(result.html, /--mono:'IBM Plex Mono',ui-monospace,monospace/);
  const localCss = readFileSync(new URL('../styles/set-fonts.css', import.meta.url), 'utf8');
  const existingCss = readFileSync(new URL('../styles/releases-base.css', import.meta.url), 'utf8');
  const facePattern = /@font-face\{font-family:IBM Plex Mono;[^}]+\}/g;
  const expectedFaces = existingCss.match(facePattern).map(face => face.replace('font-display:swap', 'font-display:optional'));
  const actualFaces = localCss.match(facePattern);
  assert.equal(actualFaces.length, 15);
  assert.deepEqual(actualFaces, expectedFaces, 'only font-display changes; source weights, files and Unicode ranges stay exact');
  assert.equal(localCss.replace(/\/\*[\s\S]*?\*\//g, '').replace(facePattern, '').trim(), '', 'font CSS must not contain layout rules or imports');
  for (const url of localCss.matchAll(/src:url\(([^)]+)\)/g)) {
    assert.match(url[1], /^\/fonts\/ibm-plex-mono\/[-A-Za-z0-9]+\.woff2$/);
    assert.ok(existsSync(new URL('..' + url[1], import.meta.url)));
  }
  assert.match(readFileSync(new URL('../fonts/ibm-plex-mono/OFL.txt', import.meta.url), 'utf8'), /SIL OPEN FONT LICENSE/);
});

test('narrow header keeps the Korean brand and login accessible without shrinking the brand', async () => {
  const result = await invoke();
  assert.match(result.html, /@media\(max-width:360px\)\{\.cp-brand\{flex:none;white-space:nowrap\}\.cp-brand \.cp-en\{display:none\}\}/);
  assert.match(result.html, /<a href="\/" class="cp-brand"><img src="\/logo-sm\.png" alt="카드픽" width="28" height="28"><span class="cp-name">카드픽<\/span><span class="cp-en">CARDPICK<\/span><\/a>/);
  assert.match(result.html, /<button type="button" class="cp-login-google" aria-label="Google로 로그인">/);
});

test('stat help text meets normal-text contrast and FAQ links are not identified by color alone', async () => {
  const result = await invoke();
  const style = result.html.match(/<style>([\s\S]*?)<\/style>/)[1];
  const statStyle = style.match(/\.stat \.sub\{([^}]+)\}/)[1];
  assert.match(statStyle, /color:var\(--sub\)/);
  const foreground = style.match(/--sub:(#[0-9A-Fa-f]{6})/)[1];
  const background = style.match(/--panel:(#[0-9A-Fa-f]{6})/)[1];
  function luminance(hex) {
    const channels = hex.slice(1).match(/../g).map(part => parseInt(part, 16) / 255);
    const linear = channels.map(channel => channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4);
    return linear[0] * 0.2126 + linear[1] * 0.7152 + linear[2] * 0.0722;
  }
  const light = Math.max(luminance(foreground), luminance(background));
  const dark = Math.min(luminance(foreground), luminance(background));
  assert.ok((light + 0.05) / (dark + 0.05) >= 4.5);
  assert.match(style, /\.faq-a a\{text-decoration:underline;text-underline-offset:3px\}/);
  assert.match(result.html, /<div class="faq-a">[^]*?<a href="\/methodology"/);
});

test('only the price table scrolls inside a keyboard-accessible region', async () => {
  const result = await invoke({ prices: { 'fixture-card-1': trust(1000) } });
  assert.match(result.html, /<div class="top-cards-scroll" role="region" aria-label="카드별 참고가 표" tabindex="0">\s*<table class="top-cards">/);
  assert.match(result.html, /<\/tbody>\s*<\/table>\s*<\/div>/);
  assert.equal((result.html.match(/class="top-cards-scroll"/g) || []).length, 1);
  const empty = await invoke({ cards: [card(1, { name: 'TEST FIXTURE (variant)' })] });
  assert.doesNotMatch(empty.html, /class="top-cards-scroll"/);
});

test('versioned cache hits perform no provider reads', async () => {
  const result = await invoke({ cached: new Response('cached fixture', { headers: { 'X-Fixture': 'yes' } }) });
  assert.equal(result.html, 'cached fixture');
  assert.equal(result.response.headers.get('X-Edge-Cache'), 'HIT');
  assert.equal(result.response.headers.get('X-Fixture'), 'yes');
  assert.equal(result.calls.length, 0);
  assert.equal(result.writes.length, 0);
});

test('empty or invalid set routes preserve their 404 behavior', async () => {
  const empty = await invoke({ cards: [] });
  assert.equal(empty.response.status, 404);
  assert.equal(empty.calls.length, 1);
  assert.equal(empty.writes.length, 0);
  const invalid = await invoke({ code: '<>' });
  assert.equal(invalid.response.status, 404);
  assert.equal(invalid.calls.length, 0);
  assert.equal(invalid.writes.length, 0);
});
