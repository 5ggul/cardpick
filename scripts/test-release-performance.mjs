import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import config from './releases-tailwind.config.cjs';

const root = new URL('../', import.meta.url);
const html = readFileSync(new URL('releases.html', root), 'utf8').replace(/\r\n/g, '\n');
const css = readFileSync(new URL('styles/releases-base.css', root), 'utf8');
const sha = value => createHash('sha256').update(value).digest('hex');
const originalFontLinks = `<link rel="stylesheet" media="print" href="/styles/releases-fonts.css?v=20261001" onload="this.onload=null;this.media='all'">
<noscript><link rel="stylesheet" href="/styles/releases-fonts.css?v=20261001"></noscript>`;
const releaseFontDigest = '2acbfc3c826b9fe1b1b7a8b7e30ef71be2f0e67be0fdaf4b944a3bff2af6bd63';
const deferredListsDigest = '9e02e807b06b1c403ec44675af8d53d27d55538325cd9d03be9dcabd3e4b9e04';
const headReplacements = [
  ["  body { font-family: 'Cardpick Text', 'Pretendard', system-ui, sans-serif; -webkit-font-smoothing: antialiased; }",
   "  body { font-family: 'Pretendard', system-ui, sans-serif; -webkit-font-smoothing: antialiased; }"],
  ['.cp-footer .cp-legal{display:flex;flex-wrap:wrap;gap:14px;padding-top:16px;border-top:1px solid var(--cp-line);font-family:var(--cp-mono);font-size:11px;color:var(--cp-sub)}',
   '.cp-footer .cp-legal{display:flex;flex-wrap:wrap;gap:14px;padding-top:16px;border-top:1px solid var(--cp-line);font-family:var(--cp-mono);font-size:11px;color:var(--cp-dim)}'],
  ['.cp-footer h2{margin:0 0 10px;font-size:11px;color:var(--cp-fg);font-family:var(--cp-mono);letter-spacing:.14em;text-transform:uppercase;font-weight:600}',
   '.cp-footer h4{margin:0 0 10px;font-size:11px;color:var(--cp-fg);font-family:var(--cp-mono);letter-spacing:.14em;text-transform:uppercase;font-weight:600}'],
];
const accessibleBodyReplacements = [
  ['    <a href="/" class="cp-brand" aria-label="카드픽 CARDPICK 홈">',
   '    <a href="/" class="cp-brand" aria-label="카드픽 홈">'],
  ['        <h2>데이터</h2>', '        <h4>데이터</h4>'],
  ['        <h2>가이드</h2>', '        <h4>가이드</h4>'],
  ['        <h2>운영</h2>', '        <h4>운영</h4>'],
];

function normalizeApprovedDeferredLists(source) {
  const tags = source.match(/<style\b[^>]*\bid\s*=\s*["']releases-deferred-lists-css["'][^>]*>/gi) || [];
  const blocks = [...source.matchAll(/<style id="releases-deferred-lists-css">[\s\S]*?<\/style>/g)];
  assert.equal(tags.length, 1, 'one page-owned deferred-list style tag globally');
  assert.equal(blocks.length, 1, 'one exact deferred-list style wrapper');
  const block = blocks[0][0];
  assert.equal(sha(block), deferredListsDigest, 'only the measured three-wrapper CSS and its status escape are approved');
  assert.ok(source.includes('.cp-footer .cp-legal .cp-right{margin-left:auto;color:var(--cp-warn)}\n\n</style>\n'
    + block + '\n  <script defer src="/auth.js?v=v3clean"></script>'),
  'deferred-list CSS stays immediately after the owner stylesheet and before the auth script');
  assert.ok(source.indexOf(block) < source.indexOf('</head>'), 'the deferred-list stylesheet must stay in the head');
  return source.replace(block + '\n', '');
}

function assertApprovedHead(source) {
  const withoutDeferredLists = normalizeApprovedDeferredLists(source);
  const fontBlocks = [...source.matchAll(/<style id="releases-font-css">[\s\S]*?<\/style>/g)];
  assert.equal(fontBlocks.length, 1, 'one approved head-only font block');
  const fontBlock = fontBlocks[0][0];
  assert.equal(sha(fontBlock), releaseFontDigest, 'exact font ranges, URLs, strategy and four narrow UI aliases');
  const resource = fontBlock;
  const compiled = `<style id="release-base-css">${css.trim()}</style>`;
  assert.equal(source.split(resource).length - 1, 1);
  assert.equal(source.split('/fonts/cardpick-text/releases.woff2').length - 1, 1);
  assert.doesNotMatch(source, /<link[^>]*rel="preload"[^>]*href="\/fonts\/cardpick-text\/releases\.woff2"/);
  assert.equal(source.split(compiled).length - 1, 1);
  assert.ok(source.includes('<link rel="preconnect" href="https://cdn.jsdelivr.net" crossorigin>\n' + compiled + '\n' + resource + '\n\n<style>'),
    'resources retain the exact precompiled-CSS/head-font/owner-style order');
  assert.ok(source.indexOf(resource) < source.indexOf('</head>'));
  assert.equal((css.match(/font-display:optional/g) || []).length, 15);
  assert.doesNotMatch(css, /font-display:swap/);
  assert.ok(css.endsWith('\n') && !css.endsWith('\n\n'), 'one deterministic generated line ending');
  const originalCss = css.slice(0, -1).replace(/font-display:optional/g, 'font-display:swap').replace(/\r\n/g, '\n');
  assert.equal(sha(originalCss), '53577e226168d626698a5d3b9b019fee1f4f14126d746e9a79a6d5b05d7a6c10',
    'all generated utilities and original face URLs/weights remain unchanged');
  let normalized = withoutDeferredLists.replace(resource, originalFontLinks)
    .replace(compiled, `<style id="release-base-css">${originalCss.trim()}</style>`);
  for (const [after, before] of headReplacements) {
    assert.equal(source.split(after).length - 1, 1);
    assert.equal(source.split(before).length - 1, 0);
    normalized = normalized.replace(after, before);
  }
  let head = normalized.split('</head>')[0];
  const dailyRegions = [...head.matchAll(/<!-- CAL:([A-Z-]+):START -->([\s\S]*?)<!-- CAL:\1:END -->/g)];
  assert.equal(dailyRegions.length, 1);
  assert.equal(dailyRegions[0][1], 'LD-UPCOMING');
  const dailyScript = dailyRegions[0][2].match(/^\s*<script type="application\/ld\+json">([\s\S]*?)<\/script>\s*$/);
  assert.ok(dailyScript, 'the daily head region accepts only its existing JSON-LD wrapper, never HTML/executable code');
  const dailyList = JSON.parse(dailyScript[1]);
  assert.deepEqual(Object.keys(dailyList).sort(), ['@context', '@type', 'description', 'itemListElement', 'itemListOrder', 'name']);
  assert.equal(dailyList['@type'], 'ItemList');
  assert.equal(dailyList['@context'], 'https://schema.org');
  assert.equal(dailyList.name, '포켓몬 카드 다가오는 발매 일정');
  assert.equal(dailyList.description, '카드픽이 공식 원문에서 확인한 포켓몬 카드 발매일입니다. 전체 발표 목록을 뜻하지 않습니다.');
  assert.equal(dailyList.itemListOrder, 'https://schema.org/ItemListOrderAscending');
  assert.ok(Array.isArray(dailyList.itemListElement));
  dailyList.itemListElement.forEach((item, index) => {
    assert.deepEqual(Object.keys(item).sort(), ['@type', 'description', 'item', 'name', 'position']);
    assert.equal(item['@type'], 'ListItem');
    assert.equal(item.position, index + 1);
    assert.equal(item.item, 'https://cardpick.kr/releases#cal');
    assert.equal(typeof item.name, 'string');
    assert.match(item.description, /^(?:한국판|일본판|영문판) 발매일 \d{4}-\d{2}-\d{2}$/);
  });
  head = head.replace(dailyRegions[0][0], '');
  const faq = [...head.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)]
    .map(match => JSON.parse(match[1])).filter(value => value['@type'] === 'FAQPage');
  assert.equal(faq.length, 1);
  // Preserve the existing daily FAQ renderer contract, not arbitrary schema text.
  const answer = source.match(/<!-- CAL:FAQ1:START -->\s*([\s\S]*?)\s*<!-- CAL:FAQ1:END -->/)[1];
  assert.equal(faq[0].mainEntity[0].acceptedAnswer.text, answer);
  const dailyAnswer = JSON.stringify(answer);
  assert.equal(head.split(dailyAnswer).length - 1, 1);
  head = head.replace(dailyAnswer, '"__DAILY_FAQ1__"');
  assert.equal(sha(head), '891c6852c6d999c3e4e26f9c8d657052d738ea665d31ab3769c882ac03a6f8cd',
    'original metadata, calendar schema, owner styles and resource positions are preserved');
}

// Keep the original body digest. Only these two reviewed news-status functions
// may be restored before comparing it; never broadly strip inline scripts.
const approvedNews = {
  renderMeta: {
    before: String.raw`  function renderMeta(el, body, label){
    if (!el) return;
    var sourceCount = body.sources ? body.sources.length : 0;
    el.textContent = label + ' · generated ' + fmtShortDate(body.generated_at) + ' · sources ' + sourceCount + (body.errors && body.errors.length ? ' · partial' : '');
  }`,
    after: String.raw`  function renderMeta(el, body, label){
    if (!el) return;
    var sourceCount = Array.isArray(body.sources) ? body.sources.length : 0;
    var failedCount = Array.isArray(body.errors) ? body.errors.length : 0;
    el.textContent = label + ' · 조회 ' + fmtShortDate(body.generated_at) + ' · 출처 ' + sourceCount + '곳'
      + (failedCount ? ' · 일부 출처 조회 실패 (' + failedCount + '/' + sourceCount + ')' : '');
  }`,
  },
  renderTrendEvents: {
    before: String.raw`  async function renderTrendEvents(){
    var newsList = document.getElementById('news-events-list');
    var trendList = document.getElementById('trend-events-list');
    var newsMeta = document.getElementById('news-events-meta');
    var trendMeta = document.getElementById('trend-events-meta');
    if (!newsList && !trendList) return;
    try {
      var res = await fetch('/api/trend-events?limit=18', { cache: 'no-cache' });
      if (!res.ok) throw new Error('API ' + res.status);
      var body = await res.json();
      if (!body.items || !body.items.length) {
        renderEventBucket(newsList, [], '현재 표시할 뉴스·소식이 없습니다.');
        renderEventBucket(trendList, [], '현재 표시할 트렌드가 없습니다.');
        return;
      }
      var trendItems = body.items.filter(isTrendItem).slice(0, 8);
      var newsItems = body.items.filter(function(item){ return !isTrendItem(item); }).slice(0, 10);
      renderEventBucket(newsList, newsItems, '현재 표시할 뉴스·소식이 없습니다.');
      renderEventBucket(trendList, trendItems, '현재 표시할 트렌드가 없습니다.');
      renderMeta(newsMeta, body, 'news');
      renderMeta(trendMeta, body, 'trend');
    } catch (e) {
      console.warn('trend-events', e);
      renderEventBucket(newsList, [], '뉴스·소식 데이터를 불러오지 못했습니다. 발매 목록은 계속 사용할 수 있습니다.');
      renderEventBucket(trendList, [], '트렌드 데이터를 불러오지 못했습니다. 발매 목록은 계속 사용할 수 있습니다.');
      if (newsMeta) newsMeta.textContent = 'news radar unavailable';
      if (trendMeta) trendMeta.textContent = 'trend radar unavailable';
    }
  }`,
    after: String.raw`  async function renderTrendEvents(){
    var newsList = document.getElementById('news-events-list');
    var trendList = document.getElementById('trend-events-list');
    var newsMeta = document.getElementById('news-events-meta');
    var trendMeta = document.getElementById('trend-events-meta');
    if (!newsList && !trendList) return;
    try {
      var res = await fetch('/api/trend-events?limit=18', { cache: 'no-cache' });
      if (!res.ok) throw new Error('API ' + res.status);
      var body = await res.json();
      if (!body || !Array.isArray(body.items) || !Array.isArray(body.sources) || !Array.isArray(body.errors)) throw new Error('Invalid news response');
      var failedCount = body.errors.length;
      if (!body.items.length && body.sources.length && failedCount >= body.sources.length) {
        renderEventBucket(newsList, [], '모든 출처의 뉴스·소식을 불러오지 못했습니다. 발매 목록은 계속 사용할 수 있습니다.');
        renderEventBucket(trendList, [], '모든 출처의 트렌드를 불러오지 못했습니다. 발매 목록은 계속 사용할 수 있습니다.');
        if (newsMeta) newsMeta.textContent = '뉴스·소식 · 전체 출처 조회 실패';
        if (trendMeta) trendMeta.textContent = '트렌드 · 전체 출처 조회 실패';
        return;
      }
      var trendItems = body.items.filter(isTrendItem).slice(0, 8);
      var newsItems = body.items.filter(function(item){ return !isTrendItem(item); }).slice(0, 10);
      renderEventBucket(newsList, newsItems, failedCount ? '일부 출처를 불러오지 못했습니다. 조회된 자료에는 표시할 뉴스·소식이 없습니다.' : '현재 표시할 뉴스·소식이 없습니다.');
      renderEventBucket(trendList, trendItems, failedCount ? '일부 출처를 불러오지 못했습니다. 조회된 자료에는 표시할 트렌드가 없습니다.' : '현재 표시할 트렌드가 없습니다.');
      renderMeta(newsMeta, body, '뉴스·소식');
      renderMeta(trendMeta, body, '트렌드');
    } catch (e) {
      console.warn('trend-events', e);
      renderEventBucket(newsList, [], '뉴스·소식 데이터를 불러오지 못했습니다. 발매 목록은 계속 사용할 수 있습니다.');
      renderEventBucket(trendList, [], '트렌드 데이터를 불러오지 못했습니다. 발매 목록은 계속 사용할 수 있습니다.');
      if (newsMeta) newsMeta.textContent = '뉴스·소식 · 불러오기 실패';
      if (trendMeta) trendMeta.textContent = '트렌드 · 불러오기 실패';
    }
  }`,
  },
};

function normalizeApprovedNews(source) {
  // Releases has no ad loader/unit at the immutable baseline. Check globally so
  // an ad inserted even into a daily-generated region cannot be normalized away.
  assert.doesNotMatch(source, /adsbygoogle|data-ad-(?:client|slot)|pagead2\.googlesyndication\.com|<script\b[^>]*\bsrc=["']\/(?:cp-)?ads\.js/i,
    'The existing release-page advertisement state must remain unchanged');
  assert.ok(source.includes("    el.innerHTML = items.map(trendRow).join('');\n  }\n"
    + approvedNews.renderMeta.after + '\n' + approvedNews.renderTrendEvents.after + '\n  function row(s){'),
  'The two reviewed functions must remain at their original ordered script boundary');
  let normalized = source;
  for (const [name, block] of Object.entries(approvedNews)) {
    assert.equal(source.split(block.after).length - 1, 1, `Only one exact approved ${name} block is accepted`);
    assert.equal(source.split(block.before).length - 1, 0, `Stale ${name} blocks are not accepted`);
    assert.equal((source.match(new RegExp('\\bfunction ' + name + '\\(', 'g')) || []).length, 1,
      `No extra ${name} declaration is approved`);
    assert.ok(source.indexOf(block.after) > source.indexOf('</head>'), `${name} must remain in the body script`);
    normalized = normalized.replace(block.after, block.before);
  }
  return normalized;
}

function assertOriginalBody(source) {
  let normalized = normalizeApprovedNews(source);
  for (const [after, before] of accessibleBodyReplacements) {
    assert.equal(source.split(after).length - 1, 1, 'one exact approved accessible-name/footer-heading replacement');
    assert.equal(source.split(before).length - 1, 0, 'the stale accessible name or footer heading is not accepted');
    assert.ok(source.indexOf(after) > source.indexOf('</head>'), 'semantic changes remain in the original body');
    normalized = normalized.replace(after, before);
  }
  const body = normalized.split('</head>')[1]
    .replace(/<!-- CAL:[A-Z-]+:START -->[\s\S]*?<!-- CAL:[A-Z-]+:END -->/g, '');
  assert.equal(createHash('sha256').update(body).digest('hex'),
    '160047112b17870ed54b87d1e94b398609806e5de1984d66f6a30f41246d5af1');
}

test('performance work preserves the body outside daily regions and the exact approved news/semantic changes', () => {
  assertOriginalBody(html);
});

test('accessible-name and footer-heading normalization rejects altered, stale, duplicate or moved changes', () => {
  const [brand] = accessibleBodyReplacements;
  const heading = accessibleBodyReplacements[1][0];
  const cases = [
    ['wrong brand name', html.replace(brand[0], brand[0].replace('CARDPICK', 'CARD'))],
    ['stale brand name', html.replace(brand[0], brand[1])],
    ['duplicate brand', html.replace(brand[0], brand[0].repeat(2))],
    ['brand moved', html.replace(brand[0], '').replace('<!-- FOOTER -->', brand[0] + '\n<!-- FOOTER -->')],
    ['wrong heading level', html.replace(heading, '        <h3>데이터</h3>')],
    ['stale footer heading', html.replace(heading, accessibleBodyReplacements[1][1])],
    ['changed heading copy', html.replace(heading, '        <h2>전체 데이터</h2>')],
    ['duplicate footer heading', html.replace(heading, heading.repeat(2))],
    ['heading moved', html.replace(heading, '').replace('<!-- FOOTER -->', heading + '\n<!-- FOOTER -->')],
    ['heading moved into head', html.replace(heading, '').replace('</head>', heading + '\n</head>')],
  ];
  for (const [name, changed] of cases) {
    assert.notEqual(changed, html, `${name}: fixture must change`);
    assert.throws(() => assertOriginalBody(changed), { code: 'ERR_ASSERTION' }, name);
  }
});

test('news normalization rejects altered, missing, duplicate, moved or stale approved blocks', () => {
  const cases = [
    ['changed status copy', html.replace('뉴스·소식 · 전체 출처 조회 실패', '뉴스·소식 · 정상')],
    ['changed source count', html.replace('var sourceCount = Array.isArray(body.sources) ? body.sources.length : 0;', 'var sourceCount = 99;')],
    ['changed total-failure condition', html.replace('failedCount >= body.sources.length', 'failedCount > body.sources.length')],
    ['script inside approved block', html.replace(approvedNews.renderMeta.after, approvedNews.renderMeta.after.replace('    if (!el) return;', '    fetch("/unapproved");\n    if (!el) return;'))],
    ['missing metadata block', html.replace(approvedNews.renderMeta.after, '')],
    ['duplicate metadata block', html.replace(approvedNews.renderMeta.after, approvedNews.renderMeta.after.repeat(2))],
    ['missing event block', html.replace(approvedNews.renderTrendEvents.after, '')],
    ['duplicate event block', html.replace(approvedNews.renderTrendEvents.after, approvedNews.renderTrendEvents.after.repeat(2))],
    ['moved metadata block', html.replace(approvedNews.renderMeta.after, '').replace('</body>', '<script>\n' + approvedNews.renderMeta.after + '\n</script></body>')],
    ['moved functions into head', html.replace(approvedNews.renderMeta.after + '\n' + approvedNews.renderTrendEvents.after, '')
      .replace('</head>', '<script>\n' + approvedNews.renderMeta.after + '\n' + approvedNews.renderTrendEvents.after + '\n</script></head>')],
    ['stale metadata block', html.replace(approvedNews.renderMeta.after, approvedNews.renderMeta.before)],
    ['stale event block', html.replace(approvedNews.renderTrendEvents.after, approvedNews.renderTrendEvents.before)],
    ['changed request limit', html.replace('/api/trend-events?limit=18', '/api/trend-events?limit=40')],
    ['changed trend cap', html.replace('body.items.filter(isTrendItem).slice(0, 8)', 'body.items.filter(isTrendItem).slice(0, 18)')],
    ['changed news cap', html.replace('return !isTrendItem(item); }).slice(0, 10)', 'return !isTrendItem(item); }).slice(0, 20)')],
  ];
  for (const [name, changed] of cases) {
    assert.notEqual(changed, html, `${name}: fixture must change`);
    assert.throws(() => assertOriginalBody(changed), { code: 'ERR_ASSERTION' }, name);
  }
});

test('the original body hash and advertisement guard still reject unrelated content and ad changes', () => {
  const adLoader = '<script async src="https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js"></script>';
  const adUnit = '<ins class="adsbygoogle" data-ad-slot="0000000000"></ins>';
  const cases = [
    ['unrelated body injection', html.replace('</body>', '<p>Unapproved body content</p></body>')],
    ['unrelated renderer change', html.replace("var days = daysFromToday(s.release_date);", 'var days = 999;')],
    ['body ad injection', html.replace('</body>', adUnit + '</body>')],
    ['head SDK injection', html.replace('</head>', adLoader + '</head>')],
    ['ad inside daily region', html.replace('<!-- CAL:FAQ1:START -->', '<!-- CAL:FAQ1:START -->' + adUnit)],
  ];
  for (const [name, changed] of cases) {
    assert.notEqual(changed, html, `${name}: fixture must change`);
    assert.throws(() => assertOriginalBody(changed), { code: 'ERR_ASSERTION' }, name);
  }
});

test('release page uses precompiled styles with original colors and responsive utilities', () => {
  assert.doesNotMatch(html, /cdn\.tailwindcss\.com|tailwind\.config/);
  assert.equal(html.match(/<style id="release-base-css">([\s\S]*?)<\/style>/)[1], css.trim());
  assert.match(css, /tailwindcss v3\.4\.17/);
  assert.deepEqual(config.theme.extend.colors, {
    bg: '#080B10', panel: '#111620', panel2: '#151B26', line: '#253044',
    ink: '#E8EEF7', muted: '#8B96A8', up: '#12D6B0', down: '#FF4D6D', gold: '#F2C94C', brand: '#26E0C2',
  });
  for (const selector of ['.hidden{', '.sm\\:block{', '.lg\\:px-8{', '.max-w-\\[1440px\\]', '.sm\\:text-\\[46px\\]', '.lg\\:text-\\[54px\\]', '.hover\\:bg-panel2:hover']) {
    assert.ok(css.includes(selector), `Missing ${selector}`);
  }
  assert.ok(config.content.files.includes('./scripts/build_release_calendar.py'));
  assert.equal(config.content.transform.html('<style id="release-base-css">compiled</style><div class="hidden">keep</div>'), '<div class="hidden">keep</div>');
  assert.ok(Buffer.byteLength(css) < 25000);
});

test('page fonts are declared before paint and preserve the original head outside exact approved changes', () => {
  assertApprovedHead(html);
  assert.doesNotMatch(html, /fonts\.googleapis\.com|fonts\.gstatic\.com/);
  assert.doesNotMatch(html, /<link[^>]+releases-fonts\.css|media="print"/);
  const fonts = readFileSync(new URL('styles/releases-fonts.css', root), 'utf8');
  assert.match(fonts, /SIL Open Font License/);
  assert.match(fonts, /font-family: 'Pretendard'/);
  assert.match(fonts, /font-weight: 45 920/);
  assert.doesNotMatch(fonts, /font-display: swap/);
  const faces = [...fonts.matchAll(/@font-face\s*\{([^}]+)\}/g)];
  assert.ok(faces.length > 50, 'Keep all upstream character ranges, including future calendar names');
  for (const [, face] of faces) {
    assert.match(face, /font-display: optional/);
    assert.match(face, /unicode-range:/);
    assert.match(face, /url\(https:\/\/cdn\.jsdelivr\.net\/gh\/orioncactus\/pretendard@v1\.3\.9\/packages\/pretendard\/dist\/web\/variable\/woff2-dynamic-subset\/PretendardVariable\.subset\.\d+\.woff2\)/);
  }
  for (const [, path] of css.matchAll(/url\((\/fonts\/[^)]+)\)/g)) {
    assert.ok(existsSync(new URL(path.slice(1), root)), `Missing ${path}`);
  }
  assert.ok(existsSync(new URL('fonts/ibm-plex-mono/OFL.txt', root)));
});

test('measured deferred-list CSS is narrowly scoped, head-owned and reversible without changing the original head digest', () => {
  const normalized = normalizeApprovedDeferredLists(html);
  assert.equal((html.match(/content-visibility:auto/g) || []).length, 2, 'one support query and one three-wrapper declaration');
  assert.doesNotMatch(normalized, /content-visibility|contain-intrinsic-size|releases-deferred-lists-css/);
  assertApprovedHead(html);
  assertOriginalBody(html);
});

test('deferred-list guard rejects altered, missing, duplicate, moved, expanded, hidden or fixed-height CSS and SEO/ad changes', () => {
  const block = html.match(/<style id="releases-deferred-lists-css">[\s\S]*?<\/style>/)[0];
  const changedBlock = value => html.replace(block, value);
  const narrowBypass = '  @media (max-width:349px) {\n'
    + '    #rel-archive,#news-events-list,#trend-events-list { content-visibility:visible; contain-intrinsic-size:none; }\n  }\n';
  const cases = [
    ['changed measured archive fallback', changedBlock(block.replace('8795.5px', '9000px'))],
    ['changed measured news fallback', changedBlock(block.replace('889px', '1000px'))],
    ['changed measured trend fallback', changedBlock(block.replace('66px', '80px'))],
    ['changed responsive boundary', changedBlock(block.replace('min-width:640px', 'min-width:768px'))],
    ['narrow viewport bypass removed', changedBlock(block.replace(narrowBypass, ''))],
    ['narrow viewport bypass threshold changed', changedBlock(block.replace('max-width:349px', 'max-width:319px'))],
    ['missing owner block', changedBlock('')],
    ['duplicate owner block', changedBlock(block + '\n' + block)],
    ['duplicate style id', changedBlock(block + '\n<style id="releases-deferred-lists-css" media="print"></style>')],
    ['renamed owner block', changedBlock(block.replace('releases-deferred-lists-css', 'deferred-lists-css'))],
    ['moved owner block within head', changedBlock('').replace('</head>', block + '\n</head>')],
    ['moved owner block into body', changedBlock('').replace('</body>', block + '\n</body>')],
    ['moved owner block before fonts', changedBlock('').replace('<style id="releases-font-css">', block + '\n<style id="releases-font-css">')],
    ['wrapper scope expanded', changedBlock(block.replace('#rel-archive,#news-events-list,#trend-events-list', '#main,#rel-archive,#news-events-list,#trend-events-list'))],
    ['additional release wrapper', changedBlock(block.replace('#rel-archive,#news-events-list,#trend-events-list', '#rel-archive,#news-events-list,#trend-events-list,#rel-recent'))],
    ['containment outside support query', changedBlock(block.replace('@supports (content-visibility:auto)', '@media (min-width:1px)'))],
    ['hidden list content', changedBlock(block.replace('{ content-visibility:auto; }', '{ content-visibility:hidden; }'))],
    ['display none added', changedBlock(block.replace('{ content-visibility:auto; }', '{ content-visibility:auto; display:none; }'))],
    ['fixed height added', changedBlock(block.replace('contain-intrinsic-size:auto 0px auto 8795.5px;', 'height:8795.5px; contain-intrinsic-size:auto 0px auto 8795.5px;'))],
    ['max-height added', changedBlock(block.replace('contain-intrinsic-size:auto 0px auto 8795.5px;', 'max-height:8795.5px; contain-intrinsic-size:auto 0px auto 8795.5px;'))],
    ['status escape removed', changedBlock(block.replace('content-visibility:visible; contain-intrinsic-size:none;', 'content-visibility:auto;'))],
    ['unrelated rule added', changedBlock(block.replace('</style>', 'body{overflow:hidden}</style>'))],
    ['extra rule outside owner block', changedBlock(block + '\n<style>#rel-archive{height:8795.5px}</style>')],
    ['ad SDK added outside owner block', html.replace('</head>', '<script async src="https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js"></script></head>')],
    ['canonical changed outside owner block', html.replace('rel="canonical" href="https://cardpick.kr/releases"', 'rel="canonical" href="https://cardpick.kr/"')],
    ['robots changed outside owner block', html.replace('index,follow,max-image-preview:large,max-snippet:-1', 'noindex,follow')],
  ];
  for (const [name, changed] of cases) {
    assert.notEqual(changed, html, `${name}: fixture must change`);
    assert.throws(() => assertApprovedHead(changed), { code: 'ERR_ASSERTION' }, name);
  }
});

test('head guard rejects altered, duplicate, moved or late fonts, unrelated CSS/SEO and blind space reservation', () => {
  const fontBlock = html.match(/<style id="releases-font-css">[\s\S]*?<\/style>/)[0];
  const resource = fontBlock;
  const cases = [
    ['regressing font preload reintroduced', html.replace(fontBlock, '<link rel="preload" href="/fonts/cardpick-text/releases.woff2" as="font" type="font/woff2" crossorigin>\n' + fontBlock)],
    ['font CSS injection', html.replace(fontBlock, fontBlock.replace('</style>', 'body{display:none}</style>'))],
    ['font URL changed', html.replace('/fonts/cardpick-text/releases.woff2', '/fonts/cardpick-text/card.woff2')],
    ['late swap restored', html.replace('font-display:optional', 'font-display:swap')],
    ['missing font block', html.replace(resource, '')],
    ['duplicate font block', html.replace(resource, resource + '\n' + resource)],
    ['font block moved within head', html.replace(resource, '').replace('</head>', resource + '\n</head>')],
    ['font block moved to body', html.replace(resource, '').replace('</body>', resource + '\n</body>')],
    ['search alias removed', html.replace('#cp-user-menu,#cp-search-results', '#cp-user-menu')],
    ['footer contrast reverted', html.replace(headReplacements[1][0], headReplacements[1][1])],
    ['footer heading selector reverted', html.replace(headReplacements[2][0], headReplacements[2][1])],
    ['footer heading appearance changed', html.replace(headReplacements[2][0], headReplacements[2][0].replace('font-size:11px', 'font-size:20px'))],
    ['footer heading selector broadened', html.replace(headReplacements[2][0], headReplacements[2][0].replace('.cp-footer h2', 'h2'))],
    ['global dim color changed', html.replace('--cp-dim:#5B6577', '--cp-dim:#8B96A8')],
    ['new fixed jump height', html.replace('.release-jump a {', '.release-jump{height:148px}\n  .release-jump a {')],
    ['unrelated heading CSS changed', html.replace('font-weight: 900;', 'font-weight: 400;')],
    ['executable code in daily head region', html.replace('<!-- CAL:LD-UPCOMING:START -->', '<!-- CAL:LD-UPCOMING:START --><script>unapproved()</script>')],
    ['unapproved offer schema in daily region', html.replace('"itemListOrder": "https://schema.org/ItemListOrderAscending",', '"itemListOrder": "https://schema.org/ItemListOrderAscending", "offers": {"price": 1},')],
    ['canonical changed', html.replace('rel="canonical" href="https://cardpick.kr/releases"', 'rel="canonical" href="https://cardpick.kr/"')],
    ['ad SDK inserted into head', html.replace('</head>', '<script async src="https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js"></script></head>')],
  ];
  for (const [name, changed] of cases) {
    assert.ok(changed !== html, `${name}: fixture must change`);
    assert.throws(() => assertApprovedHead(changed), { code: 'ERR_ASSERTION' }, name);
  }
});

test('shared auth and search keep their order and no longer block parsing', () => {
  const auth = '<script defer src="/auth.js?v=v3clean"></script>';
  const search = '<script defer src="/search.js?v=20260519ko"></script>';
  assert.ok(html.includes(auth) && html.includes(search));
  assert.ok(html.indexOf(auth) < html.indexOf(search));
});

test('canonical, robots and structured data remain present', () => {
  assert.match(html, /<link rel="canonical" href="https:\/\/cardpick.kr\/releases">/);
  assert.match(html, /<meta name="robots" content="index,follow,max-image-preview:large,max-snippet:-1">/);
  const schemas = [...html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)].map(match => JSON.parse(match[1]));
  assert.deepEqual(schemas.map(value => value['@type']).sort(), ['BreadcrumbList', 'FAQPage', 'ItemList']);
  const answer = html.match(/<!-- CAL:FAQ1:START -->\s*([\s\S]*?)\s*<!-- CAL:FAQ1:END -->/)[1];
  assert.equal(schemas.find(value => value['@type'] === 'FAQPage').mainEntity[0].acceptedAnswer.text, answer);
});
