import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { onRequest } from '../functions/search.js';
import { normalizeSearchQuery } from '../search-query.mjs';

// Test-only provider fixtures. No live database or logging endpoint is called.
const phanpy = {
  slug: 'test-phanpy-205', name: 'Phanpy', name_en: 'Phanpy', name_ko: '코코리',
  game: 'pokemon', set_name: 'Test Set', set_code: 'SSP', number: '205', popularity_rank: 5
};
const summary = { card_slug: phanpy.slug, latest_krw: 5500000, last_fetched_at: '2026-10-07T00:00:00Z', change_30d_pct: 0 };
const trust = { card_slug: phanpy.slug, trust_level: 'MEDIUM', display_krw: 12000 };
const movement = { card_slug: phanpy.slug, change_7d_vs_30d_pct: 0 };

async function render(q, overrides = {}, { host = 'cardpick.kr', params = {}, timerContext } = {}) {
  const savedFetch = globalThis.fetch;
  const calls = [];
  const provider = {
    cards: [phanpy], card_price_summary_best: [summary],
    card_price_trust: [trust], card_movement_cardmarket: [movement], ...overrides
  };
  globalThis.fetch = async (input, options = {}) => {
    assert.equal(options.method || 'GET', 'GET', 'SSR must only read provider data');
    const url = new URL(input);
    const resource = url.pathname.split('/').pop();
    assert.ok(Object.hasOwn(provider, resource), `Unexpected provider path: ${url.pathname}`);
    calls.push({ url, options, resource });
    const value = provider[resource];
    if (typeof value === 'function') return value(input, options);
    if (value instanceof Error) throw value;
    if (value instanceof Response) return value;
    return new Response(JSON.stringify(value), { headers: { 'Content-Type': 'application/json' } });
  };
  try {
    const requestUrl = new URL(`https://${host}/search`);
    requestUrl.searchParams.set('q', q);
    for (const [key, value] of Object.entries(params)) requestUrl.searchParams.set(key, value);
    const pending = onRequest({ request: new Request(requestUrl) });
    if (timerContext) timerContext.mock.timers.tick(6000);
    const response = await pending;
    return { response, html: await response.text(), calls };
  } finally {
    globalThis.fetch = savedFetch;
  }
}

function inlineScripts(html) {
  return [...html.matchAll(/<script\b(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/gi)].map(match => match[1]);
}

function executeReporting(html) {
  const calls = [];
  const sandbox = { fetch: (url, options) => {
    calls.push({ url, ...JSON.parse(options.body) });
    return Promise.resolve({ ok: true });
  } };
  for (const script of inlineScripts(html).filter(source => /\/api\/(?:search-log|request-update)/.test(source))) {
    vm.runInNewContext(script, sandbox);
  }
  return { calls, sandbox };
}

test('SSR searches normalized Korean tokens while retaining the original query in UI, filters, and logs', async () => {
  const result = await render('  코코리 205  ');
  const cardsCall = result.calls.find(call => call.resource === 'cards');
  assert.deepEqual(cardsCall.url.searchParams.getAll('search_text'), ['ilike.%phanpy%', 'ilike.%205%']);
  assert.equal(cardsCall.url.searchParams.get('game'), 'eq.pokemon');
  assert.match(result.html, /<title>코코리 205 검색 결과/);
  assert.match(result.html, /name="q" value="코코리 205"/);
  assert.match(result.html, /q=%EC%BD%94%EC%BD%94%EB%A6%AC\+205/);
  assert.deepEqual(executeReporting(result.html).calls, [{
    url: '/api/search-log', query: '코코리 205', game: 'pokemon',
    result_count: 1, has_price: true, matched_slug: phanpy.slug
  }]);
});

test('SSR composes NFD Korean before applying the shared 80-character input limit', async () => {
  const prefix = 'a'.repeat(75);
  for (const tail of ['', ' 205']) {
    const input = prefix + ' ' + '코코리'.normalize('NFD') + tail;
    const expectedOriginal = prefix + ' 코코리' + (tail ? ' ' : '');
    const commonQuery = normalizeSearchQuery(input);
    assert.equal(commonQuery.original, expectedOriginal);
    assert.equal(commonQuery.normalized, prefix + ' phanpy');
    const result = await render(input);
    assert.deepEqual(result.calls[0].url.searchParams.getAll('search_text'), ['ilike.%' + prefix + '%', 'ilike.%phanpy%']);
    assert.ok(result.html.includes('name="q" value="' + expectedOriginal + '"'));
    assert.ok(result.html.includes('<title>' + expectedOriginal + ' 검색 결과'));
    assert.equal(executeReporting(result.html).calls[0].query, expectedOriginal);
  }
});

test('compound Korean aliases do not select Mew or Eevee by mistake', async () => {
  for (const [q, expected] of [['뮤츠 ex', ['mewtwo', 'ex']], ['에브이 VMAX', ['espeon', 'vmax']], ['이브이', ['eevee']]]) {
    const result = await render(q);
    assert.deepEqual(result.calls[0].url.searchParams.getAll('search_text'), expected.map(token => `ilike.%${token}%`));
  }
});

test('normalized exact names outrank longer names even when their popularity is lower', async () => {
  const result = await render('코코리', { cards: [
    { ...phanpy, slug: 'test-phanpy-ex', name: 'Phanpy ex', name_en: 'Phanpy ex', name_ko: '코코리 ex', popularity_rank: 1 },
    phanpy
  ] });
  assert.ok(result.html.indexOf(`href="/cards/${phanpy.slug}"`) < result.html.indexOf('href="/cards/test-phanpy-ex"'));
  assert.equal(executeReporting(result.html).calls[0].matched_slug, phanpy.slug);
});

test('SQL wildcards are literal and asterisks cannot create PostgREST wildcard aliases', async () => {
  const result = await render('A%_\\*');
  const filters = result.calls[0].url.searchParams.getAll('search_text');
  assert.deepEqual(filters, ['ilike.%a\\%\\_\\\\%']);
  assert.ok(result.calls[0].url.href.includes('%25'));
  assert.ok(!result.calls[0].url.href.includes('ilike.*'));
});

test('asterisk-only input cannot query the entire card table or create update requests', async () => {
  const result = await render('***');
  assert.equal(result.calls.length, 0);
  assert.match(result.html, /검색할 카드명·세트 코드·번호를 입력해 주세요/);
  assert.doesNotMatch(result.html, /pagead\/js\/adsbygoogle.js|\/api\/(?:search-log|request-update)/);
});

test('trusted MEDIUM amount is shown without falling back to the raw provider price', async () => {
  const result = await render('코코리');
  assert.match(result.html, /₩12,000/);
  assert.doesNotMatch(result.html, /5,500,000|5500000|NaN/);
  assert.match(result.html, /0\.0%/);
  assert.doesNotMatch(result.html, /data-search-low-trust|표본 부족 · 참고용/);
});

test('LOW trusted prices show their limited-sample warning directly beside the displayed amount', async () => {
  const result = await render('코코리', { card_price_trust: [{ ...trust, trust_level: 'LOW' }] });
  assert.match(result.html, /₩12,000<small data-search-low-trust[^>]*>표본 부족 · 참고용<\/small>/);
  assert.doesNotMatch(result.html, /5,500,000/);
});

test('invalid LOW amounts remain unavailable without a warning implying a usable price', async () => {
  const result = await render('코코리', { card_price_trust: [{ ...trust, trust_level: 'LOW', display_krw: null }] });
  assert.match(result.html, /test-phanpy-205/);
  assert.doesNotMatch(result.html, /₩12,000|5,500,000|data-search-low-trust/);
});

test('missing, forbidden, unknown, and invalid trust amounts never display a raw price', async () => {
  const invalidTrust = [null,
    { ...trust, trust_level: 'NONE' }, { ...trust, trust_level: 'UNKNOWN' },
    { ...trust, display_krw: -1 }, { ...trust, display_krw: 'invalid' },
    { ...trust, display_krw: 0 }
  ];
  for (const item of invalidTrust) {
    const result = await render('코코리', { card_price_trust: item ? [item] : [] });
    assert.match(result.html, /test-phanpy-205/);
    assert.doesNotMatch(result.html, /₩12,000|5,500,000|NaN/);
    assert.equal(executeReporting(result.html).calls[0].has_price, false);
  }
});

test('card lookup failures have a retry state and never create zero-result reports', async () => {
  for (const failed of [new Response('unavailable', { status: 503 }), new Error('network'),
    new Response('not json'), { message: 'upstream failure' }]) {
    const result = await render('코코리', { cards: failed });
    assert.match(result.html, /검색에 실패했습니다/);
    assert.match(result.html, /다시 검색/);
    assert.doesNotMatch(result.html, /업데이트 후보|등록되지 않은|일치하는 카드를 찾지|\/api\/(?:search-log|request-update)/);
    assert.equal(result.response.status, 200);
    assert.ok(!result.html.includes('pagead/js/adsbygoogle.js'));
  }
});

test('the full provider read has a six-second deadline even when a fetch ignores abort', async context => {
  context.mock.timers.enable({ apis: ['setTimeout'] });
  const result = await render('코코리', { cards: () => new Promise(() => {}) }, { timerContext: context });
  assert.match(result.html, /검색에 실패했습니다/);
  assert.equal(result.calls[0].options.signal.aborted, true);
  assert.deepEqual(executeReporting(result.html).calls, []);
});

test('partial price and movement failures preserve card results and do not report failed price collection', async () => {
  for (const resource of ['card_price_summary_best', 'card_movement_cardmarket', 'card_price_trust']) {
    const result = await render('코코리', { [resource]: new Response('unavailable', { status: 503 }) });
    assert.match(result.html, /test-phanpy-205/);
    assert.match(result.html, /일부 참고가·변동 정보를 불러오지 못했습니다/);
    assert.doesNotMatch(result.html, /검색에 실패했습니다|\/api\/(?:search-log|request-update)/);
    if (resource === 'card_price_trust') assert.doesNotMatch(result.html, /₩12,000|5,500,000/);
    else assert.match(result.html, /₩12,000/);
  }
});

test('genuine zero results report the original query without claiming successful registration', async () => {
  const result = await render('없는카드', { cards: [] });
  assert.match(result.html, /검색어와 일치하는 카드를 찾지 못했습니다/);
  assert.doesNotMatch(result.html, /업데이트 후보에 추가|아직 등록되지 않은/);
  assert.deepEqual(executeReporting(result.html).calls, [
    { url: '/api/request-update', query: '없는카드' },
    { url: '/api/search-log', query: '없는카드', game: 'pokemon', result_count: 0, has_price: false, matched_slug: null }
  ]);
});

test('the price filter producing zero results is distinguished from a missing card', async () => {
  const result = await render('코코리', { card_price_trust: [] }, { params: { has_price: '1' } });
  assert.match(result.html, /선택한 조건에 맞는 카드가 없습니다/);
  assert.match(result.html, /가격 조건 해제/);
  assert.doesNotMatch(result.html, /\/api\/(?:request-update|search-log)|등록되지 않은|일치하는 카드를 찾지/);
  assert.deepEqual(executeReporting(result.html).calls, []);
});

test('all loopback preview hosts omit production logging and update writes', async () => {
  for (const host of ['localhost', '127.0.0.1', '[::1]']) {
    for (const cards of [[phanpy], []]) {
      const result = await render('코코리', { cards }, { host });
      assert.deepEqual(executeReporting(result.html).calls, []);
      assert.doesNotMatch(result.html, /\/api\/(?:search-log|request-update)/);
    }
  }
});

test('inline reports cannot break out of a script with a query or card slug', async () => {
  const attack = '</script><script>globalThis.pwned=1</script>';
  const result = await render(attack, { cards: [] });
  assert.doesNotMatch(result.html, /<script>globalThis\.pwned/);
  assert.match(result.html, /\\u003c\/script>/);
  const report = executeReporting(result.html);
  assert.equal(report.sandbox.pwned, undefined);
  assert.equal(report.calls[0].query, attack);
  assert.equal(report.calls[1].query, attack);
  const cardResult = await render('코코리', { cards: [{ ...phanpy, slug: attack }], card_price_trust: [] });
  const cardReport = executeReporting(cardResult.html);
  assert.doesNotMatch(cardResult.html, /<script>globalThis\.pwned/);
  assert.equal(cardReport.sandbox.pwned, undefined);
  assert.equal(cardReport.calls[0].matched_slug, attack);
});

test('search keeps its canonical, noindex, cache and conditional advertisement policy', async () => {
  const result = await render('코코리');
  assert.match(result.html, /<link rel="canonical" href="https:\/\/cardpick.kr\/search">/);
  assert.match(result.html, /<meta name="robots" content="noindex,follow">/);
  assert.equal(result.response.headers.get('Cache-Control'), 'public, s-maxage=300, stale-while-revalidate=60');
  assert.match(result.html, /pagead\/js\/adsbygoogle.js/);
  const empty = await render('', { cards: [] });
  assert.equal(empty.calls.length, 0);
  assert.doesNotMatch(empty.html, /pagead\/js\/adsbygoogle.js|\/api\/(?:search-log|request-update)/);
});

test('the search input has a name and the mobile header allows its own row', async () => {
  const result = await render('코코리');
  assert.match(result.html, /aria-label="포켓몬 카드 이름, 세트 또는 카드 번호 검색"/);
  assert.match(result.html, /@media\(max-width:640px\).*search-header-form\{order:3;flex-basis:100%/);
});
