import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync, statSync } from 'node:fs';
import { createHash } from 'node:crypto';
import vm from 'node:vm';
import { onRequest } from '../functions/search.js';
import { normalizeSearchQuery, planSearchQuery, sortSearchCards } from '../search-query.mjs';
import config from './search-tailwind.config.cjs';

const root = new URL('../', import.meta.url);
const read = relative => readFileSync(new URL(relative, root), 'utf8').replace(/\r\n/g, '\n');
const source = read('functions/search.js');
const css = read('styles/search-base.css');
const hash = value => createHash('sha256').update(value).digest('hex');
const searchIntentPairs = [
  ["import('/search-query.mjs?v=20261015')", "import('/search-query.mjs?v=20261007')"],
  ['var queryText = policy.planSearchQuery(q);', 'var queryText = policy.normalizeSearchQuery(q);'],
  ["if (!queryText.queryTokens.length) { notice('카드명·세트 코드·번호를 입력해 주세요.'); return; }",
   "if (!queryText.tokens.length) { notice('카드명·세트 코드·번호를 입력해 주세요.'); return; }"],
  ['queryText.queryTokens.forEach(function (token) {', 'queryText.tokens.forEach(function (token) {'],
  ['policy.sortSearchCards(queries[1].data, queryText.queryNormalized)', 'policy.sortSearchCards(queries[1].data, queryText.normalized)'],
];
const ssrSearchIntentPairs = [
  ["import { planSearchQuery, escapeSearchToken, getTrustedSearchPrice, sortSearchCards } from '../search-query.mjs';",
   "import { normalizeSearchQuery, escapeSearchToken, getTrustedSearchPrice, sortSearchCards } from '../search-query.mjs';"],
  ["  const { original: q, queryNormalized: normalized, queryTokens: tokens } = planSearchQuery(url.searchParams.get('q') || '');",
   "  const { original: q, normalized, tokens } = normalizeSearchQuery(url.searchParams.get('q') || '');"],
];
function restoreExactSearchIntent(value, pairs) {
  let restored = value;
  for (const [after, before] of pairs) {
    assert.equal(value.split(after).length - 1, 1, 'one exact approved search intent change');
    assert.equal(value.split(before).length - 1, 0, 'no stale approved search intent line');
    restored = restored.replace(after, before);
  }
  return restored;
}
const searchIntentPlannerDigest = 'ddde6b8c5e6b8e6d19702352567b9019175544e668b3be5aa3c6daa91d336b7c';
function assertOriginalQueryPolicy(value) {
  const blocks = [...value.matchAll(/\n\/\/ CARDPICK_SEARCH_INTENT_START\n[\s\S]*?\/\/ CARDPICK_SEARCH_INTENT_END\n/g)];
  assert.equal(blocks.length, 1, 'one exact additive query planner');
  assert.equal(hash(blocks[0][0]), searchIntentPlannerDigest, 'only the reviewed planner is excluded');
  assert.ok(value.endsWith(blocks[0][0]), 'planner remains appended after the complete original policy');
  assert.equal(hash(value.replace(blocks[0][0], '')), '848475f210c38d4e667457636c96c3cf849224ea07a19f2cc0a6ad435bede828',
    'aliases, original normalization, Trust Gate and sorting remain byte-identical');
}
const searchAccessibilityPairs = [
  ["    input.setAttribute('aria-controls', 'cp-search-results');\n    box.setAttribute('role', 'region');\n    box.setAttribute('aria-label', '카드 검색 결과');\n    box.setAttribute('aria-live', 'polite');",
   "    input.setAttribute('aria-controls', 'cp-search-results');\n    input.setAttribute('aria-expanded', 'false');\n    box.setAttribute('aria-live', 'polite');"],
  ["      box.style.display = 'none'; box.innerHTML = '';\n    }",
   "      box.style.display = 'none'; box.innerHTML = '';\n      input.setAttribute('aria-expanded', 'false');\n    }"],
  ["    function show() { box.style.display = 'block'; }",
   "    function show() { box.style.display = 'block'; input.setAttribute('aria-expanded', 'true'); }"],
];
function assertOriginalSharedSearch(value) {
  let normalized = restoreExactSearchIntent(value, searchIntentPairs);
  for (const [after, before] of searchAccessibilityPairs) {
    assert.equal(value.split(after).length - 1, 1, 'one exact search semantics change');
    assert.equal(value.split(before).length - 1, 0, 'no stale search semantics');
    normalized = normalized.replace(after, before);
  }
  assert.equal(hash(normalized), '1a6f0656ad867d6ed7aff7953bc9de9764dd219deb3ae56bc70ac044502982ed');
}

const originalHomeFonts = `<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" as="style" crossorigin href="https://cdn.jsdelivr.net/gh/orioncactus/pretendard@v1.3.9/dist/web/variable/pretendardvariable-dynamic-subset.min.css">
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;500;600&display=swap">`;
// Only the pinned home subset/range regeneration changes this exact font block.
const homeFontDigest = '0397278bc08755286e4b10d13c7145e678d16f14818c0cab56883a562694de82';
const homeReplacements = [
  ['    --sans:"Cardpick Text","Pretendard Variable",Pretendard,-apple-system,BlinkMacSystemFont,system-ui,"Apple SD Gothic Neo","Noto Sans KR",sans-serif;',
   '    --sans:"Pretendard Variable",Pretendard,-apple-system,BlinkMacSystemFont,system-ui,"Apple SD Gothic Neo","Noto Sans KR",sans-serif;'],
  ['  .legal{border-top:1px solid var(--line);padding:14px 0;display:flex;flex-wrap:wrap;gap:14px;font-family:var(--mono);font-size:11px;color:var(--sub);align-items:center}',
   '  .legal{border-top:1px solid var(--line);padding:14px 0;display:flex;flex-wrap:wrap;gap:14px;font-family:var(--mono);font-size:11px;color:var(--dim);align-items:center}'],
  ['    <div class="panel-foot" style="border-top:1px solid var(--line);font-size:11.5px;color:var(--sub);line-height:1.5;padding:12px 16px">',
   '    <div class="panel-foot" style="border-top:1px solid var(--line);font-size:11.5px;color:var(--dim);line-height:1.5;padding:12px 16px">'],
  ['  <script defer src="/auth.js?v=v3clean"></script>\n  <script defer src="/search.js?v=20260519ko"></script>',
   '  <script src="/auth.js?v=v3clean"></script>\n  <script src="/search.js?v=20260519ko"></script>'],
];
function normalizeHomePerformance(home) {
  assert.doesNotMatch(home, /\bcontent-visibility\s*:/, 'unproven containment candidate is not part of the selected patch');
  assert.doesNotMatch(home, /<link[^>]*rel="preload"[^>]*as="font"/, 'unproven Mono and regressing full-subset preloads remain excluded');
  const blocks = [...home.matchAll(/<style id="home-font-css">[\s\S]*?<\/style>/g)];
  assert.equal(blocks.length, 1, 'one exact page-owned font block');
  const fontBlock = blocks[0][0];
  assert.equal(hash(fontBlock), homeFontDigest, 'font ranges, URLs, strategies and narrow shared-UI aliases are immutable');
  const resource = fontBlock;
  assert.equal(home.split(resource).length - 1, 1);
  assert.ok(home.includes('<link rel="preconnect" href="https://cdn.jsdelivr.net" crossorigin>\n' + resource + '\n\n<style>'),
    'font resources remain at their exact original head anchor');
  assert.ok(home.indexOf(resource) < home.indexOf('</head>'));
  assert.equal(home.split('/fonts/cardpick-text/home.woff2').length - 1, 1, 'one local font source, without a regressing preload');
  assert.doesNotMatch(home, /<link[^>]*rel="preload"[^>]*href="\/fonts\/cardpick-text\/home\.woff2"/);
  let normalized = home.replace(resource, originalHomeFonts);
  for (const [after, before] of homeReplacements) {
    assert.equal(home.split(after).length - 1, 1, 'only one exact reviewed replacement');
    assert.equal(home.split(before).length - 1, 0, 'no stale or duplicate approved replacement');
    normalized = normalized.replace(after, before);
  }
  return normalized;
}

test('performance changes preserve the approved search logic, body, reporting and response contract', () => {
  const restored = restoreExactSearchIntent(source, ssrSearchIntentPairs);
  assert.equal(hash(restored.split('  const html = ')[0]), 'bacbfd037458a0bedca74dd1f11a781b1cad4bed9f6fe5ed2379b9c5b1878ba4');
  assert.equal(hash(source.split('</head><body>')[1]), 'cf57dfcbbf44f65165048bee3a32d25576b9ef8dbfeaaf585c35d7b4d52d6196');
  // Only the separately approved shared UI stability patch changes this asset.
  assertOriginalSharedSearch(read('search.js'));
  assertOriginalQueryPolicy(read('search-query.mjs'));
});

test('shared search semantics normalization rejects role, state, query, price and arbitrary-code drift', () => {
  const shared = read('search.js');
  const cases = [
    shared.replace(searchAccessibilityPairs[0][0], searchAccessibilityPairs[0][1]),
    shared.replace("box.setAttribute('role', 'region')", "box.setAttribute('role', 'listbox')"),
    shared.replace("input.setAttribute('aria-label', '카드명 검색');", "input.setAttribute('role', 'combobox');\n    input.setAttribute('aria-label', '카드명 검색');"),
    shared.replace(searchAccessibilityPairs[2][0], searchAccessibilityPairs[2][1]),
    shared.replace("'카드 검색 결과'", "'다른 결과'"),
    shared.replace("box.setAttribute('aria-live', 'polite');", "box.setAttribute('aria-live', 'off');"),
    shared.replace("box.setAttribute('role', 'region');", "box.setAttribute('role', 'region');\n    box.setAttribute('role', 'region');"),
    shared.replace('encodeURIComponent(lastQuery)', "encodeURIComponent('unapproved')"),
    shared.replace('c.price_krw == null', 'false'),
    shared + '\nwindow.unapproved = true;\n',
  ];
  for (const changed of cases) {
    assert.notEqual(changed, shared, 'negative fixture must mutate source');
    assert.throws(() => assertOriginalSharedSearch(changed), { code:'ERR_ASSERTION' });
  }
});

test('intent changes preserve the entire original policy and reject unrelated or duplicated planner code', () => {
  const policy = read('search-query.mjs');
  assertOriginalQueryPolicy(policy);
  const block = policy.match(/\n\/\/ CARDPICK_SEARCH_INTENT_START\n[\s\S]*?\/\/ CARDPICK_SEARCH_INTENT_END\n/)[0];
  for (const changed of [
    policy.replace(block, ''), policy + block, policy + '\n// unapproved\n',
    block + policy.replace(block, ''),
    policy.replace("'코코리':'phanpy'", "'코코리':'pikachu'"),
    policy.replace("'시세' || allTokens[end - 1] === '가격'", "'시세' || allTokens[end - 1] === 'price'"),
    policy.replace('remaining.slice(0, 5)', 'remaining.slice(0, 50)'),
    policy.replace("['HIGH', 'MEDIUM', 'LOW']", "['HIGH', 'MEDIUM', 'LOW', 'NONE']")
  ]) {
    assert.notEqual(changed, policy, 'negative fixture mutates source');
    assert.throws(() => assertOriginalQueryPolicy(changed), { code: 'ERR_ASSERTION' });
  }
});

test('SSR intent normalization rejects stale, duplicated, moved and unrelated service changes', () => {
  function assertSsr(value) {
    const restored = restoreExactSearchIntent(value, ssrSearchIntentPairs);
    assert.equal(hash(restored), '402ceeaf7c0c73f42c6b67bbfe8ecc8d65baf604de6b8a956ed6c08dfb980d35', 'the full approved compiled page, including metadata, stays intact');
    assert.equal(hash(restored.split('  const html = ')[0]), 'bacbfd037458a0bedca74dd1f11a781b1cad4bed9f6fe5ed2379b9c5b1878ba4');
    assert.equal(hash(restored.split('</head><body>')[1]), 'cf57dfcbbf44f65165048bee3a32d25576b9ef8dbfeaaf585c35d7b4d52d6196');
  }
  assertSsr(source);
  for (const [after, before] of ssrSearchIntentPairs) {
    for (const changed of [source.replace(after, before), source + '\n' + after,
      source.replace(after, '').replace('  const hasPrice', after + '\n  const hasPrice')]) {
      assert.notEqual(changed, source);
      assert.throws(() => assertSsr(changed), { code: 'ERR_ASSERTION' });
    }
  }
  for (const changed of [source.replace('limit=200', 'limit=2000'),
    source.replace('noindex,follow', 'index,follow'),
    source.replace('https://cardpick.kr/search', 'https://cardpick.kr/catalog'),
    source.replace('latest_krw: safeKrw', 'latest_krw: s.latest_krw')]) {
    assert.notEqual(changed, source);
    assert.throws(() => assertSsr(changed), { code: 'ERR_ASSERTION' });
  }
});

const priceIntentCases = [
  ['리자몽 시세', ['charizard']], ['리자몽 가격', ['charizard']],
  ['리자몽 시세 가격', ['charizard']], ['Price 가격', ['price']],
  ['리자몽 EX 199/165 시세', ['charizard', 'ex', '199/165']],
  ['블래키 SAR 시세', ['umbreon', 'sar']], ['블래키 SIR 가격', ['umbreon', 'sir']],
  ['Phanpy SSP 205 가격', ['phanpy', 'ssp', '205']],
  ['한글판 리자몽 시세', ['한글판', 'charizard']],
  ['포켓몬 카드 리자몽 가격', ['포켓몬', '카드', 'charizard']],
  ['모르는이름 가격', ['모르는이름']],
];
for (const [input, expected] of priceIntentCases) {
  test(`price intent keeps original and literal tokens: ${input}`, () => {
    const literal = normalizeSearchQuery(input);
    const plan = planSearchQuery(input);
    assert.deepEqual({ original: plan.original, normalized: plan.normalized, tokens: plan.tokens }, literal);
    assert.deepEqual(plan.queryTokens, expected);
    assert.equal(plan.queryNormalized, expected.join(' '));
    assert.ok(plan.removedIntentTokens.length > 0);
    assert.equal(plan.intentOnly, false);
    assert.notEqual(plan.queryTokens, plan.tokens, 'query plan cannot mutate the literal token array');
  });
}
for (const input of ['Price', 'Price SSP 205', '가격 리자몽', '리자몽 가격 SSP', '리자몽시세', '리자몽 가격?', 'Charizard ex', 'Charizard EX']) {
  test(`non-suffix words and English card names are not removed: ${input}`, () => {
    const literal = normalizeSearchQuery(input);
    const plan = planSearchQuery(input);
    assert.deepEqual(plan.tokens, literal.tokens);
    assert.deepEqual(plan.queryTokens, literal.tokens);
    assert.equal(plan.queryNormalized, literal.normalized);
    assert.deepEqual(plan.removedIntentTokens, []);
    assert.equal(plan.original, input);
  });
}
for (const input of ['시세', '가격', '시세 가격', '포켓몬 카드 시세', 'SAR 시세', 'SIR 가격', 'EX 가격']) {
  test(`identity-free price intent cannot scan cards: ${input}`, () => {
    const plan = planSearchQuery(input);
    assert.ok(plan.tokens.length > 0, 'literal input is retained');
    assert.equal(plan.intentOnly, true);
    assert.deepEqual(plan.queryTokens, []);
    assert.equal(plan.queryNormalized, '');
  });
}
const gradedIntentCases = ['PSA 10 피카츄 가격', 'PSA10피카츄 시세', '피카츄 psa10 시세',
  'BGS 9.5 블래키 가격', 'CGC Pristine 10 리자몽 가격', 'BRG 리자몽 시세',
  'SGC10 피카츄 가격', '포켓몬 카드등급 가격', '리자몽 그레이딩 시세',
  '리자몽 SSP 199 ex foo PSA10 가격'];
for (const input of gradedIntentCases) {
  test(`graded intent never falls back to raw lookup: ${input}`, () => {
    const plan = planSearchQuery(input);
    assert.equal(plan.hasGradingIntent, true);
    assert.deepEqual(plan.tokens, normalizeSearchQuery(input).tokens);
    assert.deepEqual(plan.queryTokens, []);
    assert.equal(plan.queryNormalized, '');
    assert.deepEqual(plan.removedIntentTokens, []);
    assert.equal(plan.original, input);
  });
}
test('intent planning retains input bounds, NFC, token limits, wildcard handling and literal relevance', () => {
  for (const input of [null, '***', 'a'.repeat(100), 'a b c d e f g 가격', '코코리'.normalize('NFD') + ' 가격', 'A%_\\ 가격']) {
    const literal = normalizeSearchQuery(input);
    const plan = planSearchQuery(input);
    assert.equal(plan.original, literal.original);
    assert.equal(plan.normalized, literal.normalized);
    assert.deepEqual(plan.tokens, literal.tokens);
    assert.ok(plan.original.length <= 80);
    assert.ok(plan.queryTokens.length <= 5);
  }
  assert.deepEqual(planSearchQuery('***').queryTokens, []);
  assert.deepEqual(planSearchQuery('코코리'.normalize('NFD') + ' 가격').queryTokens, ['phanpy']);
  const rows = [{ slug: 'shorter', name: 'A', name_en: 'Charizard variant', popularity_rank: 1 },
    { slug: 'exact', name: 'Charizard', popularity_rank: 99 }];
  assert.deepEqual(sortSearchCards(rows, planSearchQuery('리자몽 시세').queryNormalized).map(card => card.slug), ['exact', 'shorter']);
});

async function renderIntentSearch(input, host = '127.0.0.1') {
  const savedFetch = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (input, options = {}) => {
    assert.equal(options.method || 'GET', 'GET', 'SSR fixtures allow reads only');
    const url = new URL(input);
    const table = url.pathname.split('/').at(-1);
    calls.push({ table, url });
    if (table === 'cards') return Response.json([
      { slug: 'intent-shorter', name: 'A', name_en: 'Charizard variant', game: 'pokemon', set_name: 'Fixture', number: '1', popularity_rank: 1 },
      { slug: 'intent-exact', name: 'Charizard', game: 'pokemon', set_name: 'Fixture', number: '2', popularity_rank: 99 }
    ]);
    if (table === 'card_price_trust') return Response.json([{ card_slug: 'intent-exact', trust_level: 'HIGH', display_krw: 1250 }]);
    if (table === 'card_price_summary_best') return Response.json([{ card_slug: 'intent-exact', latest_krw: 9999999 }]);
    assert.equal(table, 'card_movement_cardmarket');
    return Response.json([]);
  };
  try {
    const url = new URL(`https://${host}/search`);
    url.searchParams.set('q', input);
    const response = await onRequest({ request: new Request(url) });
    return { html: await response.text(), calls, response };
  } finally { globalThis.fetch = savedFetch; }
}
for (const input of ['리자몽', '리자몽 시세', '리자몽 가격']) {
  test(`SSR uses the same identity query while retaining the submitted text: ${input}`, async () => {
    const result = await renderIntentSearch(input);
    assert.deepEqual(result.calls[0].url.searchParams.getAll('search_text'), ['ilike.%charizard%']);
    assert.equal(result.calls[0].url.searchParams.get('limit'), '200');
    assert.equal(result.calls.length, 4, 'no extra provider reads are introduced');
    assert.ok(result.html.includes(`name="q" value="${input}"`));
    assert.ok(result.html.includes(`<title>${input} 검색 결과`));
    assert.ok(result.html.includes(new URLSearchParams({ q: input }).toString()));
    assert.ok(result.html.indexOf('href="/cards/intent-exact"') < result.html.indexOf('href="/cards/intent-shorter"'));
    assert.match(result.html, /₩1,250/);
    assert.doesNotMatch(result.html, /9,999,999|\/api\/(?:search-log|request-update)|pagead\/js\/adsbygoogle.js/);
    assert.match(result.html, /<meta name="robots" content="noindex,follow">/);
    assert.match(result.html, /<link rel="canonical" href="https:\/\/cardpick.kr\/search">/);
  });
}
for (const input of ['가격', 'SAR 시세', 'PSA 10 피카츄 가격', gradedIntentCases.at(-1)]) {
  test(`SSR never reads or reports an identity-free or graded request: ${input}`, async () => {
    const result = await renderIntentSearch(input);
    assert.deepEqual(result.calls, []);
    assert.ok(result.html.includes(`name="q" value="${input}"`));
    assert.match(result.html, /검색할 카드명·세트 코드·번호를 입력해 주세요/);
    assert.doesNotMatch(result.html, /href="\/cards\/|\/api\/(?:search-log|request-update)|₩1,250/);
  });
}

// Execute the actual classic header against isolated in-memory DOM/provider fixtures.
async function renderHeaderIntent(inputText, hostname = 'localhost') {
  class Element {
    constructor() { this.style = {}; this.attributes = new Map(); this.listeners = new Map(); this.innerHTML = ''; this.value = ''; }
    setAttribute(key, value) { this.attributes.set(key, value); }
    getAttribute(key) { return this.attributes.get(key) ?? null; }
    addEventListener(key, callback) { this.listeners.set(key, callback); }
  }
  const input = new Element(); input.value = inputText;
  const box = new Element();
  const requests = [], posts = [], imports = [];
  class Query {
    constructor(table) { this.table = table; this.filters = []; }
    select(fields, options = {}) { this.fields = fields; this.options = options; return this; }
    eq(field, value) { this.filters.push([field, value]); return this; }
    ilike(field, value) { this.filters.push([field, value]); return this; }
    limit(value) { this.limitValue = value; return this; }
    abortSignal(signal) { this.signal = signal; return this; }
    in() { return this; }
    then(resolve, reject) {
      requests.push(this);
      const data = this.table === 'cards'
        ? [{ slug: 'header-intent', name: 'Charizard', game: 'pokemon', number: '1', price_krw: 9999999 }]
        : [{ card_slug: 'header-intent', trust_level: 'HIGH', display_krw: 1250 }];
      return Promise.resolve(this.options?.head ? { count: 1 } : { data }).then(resolve, reject);
    }
  }
  const document = {
    readyState: 'complete', head: { appendChild() {} }, createElement: () => new Element(),
    getElementById: id => id === 'cp-search' ? input : id === 'cp-search-results' ? box : null,
    addEventListener() {},
  };
  const context = vm.createContext({ document, window: { cardpickAuth: { getClient: () => ({ from: table => new Query(table) }) } },
    location: { hostname }, AbortController, console,
    setTimeout: (callback, delay) => delay === 200 ? (queueMicrotask(callback), 0) : setTimeout(callback, delay),
    clearTimeout,
    fetch: (url, options) => { posts.push({ url, options }); return Promise.resolve({ ok: true }); }
  });
  new vm.Script(read('search.js'), { filename: 'search.js', importModuleDynamically: async specifier => {
    imports.push(specifier);
    return import(new URL('../search-query.mjs', import.meta.url).href);
  } }).runInContext(context);
  assert.deepEqual(imports, [], 'the policy remains lazy at startup');
  input.listeners.get('input')({ target: input });
  for (let turn = 0; turn < 40 && (box.innerHTML.includes('검색 중') || !box.innerHTML); turn++) {
    await new Promise(resolve => setImmediate(resolve));
  }
  assert.doesNotMatch(box.innerHTML, /검색 중/);
  return { input, box, requests, posts, imports };
}
for (const input of ['리자몽', '리자몽 시세', 'Price 가격', '블래키 SAR 시세', '리자몽 EX 199/165 가격']) {
  test(`actual shared header consumes the conservative plan: ${input}`, async () => {
    const result = await renderHeaderIntent(input);
    const expected = planSearchQuery(input).queryTokens.map(token => ['search_text', '%' + token + '%']);
    const cards = result.requests.filter(query => query.table === 'cards');
    assert.equal(cards.length, 2);
    for (const query of cards) assert.deepEqual(query.filters.filter(([field]) => field === 'search_text'), expected);
    assert.equal(cards.find(query => !query.options?.head).limitValue, 200);
    assert.deepEqual(result.imports, ['/search-query.mjs?v=20261015']);
    assert.ok(result.box.innerHTML.includes('/search?q=' + encodeURIComponent(input)));
    assert.match(result.box.innerHTML, /₩ 1,250/);
    assert.doesNotMatch(result.box.innerHTML, /9,999,999/);
    assert.deepEqual(result.posts, [], 'local header tests cannot write search logs');
    assert.equal(result.input.value, input);
  });
}
for (const input of ['가격', 'SAR 시세', 'PSA10 피카츄 가격', gradedIntentCases.at(-1)]) {
  test(`actual shared header makes no card request for blocked intent: ${input}`, async () => {
    const result = await renderHeaderIntent(input);
    assert.deepEqual(result.requests, []);
    assert.deepEqual(result.posts, []);
    assert.match(result.box.innerHTML, /카드명·세트 코드·번호를 입력해 주세요/);
    assert.equal(result.input.value, input);
  });
}
test('isolated production-host reporting retains the original price-intent query in both consumers', async () => {
  const input = '리자몽 시세';
  const header = await renderHeaderIntent(input, 'cardpick.kr');
  assert.equal(header.posts.length, 1);
  assert.equal(header.posts[0].url, '/api/search-log');
  assert.equal(JSON.parse(header.posts[0].options.body).query, input);

  const ssr = await renderIntentSearch(input, 'cardpick.kr');
  const posts = [];
  const context = vm.createContext({ fetch: (url, options) => {
    posts.push({ url, body: JSON.parse(options.body) });
    return Promise.resolve({ ok: true });
  } });
  const reports = [...ssr.html.matchAll(/<script\b(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/gi)]
    .map(match => match[1]).filter(script => /\/api\/search-log/.test(script));
  assert.equal(reports.length, 1);
  new vm.Script(reports[0]).runInContext(context);
  assert.equal(posts.length, 1);
  assert.equal(posts[0].url, '/api/search-log');
  assert.equal(posts[0].body.query, input);
  assert.equal(posts[0].body.matched_slug, 'intent-exact');
});

const homeLayoutDigest = '4aa63bed8a35a52fd92cce126af911e8c5b506a63f1d184e4bf8dfa76528d027';
const homeRendererDigest = '0593e4f7a7d114b4d3373139ad9de29be636073e8d82087762458495861448e5';
const oldHomeToggle = "  // ---------- 전체 50건 토글 ----------\n  var expandLink = document.getElementById('cp-expand-prices');\n  if (expandLink) {\n    expandLink.addEventListener('click', function(e){\n      e.preventDefault();\n      var collapsed = expandLink.getAttribute('data-state') === 'collapsed';\n      window.cardpickExpanded = collapsed;\n      expandLink.setAttribute('data-state', collapsed ? 'expanded' : 'collapsed');\n      expandLink.textContent = collapsed ? '간단히 보기 ▴' : '전체 참고가 50건 보기 ▾';\n      var activeTab = document.querySelector('#prices .tab[aria-selected=\"true\"]');\n      renderPrices(activeTab ? activeTab.dataset.tab : 'all');\n    });\n  }\n\n";
const homeLayoutPairs = [
  ['  const body = document.getElementById(\'priceBody\');\n  const homePriceLayout = window.cardpickHomePrices;', '  const body = document.getElementById(\'priceBody\');'],
  ['  function renderPrices(tab){\n    const previousFocus = homePriceLayout ? homePriceLayout.captureFocus() : null;\n    if (homePriceLayout) homePriceLayout.count = cards.length;', '  function renderPrices(tab){'],
  ['      if (body.querySelector(\'tr[data-ssr="1"]\')) {\n        if (homePriceLayout) homePriceLayout.sync();\n        return;\n      }', '      if (body.querySelector(\'tr[data-ssr="1"]\')) return;'],
  ['      if (homePriceLayout) { homePriceLayout.sync(); homePriceLayout.restoreFocus(previousFocus); }\n      return;', '      return;'],
  ["    }).join('');\n    if (homePriceLayout) { homePriceLayout.sync(); homePriceLayout.restoreFocus(previousFocus); }\n  }\n  renderPrices('all');", "    }).join('');\n  }\n  renderPrices('all');"],
  ["    } catch (e) { console.warn('home cards', e); }\n    finally { if (homePriceLayout) homePriceLayout.sync(); }", "    } catch (e) { console.warn('home cards', e); }"],
  ['      <button type="button" id="cp-expand-prices" data-state="collapsed" aria-controls="priceBody" disabled>현재 참고가 보기 ▾</button>', '      <a href="#" id="cp-expand-prices" data-state="collapsed">전체 참고가 50건 보기 ▾</a>'],
  ['class="brand" aria-label="카드픽 CARDPICK 홈"', 'class="brand" aria-label="카드픽 홈"'],
  ['  .foot h2{font-size:11px;font-family:var(--mono);color:var(--sub);letter-spacing:.1em;text-transform:uppercase;margin:0 0 10px;font-weight:500}', '  .foot h4{font-size:11px;font-family:var(--mono);color:var(--sub);letter-spacing:.1em;text-transform:uppercase;margin:0 0 10px;font-weight:500}'],
  ...['데이터','가이드','운영'].map(label => ['        <h2>'+label+'</h2>', '        <h4>'+label+'</h4>']),
];
function normalizeHomeLayout(home) {
  const blocks = [...home.matchAll(/<!-- CARDPICK_HOME_PRICE_LAYOUT_START -->[\s\S]*?<!-- CARDPICK_HOME_PRICE_LAYOUT_END -->/g)];
  assert.equal(blocks.length,1,'one isolated home layout bootstrap');
  const block=blocks[0][0];
  assert.equal(hash(block),homeLayoutDigest,'exact reviewed folding, fallback control and focus contract');
  assert.ok(home.startsWith('<!doctype html>\n<html lang="ko">\n<head>\n<meta charset="utf-8">\n'+block+'\n<template data-cp-ad-loader>'),'critical bootstrap stays immediately after charset');
  const renderers=[...home.matchAll(/  \/\/ ---------- 전체 50건 토글 ----------[\s\S]*?(?=  \/\/ ---------- Tab wiring)/g)];
  assert.equal(renderers.length,1);
  assert.equal(hash(renderers[0][0]),homeRendererDigest,'one exact renderer attachment, no second expand owner');
  let normalized=home.replace(block+'\n','').replace(renderers[0][0],oldHomeToggle);
  const footer=home.match(/<footer\b[\s\S]*?<\/footer>/)[0];
  for(const label of ['데이터','가이드','운영'])assert.equal(footer.split('<h2>'+label+'</h2>').length-1,1,'footer-only heading change');
  for(const [after,before]of homeLayoutPairs){
    assert.equal(home.split(after).length-1,1,'one exact home layout/semantic change');
    if (!after.includes(before)) assert.equal(home.split(before).length-1,0,'no stale home layout/semantic change');
    normalized=normalized.replace(after,before);
  }
  return normalized;
}

const approvedHomeCopyPairs = [
  [
    "      <span class=\"sum\">같은 언어판·세트·번호·가공을 기준으로 비교하고, 판매자에게 요청할 사진과 단일 신호로 판별할 수 없는 이유를 확인합니다.</span>",
    "      <span class=\"sum\">인쇄·홀로·잉크·모서리·무게 5가지 식별 신호. 메루카리·중고나라 의심 신호, 자주 위조되는 카드까지.</span>"
  ],
  [
    "      <span class=\"sum\">PSA 직접 발송과 한국 대행의 비용 항목, 신청 절차, 포장·배송 전 확인 사항을 정리합니다.</span>",
    "      <span class=\"sum\">PSA 직접 발송 vs 한국 대행, 비용·기간 비교, 자주 하는 실수 7가지, BRG10 비교.</span>"
  ],
  [
    "      <div class=\"answer\">카드픽의 <a href=\"/catalog\">카드 검색</a>에서 영문 포켓몬 TCG 카탈로그를 찾을 수 있습니다. 신뢰도 기준을 통과한 카드는 TCGplayer 북미 market price 기반의 원화 해외 참고가를 표시하며, 국내 거래가와 다를 수 있습니다. 카드 번호와 가격 출처를 비교하는 순서는 <a href=\"/guide-card-price\">포켓몬 카드 시세 확인법</a>에서 설명합니다.</div>",
    "      <div class=\"answer\">카드픽의 <a href=\"/catalog\">카드 검색</a>에서 영문 포켓몬 TCG 카탈로그를 찾을 수 있습니다. 신뢰도 기준을 통과한 카드는 TCGplayer 북미 market price 기반의 원화 해외 참고가를 표시하며, 국내 거래가와 다를 수 있습니다.</div>"
  ],
  [
    "      <div class=\"answer\">한국에서 PSA로 카드를 보내는 방법은 미국 본사 직접 발송과 한국 대행 업체 이용입니다. 비용 항목·신청 절차·포장·배송 전 확인 사항은 <a href=\"/guide-psa-grading-korea\">PSA 그레이딩 신청 가이드</a>에서 정리했습니다. 손익분기는 <a href=\"/tools/psa-grading-break-even\">PSA 손익분기 계산기</a>로 확인할 수 있습니다.</div>",
    "      <div class=\"answer\">한국에서 PSA로 카드를 보내는 방법은 두 가지로, 미국 본사 직접 발송과 한국 대행 업체 이용입니다. 비용·기간·필요 서류·자주 하는 실수 7가지·BRG10 비교는 <a href=\"/guide-psa-grading-korea\">PSA 그레이딩 신청 가이드</a>에서 정리했습니다. 손익분기는 <a href=\"/tools#psa\">PSA 비용 계산기</a>로 확인할 수 있습니다.</div>"
  ],
  [
    "      <div class=\"answer\"><a href=\"/releases\">발매 정보</a> 페이지에서 한국판·일본판·영문판의 출처를 확인한 발매일과 원문 확인일을 볼 수 있습니다. 전체 발매 목록은 아니며, 정확한 날짜를 확인하지 못한 기록은 따로 구분합니다. 하단의 영문판 세트 참고 목록은 별도의 제3자 데이터입니다.</div>",
    "      <div class=\"answer\"><a href=\"/releases\">발매 정보</a> 페이지에서 영문판 포켓몬(pokemontcg.io 기준) 신규·예정 세트, 카드 수, 시리즈 정보를 확인합니다. 일본판·한국판 발매 정보는 공식 출처 통합 후 게시 예정이며 임의 추정 발매일은 게시하지 않습니다.</div>"
  ],
  [
    "        {\"@type\":\"Question\",\"name\":\"포켓몬 카드 시세는 어디서 확인하나요?\",\"acceptedAnswer\":{\"@type\":\"Answer\",\"text\":\"카드픽의 카드 검색에서 영문 포켓몬 TCG 카탈로그를 찾을 수 있습니다. 신뢰도 기준을 통과한 카드는 TCGplayer 북미 market price 기반의 원화 해외 참고가를 표시하며, 국내 거래가와 다를 수 있습니다. 카드 번호와 가격 출처를 비교하는 순서는 포켓몬 카드 시세 확인법에서 설명합니다.\"}},",
    "        {\"@type\":\"Question\",\"name\":\"포켓몬 카드 시세는 어디서 확인하나요?\",\"acceptedAnswer\":{\"@type\":\"Answer\",\"text\":\"카드픽의 카드 검색에서 영문 포켓몬 TCG 카탈로그를 찾을 수 있습니다. 신뢰도 기준을 통과한 카드는 TCGplayer 북미 market price 기반의 원화 해외 참고가를 표시하며, 국내 거래가와 다를 수 있습니다.\"}},"
  ],
  [
    "        {\"@type\":\"Question\",\"name\":\"PSA 그레이딩은 어디서 신청하나요?\",\"acceptedAnswer\":{\"@type\":\"Answer\",\"text\":\"한국에서 PSA로 카드를 보내는 방법은 미국 본사 직접 발송과 한국 대행 업체 이용입니다. 비용 항목·신청 절차·포장·배송 전 확인 사항은 PSA 그레이딩 신청 가이드에서 정리했습니다. 손익분기는 PSA 손익분기 계산기로 확인할 수 있습니다.\"}},",
    "        {\"@type\":\"Question\",\"name\":\"PSA 그레이딩은 어디서 신청하나요?\",\"acceptedAnswer\":{\"@type\":\"Answer\",\"text\":\"한국에서 PSA로 카드를 보내는 방법은 두 가지로, 미국 본사 직접 발송과 한국 대행 업체 이용입니다. 비용, 기간, 필요 서류, 자주 하는 실수, BRG10 비교는 카드픽 PSA 그레이딩 신청 가이드에서 정리했습니다.\"}},"
  ],
  [
    "        {\"@type\":\"Question\",\"name\":\"포켓몬 카드 발매일·신규 박스 정보는 어디서 보나요?\",\"acceptedAnswer\":{\"@type\":\"Answer\",\"text\":\"발매 정보 페이지에서 한국판·일본판·영문판의 출처를 확인한 발매일과 원문 확인일을 볼 수 있습니다. 전체 발매 목록은 아니며, 정확한 날짜를 확인하지 못한 기록은 따로 구분합니다. 하단의 영문판 세트 참고 목록은 별도의 제3자 데이터입니다.\"}},",
    "        {\"@type\":\"Question\",\"name\":\"포켓몬 카드 발매일, 신규 박스 정보는 어디서 보나요?\",\"acceptedAnswer\":{\"@type\":\"Answer\",\"text\":\"카드픽 발매 정보 페이지에서 영문판 포켓몬(pokemontcg.io 기준) 신규와 예정 세트, 카드 수, 시리즈 정보를 확인합니다. 일본판과 한국판 발매 정보는 공식 출처 통합 후 게시 예정이며 임의 추정 발매일은 게시하지 않습니다.\"}},"
  ]
];
function normalizeApprovedHomeCopy(home) {
  let normalized = home;
  for (const [after, before] of approvedHomeCopyPairs) {
    assert.equal(home.split(after).length - 1, 1, 'one exact approved home copy line');
    assert.equal(home.split(before).length - 1, 0, 'no stale home copy line');
    normalized = normalized.replace(after, before);
  }
  return normalized;
}

function assertOriginalHome(home) {
  const block = `  /* 홈 헤더 전용: 포인터 종류와 관계없이 모바일 조작 영역 확보 */
  @media(max-width:980px){
    .topbar-inner .brand,nav.main a,.topbar-inner .login-google{min-height:44px;min-width:44px;display:inline-flex;align-items:center}
    .topbar-inner .login-google{height:auto}
    .topbar-inner .search{height:auto;min-height:46px;padding:0 10px}
    .topbar-inner .search input{min-height:44px;min-width:0}
  }
  .topbar-inner .search:focus-within{outline:2px solid var(--up);outline-offset:3px}
`;
  home = normalizeHomePerformance(normalizeHomeLayout(normalizeApprovedHomeCopy(home)));
  assert.equal(home.split(block).length, 2, 'only the exact reviewed header block may be excluded');
  assert.equal(hash(home.replace(block, '')), 'c4afeb8c4f9117263f8f086f01a92415da3327c89b6208fcf8db8d98dee57983', 'body, ads, scripts, prices and metadata remain unchanged');
}

test('home retains its original digest after exact approved header/font/defer/three-node contrast normalization', () => {
  assertOriginalHome(read('index.html'));
});

test('approved home copy normalization rejects stale, changed, duplicated, moved and unrelated content', () => {
  const home = read('index.html');
  for (const [after, before] of approvedHomeCopyPairs) {
    const mutations = [
      home.replace(after, before),
      home.replace(after, after + ' unapproved'),
      home.replace(after, after + '\n' + after),
      home.replace(after, '').replace('</body>', after + '\n</body>'),
    ];
    for (const changed of mutations) {
      assert.notEqual(changed, home);
      assert.throws(() => assertOriginalHome(changed), { code: 'ERR_ASSERTION' });
    }
  }
});

test('home folding normalization rejects scope expansion, duplicate owners, moved bootstrap and data or semantic drift', () => {
  const home=read('index.html');
  const block=home.match(/<!-- CARDPICK_HOME_PRICE_LAYOUT_START -->[\s\S]*?<!-- CARDPICK_HOME_PRICE_LAYOUT_END -->/)[0];
  const cases=[
    home.replace(block,''),
    home.replace(block,block+'\n'+block),
    home.replace(block+'\n','').replace('</head>',block+'\n</head>'),
    home.replace(':nth-child(n+6)',':nth-child(n+5)'),
    home.replace('html.cp-home-prices-folded #priceBody','html.cp-home-prices-folded table'),
    home.replace("document.addEventListener('click', function(event){", "document.addEventListener('click', function(event){\n    window.unapproved = true;"),
    home.replace('cards.slice(0, 5)','cards.slice(0, 20)'),
    home.replace('homePriceLayout.count = cards.length','homePriceLayout.count = 50'),
    home.replace('homePriceLayout.restoreFocus(previousFocus)','homePriceLayout.restoreFocus(null)'),
    home.replace('class="brand" aria-label="카드픽 CARDPICK 홈"','class="brand" aria-label="카드픽 홈"'),
    home.replace('        <h2>데이터</h2>','        <h4>데이터</h4>'),
    home.replace('        <h2>운영</h2>','        <h2>운영</h2>\n        <h2>운영</h2>'),
    home.replace('.foot h2{font-size:11px;','.foot h2{font-size:22px;'),
    home.replace("price: '₩' + Math.round(c.krw)","price: '₩' + Math.round(999999)"),
  ];
  for(const changed of cases){assert.notEqual(changed,home);assert.throws(()=>assertOriginalHome(changed),{code:'ERR_ASSERTION'});}
});

test('home normalization rejects altered, duplicate, missing or moved fonts and unrelated page/advertising changes', () => {
  const home = read('index.html');
  const fontBlock = home.match(/<style id="home-font-css">[\s\S]*?<\/style>/)[0];
  const resource = fontBlock;
  const cases = [
    ['regressing font preload reintroduced', home.replace(fontBlock, '<link rel="preload" href="/fonts/cardpick-text/home.woff2" as="font" type="font/woff2" crossorigin>\n' + fontBlock)],
    ['font CSS injection', home.replace(fontBlock, fontBlock.replace('</style>', 'body{display:none}</style>'))],
    ['font source changed', home.replace('/fonts/cardpick-text/home.woff2', '/fonts/cardpick-text/card.woff2')],
    ['late font swap', home.replace('font-display:optional', 'font-display:swap')],
    ['new static glyph range removed', home.replace('U+B0A0,', '')],
    ['missing fonts', home.replace(resource, '')],
    ['duplicate fonts', home.replace(resource, resource + '\n' + resource)],
    ['fonts moved into body', home.replace(resource, '').replace('</body>', resource + '\n</body>')],
    ['fonts moved within head', home.replace(resource, '').replace('</head>', resource + '\n</head>')],
    ['login/search alias removed', home.replace('#cp-user-menu,#cp-search-results', '#cp-user-menu')],
    ['classic auth restored', home.replace('<script defer src="/auth.js?v=v3clean">', '<script src="/auth.js?v=v3clean">')],
    ['deferred scripts reordered', home.replace(homeReplacements[3][0], homeReplacements[3][0].split('\n').reverse().join('\n'))],
    ['contrast reverted', home.replace(homeReplacements[2][0], homeReplacements[2][1])],
    ['global dim changed', home.replace('--dim:#5B6577', '--dim:#8B96A8')],
    ['unrelated body injected', home.replace('</body>', '<p>unapproved</p></body>')],
    ['canonical changed', home.replace('rel="canonical" href="https://cardpick.kr/"', 'rel="canonical" href="https://cardpick.kr/catalog"')],
    ['ad slot changed', home.replace('class="adsbygoogle cp_ad_home"', 'class="adsbygoogle unapproved_home"')],
    ['executable ad SDK added', home.replace('</head>', '<script async src="https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js"></script></head>')],
  ];
  for (const [name, changed] of cases) {
    assert.ok(changed !== home, `${name}: fixture must change`);
    assert.throws(() => assertOriginalHome(changed), { code: 'ERR_ASSERTION' }, name);
  }
});

test('selected ellipsis-only home patch rejects unadopted containment and font-preload candidates', () => {
  const home = read('index.html');
  const block = '<style id="home-below-fold-css">#guides,#faq,#intro,.home-intro{content-visibility:auto;contain-intrinsic-block-size:auto 941px}</style>';
  const preload = '<link rel="preload" href="/fonts/ibm-plex-mono/-F63fjptAgt5VM-kVkqdyU8n1i8q1w.woff2" as="font" type="font/woff2" crossorigin>';
  const cases = [
    home.replace('</head>', block + '\n</head>'),
    home.replace('</body>', block + '\n</body>'),
    home.replace('</head>', block + '\n' + block + '\n</head>'),
    home.replace('</head>', block.replace('#guides,#faq,#intro,.home-intro', '#prices,.side-stack,#cp-ad-home') + '\n</head>'),
    home.replace('</head>', block.replace('content-visibility:auto', 'content-visibility:hidden') + '\n</head>'),
    home.replace('</head>', block.replace('content-visibility:auto;', '') + '\n</head>'),
    home.replace('</head>', preload + '\n</head>'),
    home.replace('</head>', preload + '\n' + preload + '\n</head>'),
    home.replace('</body>', preload + '\n</body>'),
    home.replace('</head>', preload.replace(' crossorigin', '') + '\n</head>'),
    home.replace('</head>', preload.replace('-F63fjptAgt5VM-kVkqdyU8n1i8q1w.woff2', 'unapproved.woff2') + '\n</head>'),
    home.replace('</head>', preload + '\n' + block + '\n</head>'),
  ];
  for (const changed of cases) {
    assert.notEqual(changed, home, 'negative fixture must mutate source');
    assert.throws(() => assertOriginalHome(changed), { code: 'ERR_ASSERTION' });
  }
});

test('home edge cache changes only its reviewed resource version', () => {
  const middleware = read('functions/_middleware.js');
  const newKey = '__home_ssr_v19_home_ellipsis_font';
  const oldKey = '__home_ssr_v15_manual_ads_fonts_restored';
  function assertCache(value) {
    assert.equal(value.split(newKey).length - 1, 1);
    assert.equal(value.split(oldKey).length - 1, 0);
    assert.equal(hash(value.replace(newKey, oldKey)), '6301cdea860daf351c9289f8ea6b4048a12683ba45e3dd68a16b0571f342d7a7');
  }
  assertCache(middleware);
  for (const changed of [middleware.replace(newKey, oldKey), middleware + '\n//' + newKey, middleware.replace('limit=120', 'limit=200')]) {
    assert.notEqual(changed, middleware);
    assert.throws(() => assertCache(changed), { code: 'ERR_ASSERTION' });
  }
});

test('compiled CSS scans every SSR state and preserves the original Tailwind 3.4.17 theme', () => {
  assert.deepEqual(config.content, ['./functions/search.js']);
  assert.deepEqual(config.theme.extend.colors, {bg:'#05080D',panel:'#0D121B',panel2:'#111722',line:'rgba(255,255,255,0.08)',ink:'#E8EDF5',muted:'#8B96A8',up:'#26E0C2',down:'#FF4D6D',brand:'#26E0C2'});
  assert.deepEqual(config.theme.extend.fontFamily, {sans:['Pretendard','system-ui','sans-serif'],mono:['"IBM Plex Mono"','ui-monospace','monospace']});
  assert.match(css, /tailwindcss v3\.4\.17/);
  assert.ok(Buffer.byteLength(css) < 20_000, 'search utility CSS should remain bounded');
  const selectors=['.w-24{','.w-20{','.w-16{','.min-w-0{','.hidden{','.block{','.leading-relaxed{','.text-up{','.text-down{','.divide-line','.hover\\:bg-panel2:hover{','.sm\\:block{','.md\\:block{','.lg\\:px-8{','.max-w-\\[1280px\\]{','.max-w-\\[600px\\]{','.text-\\[13px\\]{','.tracking-\\[0\\.16em\\]{','.text-ink\\/80{'];
  for(const selector of selectors)assert.ok(css.includes(selector), selector);
  const declarations=['.bg-bg{--tw-bg-opacity:1;background-color:rgb(5 8 13/var(--tw-bg-opacity,1))}', '.bg-brand{--tw-bg-opacity:1;background-color:rgb(38 224 194/var(--tw-bg-opacity,1))}', '.bg-panel{--tw-bg-opacity:1;background-color:rgb(13 18 27/var(--tw-bg-opacity,1))}', '.text-up{--tw-text-opacity:1;color:rgb(38 224 194/var(--tw-text-opacity,1))}', '.text-down{--tw-text-opacity:1;color:rgb(255 77 109/var(--tw-text-opacity,1))}', '.text-ink{--tw-text-opacity:1;color:rgb(232 237 245/var(--tw-text-opacity,1))}', '.text-muted{--tw-text-opacity:1;color:rgb(139 150 168/var(--tw-text-opacity,1))}', '.w-24{width:6rem}', '.gap-2{gap:.5rem}', '.p-5{padding:1.25rem}', '.font-mono{font-family:IBM Plex Mono,ui-monospace,monospace}', '@media (min-width:640px){.sm\\:block{display:block}}', '@media (min-width:768px){.md\\:block{display:block}}'];
  for(const declaration of declarations)assert.ok(css.includes(declaration),declaration);
  assert.doesNotMatch(css, /@import|@font-face|cdn\.tailwindcss|fonts\.googleapis/);
  assert.equal(read('styles/search.input.css').match(/@tailwind /g).length,3);
});

test('the exact compiled search stylesheet is critical and fonts do not require a browser compiler', () => {
  assert.equal(source.match(/href="\/styles\/search-base\.css\?v=20261012"/g).length,1);
  assert.match(source, /<link rel="stylesheet" href="\/styles\/search-base\.css\?v=20261012">/);
  assert.doesNotMatch(source, /cdn\.tailwindcss\.com|tailwind\.config|fonts\.googleapis\.com|fonts\.gstatic\.com|web\/static\/pretendard/);
  for(const file of ['releases-fonts.css','set-fonts.css']){
    assert.ok(source.includes(`<link rel="stylesheet" href="/styles/${file}" media="print" onload="this.media='all'">`));
    assert.ok(source.match(/<noscript>([\s\S]*?)<\/noscript>/)[1].includes(`<link rel="stylesheet" href="/styles/${file}">`));
  }
});

test('existing complete optional font resources and unmodified local Mono faces remain available', () => {
  const pretendard = read('styles/releases-fonts.css');
  assert.ok((pretendard.match(/@font-face/g)||[]).length>50, 'dynamic subsets must retain fallback for arbitrary searches');
  assert.match(pretendard, /font-family: 'Pretendard'/);
  assert.doesNotMatch(pretendard, /font-display:\s*(?:swap|block)/);
  const mono=read('styles/set-fonts.css');
  assert.equal((mono.match(/@font-face/g)||[]).length,15);
  for(const weight of [400,500,600])assert.equal((mono.match(new RegExp('font-weight:'+weight+';','g'))||[]).length,5);
  assert.equal((mono.match(/font-display:optional/g)||[]).length,15);
  for(const [,file] of mono.matchAll(/url\((\/fonts\/[^)]+)\)/g)){
    assert.ok(existsSync(new URL(file.slice(1),root)),file);assert.ok(statSync(new URL(file.slice(1),root)).size>0);
  }
  assert.ok(existsSync(new URL('fonts/ibm-plex-mono/OFL.txt',root)));
});

test('search-only mobile touch rules retain desktop styling and visible keyboard focus', () => {
  assert.match(source, /@media\(max-width:768px\)\{\.chip\{min-height:44px;min-width:44px/);
  assert.match(source, /header \.search-header-form input\{min-height:44px\}/);
  assert.match(source, /header \.search-header-inner>a,header \.search-header-nav a\{[^}]*min-height:44px;min-width:44px/);
  assert.match(source, /main a\.inline-block,main a\[href\^="\/cards\/"\]\{min-height:44px/);
  assert.match(source, /a:focus-visible,input\[type="search"\]:focus-visible\{outline:2px solid #26E0C2;outline-offset:3px\}/);
  assert.doesNotMatch(source, /transition:all|outline:none|maximum-scale|user-scalable/);
});

for(const state of ['empty','zero','card','filtered-zero','query-error','partial']){
  test(`${state}: initial SSR includes usable critical CSS and no-JS font fallback without extra reads`, async () => {
    const saved=globalThis.fetch;const calls=[];
    globalThis.fetch=async(input,options={})=>{
      assert.equal(options.method||'GET','GET');const table=new URL(input).pathname.split('/').at(-1);calls.push(table);
      if(state==='query-error')throw Error('test-only provider failure');
      if(table==='cards')return Response.json(state==='zero'?[]:[{slug:'test-only-card',name:'Test-only card',game:'pokemon',number:'1',set_name:'Test-only set'}]);
      if(table==='card_price_trust'&&state==='partial')return new Response('',{status:503});
      return Response.json([]);
    };
    try{
      const url=new URL('http://127.0.0.1/search');if(state!=='empty')url.searchParams.set('q','test-only');if(state==='filtered-zero')url.searchParams.set('has_price','1');
      const response=await onRequest({request:new Request(url)});const html=await response.text();assert.equal(response.status,200);
      assert.equal(html.match(/href="\/styles\/search-base\.css\?v=20261012"/g).length,1);assert.match(html,/<noscript><link rel="stylesheet" href="\/styles\/releases-fonts.css"><link rel="stylesheet" href="\/styles\/set-fonts.css"><\/noscript>/);
      assert.doesNotMatch(html,/cdn\.tailwindcss|fonts\.googleapis|\/api\/(?:search-log|request-update)/);
      assert.deepEqual(calls,state==='empty'?[]:['zero','query-error'].includes(state)?['cards']:['cards','card_price_summary_best','card_movement_cardmarket','card_price_trust']);
      const links=[...html.matchAll(/href="\/cards\/([^"]+)"/g)].map(match=>match[1]);
      assert.deepEqual(links,['card','partial'].includes(state)?['test-only-card']:[]);
      const expectedText={empty:'상단 검색창에 카드명·세트 코드·번호를 입력하세요.',zero:'검색어와 일치하는 카드를 찾지 못했습니다.',card:'1건 (1장 표시)','filtered-zero':'선택한 조건에 맞는 카드가 없습니다.','query-error':'검색에 실패했습니다. 잠시 후 다시 시도해 주세요.',partial:'일부 참고가·변동 정보를 불러오지 못했습니다.'};
      assert.ok(html.includes(expectedText[state]),state+' must retain its own SSR content');
      assert.equal(html.includes('role="alert"'),state==='query-error');
      assert.equal(html.includes('role="status"'),state==='partial');
      assert.match(html,/<meta name="robots" content="noindex,follow">/);assert.match(html,/<link rel="canonical" href="https:\/\/cardpick.kr\/search">/);
    }finally{globalThis.fetch=saved;}
  });
}
