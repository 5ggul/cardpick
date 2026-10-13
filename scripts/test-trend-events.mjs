// Synthetic fixtures are confined to tests; no production writes or requests.
import test from 'node:test';
import assert from 'node:assert/strict';
import { parsePokemonCardJp, onRequest } from '../functions/api/trend-events.js';

// Structure observed at https://www.pokemon-card.com/info/ on 2026-10-01:
// List_item_inner anchor > List_body > Calendar_Label + title + span.Date.
function entry({ href = '/info/fixture.html', date = '2026.9.29', title = 'カード テスト記事', attrs = 'class="List_item_inner"', dateClass = 'Date Date-small' } = {}) {
  return `<li class="List_item"><a ${attrs} href="${href}"><div class="List_title"><img alt="カード画像"></div><div class="List_body"><div class="Calendar_Label">商品</div>${title}<span class="${dateClass}">${date}</span></div></a></li>`;
}

test('accepts a dated news row and preserves the public contract', () => {
  const [item] = parsePokemonCardJp(entry());
  assert.deepEqual(item, {
    source: 'pokemon-card.com', source_type: 'official',
    title: '商品 カード テスト記事 2026.9.29',
    url: 'https://www.pokemon-card.com/info/fixture.html',
    published_at: '2026-09-29T00:00:00+09:00', kind: 'release', country: 'JP',
  });
});

test('ignores real-world commented product and FAQ navigation links', () => {
  const navigation = `<!-- <div class="DetailLink"><a href="/products/" class="Link Link-arrow Link-primary">商品ごとに探す</a></div> -->
    <!-- <div class="DetailLink"><a href="/rules/faq/" class="Link Link-arrow Link-primary">商品ごとに探す</a></div> -->`;
  assert.deepEqual(parsePokemonCardJp(navigation), []);
  assert.equal(parsePokemonCardJp(navigation + entry()).length, 1);
});

test('ignores commented, script, style and template copies of valid entries', () => {
  for (const wrap of [value => `<!-- ${value} -->`, ...['script', 'style', 'template'].map(tag => value => `<${tag}>${value}</${tag}>`)]) {
    assert.deepEqual(parsePokemonCardJp(wrap(entry())), []);
  }
});

test('requires an exact news-list class token, not keyword links or data-class', () => {
  for (const attrs of ['', 'class="Link"', 'class="List_item_inner_fake"', 'data-class="List_item_inner"']) {
    assert.deepEqual(parsePokemonCardJp(entry({ attrs })), []);
  }
  assert.equal(parsePokemonCardJp(entry({ attrs: "class='extra List_item_inner active'" })).length, 1);
});

test('excludes menu URLs even when given an article class and date', () => {
  for (const href of ['/', '/info/', '/products/', '/rules/faq/', '/rules/faq/search.php?q=card', '/card-search/index.php']) {
    assert.deepEqual(parsePokemonCardJp(entry({ href })), []);
  }
});

test('keeps official-list outbound articles and product announcements', () => {
  for (const href of ['https://www.pokemoncenter-online.com/news/?id=fixture', 'https://www.30th.pokemon-card.com/product/fixture', 'https://shibuyatsutaya.tsite.jp/article/fixture.html']) {
    assert.equal(parsePokemonCardJp(entry({ href }))[0].url, href);
  }
});

test('rejects non-HTTPS, credentials, malformed and fragment-only targets', () => {
  for (const href of ['javascript:alert(1)', 'data:text/html,card', 'http://example.test/card', 'https://user:password@example.test/card', 'https://[invalid', '#news']) {
    assert.deepEqual(parsePokemonCardJp(entry({ href })), []);
  }
});

test('decodes URL entities and ignores duplicate fragment variants', () => {
  const rows = parsePokemonCardJp(entry({ href: '/info/fixture.html?a=1&amp;b=2#top' }) + entry({ href: '/info/fixture.html?a=1&amp;b=2#news' }));
  assert.equal(rows.length, 1);
  assert.equal(rows[0].url, 'https://www.pokemon-card.com/info/fixture.html?a=1&b=2');
});

test('uses the Date field rather than a release date embedded in the title', () => {
  const [row] = parsePokemonCardJp(entry({ title: '2026.12.04 発売 カード案内', date: '2026.9.29' }));
  assert.equal(row.published_at, '2026-09-29T00:00:00+09:00');
});

test('does not invent a publication date from a title, missing or ambiguous fields', () => {
  assert.deepEqual(parsePokemonCardJp(entry({ title: '2026.9.29 商品情報', dateClass: 'NotDate' })), []);
  assert.deepEqual(parsePokemonCardJp(entry().replace('</a>', '<span class="Date">2026.9.30</span></a>')), []);
  assert.deepEqual(parsePokemonCardJp(entry({ date: '' })), []);
});

test('rejects impossible, incomplete and unparseable publication dates', () => {
  for (const date of ['2026.2.29', '2026.2.30', '2026.13.1', '2026.9.0', '2026.9', 'unknown', '2026.9.29 extra']) {
    assert.deepEqual(parsePokemonCardJp(entry({ date })), [], date);
  }
  assert.equal(parsePokemonCardJp(entry({ date: '2028.2.29' }))[0].published_at, '2028-02-29T00:00:00+09:00');
});

test('deduplicates before the 30-entry bound so tabs cannot consume the limit', () => {
  const duplicateTabs = entry().repeat(40);
  const unique = Array.from({ length: 40 }, (_, index) => entry({ href: `/info/fixture-${index}.html` })).join('');
  const rows = parsePokemonCardJp(duplicateTabs + unique);
  assert.equal(rows.length, 30);
  assert.equal(new Set(rows.map(row => row.url)).size, 30);
  assert.equal(rows[29].url, 'https://www.pokemon-card.com/info/fixture-28.html');
});

test('empty or changed provider markup produces no invented articles', () => {
  for (const html of [null, '', '<h1>カード ニュース</h1>', '<a href="/info/fixture.html">商品 2026.9.29</a>']) {
    assert.deepEqual(parsePokemonCardJp(html), []);
  }
});

test('endpoint combines genuine entries with other providers and retains headers', async () => {
  const savedFetch = globalThis.fetch;
  globalThis.fetch = async url => {
    if (url.includes('pokemon-card.com')) return new Response(entry() + '<a href="/products/">商品ごとに探す</a>');
    if (url.includes('pokebeach.com')) return new Response('<rss><item><title>Pokemon card test news</title><link>https://example.test/news</link><pubDate>Tue, 29 Sep 2026 00:00:00 GMT</pubDate></item></rss>');
    return Response.json({ users: [], topic_list: { topics: [{ id: 1, slug: 'test-card', title: 'Pokemon card test discussion', created_at: '2026-09-29T00:00:00Z', posts_count: 2 }] } });
  };
  try {
    const response = await onRequest({ request: new Request('https://cardpick.test/api/trend-events?limit=18') });
    const body = await response.json();
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('Cache-Control'), 'public, max-age=300, s-maxage=1800');
    assert.equal(body.count, 3);
    assert.deepEqual(new Set(body.items.map(item => item.source_type)), new Set(['official', 'news', 'community']));
    assert.deepEqual(body.errors, []);
    assert.ok(body.items.every(item => item.collected_at && Number.isFinite(item.priority)));
  } finally { globalThis.fetch = savedFetch; }
});

test('another provider failure does not restore discarded menus or hide valid news', async () => {
  const savedFetch = globalThis.fetch;
  globalThis.fetch = async url => url.includes('pokemon-card.com')
    ? new Response(entry() + '<!-- <a href="/rules/faq/">商品ごとに探す</a> -->')
    : new Response('unavailable', { status: 503 });
  try {
    const response = await onRequest({ request: new Request('https://cardpick.test/api/trend-events') });
    const body = await response.json();
    assert.equal(body.count, 1);
    assert.equal(body.errors.length, 2);
    assert.equal(response.headers.get('Cache-Control'), 'public, max-age=300, s-maxage=900');
    assert.ok(!JSON.stringify(body.items).includes('商品ごとに探す'));
  } finally { globalThis.fetch = savedFetch; }
});

async function collectFixture({ news = 30, trends = 20, limit = '18', failures = [] } = {}) {
  const savedFetch = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async url => {
    calls.push(url);
    const source = url.includes('pokemon-card.com') ? 'jpInfo' : url.includes('pokebeach.com') ? 'pokeBeachFeed' : 'eliteLatest';
    if (failures.includes(source)) return new Response('unavailable', { status: 503 });
    if (source === 'jpInfo') return new Response(Array.from({ length: news }, (_, index) => entry({ href: `/info/news-${index}.html` })).join(''));
    if (source === 'pokeBeachFeed') return new Response('<rss></rss>');
    return Response.json({ users: [], topic_list: { topics: Array.from({ length: trends }, (_, index) => ({
      id: index + 1, slug: `card-${index}`, title: `Pokemon PSA card discussion ${index}`,
      created_at: '2026-09-29T00:00:00Z', posts_count: 2,
    })) } });
  };
  try {
    const response = await onRequest({ request: new Request(`https://cardpick.test/api/trend-events?limit=${limit}`) });
    return { response, body: await response.json(), calls };
  } finally { globalThis.fetch = savedFetch; }
}

test('default selection reserves ten news and eight trends even when official news outranks every trend', async () => {
  const { body, calls } = await collectFixture();
  assert.equal(calls.length, 3, 'same three requests, without retries or new sources');
  assert.equal(body.count, 18);
  assert.equal(body.items.filter(item => item.source_type === 'official').length, 10);
  assert.equal(body.items.filter(item => item.source_type === 'community').length, 8);
  assert.deepEqual(Object.keys(body).sort(), ['count', 'elapsed_ms', 'errors', 'generated_at', 'items', 'sources']);
  assert.deepEqual(body.sources, ['jpInfo', 'pokeBeachFeed', 'eliteLatest']);
  assert.ok(body.items.every((item, index, items) => index === 0 || items[index - 1].priority >= item.priority));
  assert.equal(new Set(body.items.map(item => item.url)).size, 18);
});

test('unused bucket places are filled only from real available entries', async () => {
  for (const [news, trends, expectedNews, expectedTrends] of [[30, 0, 18, 0], [0, 30, 0, 18], [30, 2, 16, 2], [2, 30, 2, 16], [2, 1, 2, 1], [0, 0, 0, 0]]) {
    const { body } = await collectFixture({ news, trends });
    assert.equal(body.count, expectedNews + expectedTrends);
    assert.equal(body.items.filter(item => item.source_type === 'official').length, expectedNews);
    assert.equal(body.items.filter(item => item.source_type === 'community').length, expectedTrends);
    assert.deepEqual(body.errors, []);
  }
});

test('limits retain their clamp, fractional and malformed-input contract while preserving score order', async () => {
  for (const [limit, expected] of [['1', 1], ['2', 2], ['17', 17], ['18', 18], ['40', 40], ['100', 40], ['0', 1], ['-1', 1], ['1.9', 1], ['invalid', 0]]) {
    const { body } = await collectFixture({ news: 30, trends: 30, limit });
    assert.equal(body.count, expected, limit);
    assert.equal(body.items.length, expected, limit);
  }
});

test('normal empty, partial failure and total failure retain separate errors and original cache policies', async () => {
  const empty = await collectFixture({ news: 0, trends: 0 });
  const partial = await collectFixture({ news: 0, trends: 0, failures: ['eliteLatest'] });
  const failed = await collectFixture({ failures: ['jpInfo', 'pokeBeachFeed', 'eliteLatest'] });
  for (const result of [empty, partial, failed]) {
    assert.equal(result.response.status, 200);
    assert.equal(result.body.count, 0);
    assert.deepEqual(result.body.items, []);
    assert.equal(result.calls.length, 3);
  }
  assert.equal(empty.body.errors.length, 0);
  assert.equal(partial.body.errors.length, 1);
  assert.equal(failed.body.errors.length, 3);
  assert.equal(empty.response.headers.get('Cache-Control'), 'public, max-age=300, s-maxage=1800');
  for (const result of [partial, failed]) assert.equal(result.response.headers.get('Cache-Control'), 'public, max-age=300, s-maxage=900');
});
