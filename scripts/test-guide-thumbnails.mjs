import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createHash } from 'node:crypto';
import { onRequest } from '../functions/guides.js';
import guidesBaseCss from '../functions/_lib/guides-style.js';
import { restoreGrowth17GuideHtml } from './test-growth-navigation-contract.mjs';

const root = new URL('../', import.meta.url);
const response = await onRequest();
const html = await response.text();
const thumbnailPattern = /<img\b[^>]*class="hero-img"[^>]*>/g;
const cards = [...html.matchAll(/<a href="([^"]+)" class="guide-card group"[^>]*>([\s\S]*?)<\/a>/g)]
  .map(([, href, body]) => ({ href, body, tag: body.match(/<img\b[^>]*class="hero-img"[^>]*>/)?.[0] }));
const approvedFakeGuideCopy = {
  title: {
    before: '포켓몬 카드 가품 판별법 가이드 — 인쇄·홀로·잉크·모서리·무게 5가지 신호',
    after: '포켓몬 카드 가품 판별법 가이드: 거래 전 비교 항목과 확인 절차',
  },
  excerpt: {
    before: '인쇄 결, 홀로 패턴, 카드 뒷면 잉크 두께, 모서리 절단면, 두께·무게까지 5가지 식별 신호. 자주 출몰하는 가품 카드(리자몽 ex SAR 등), 메루카리·중고나라 의심 신호, PSA 슬랩 위조 확인까지.',
    after: '같은 언어판·세트·번호·가공을 기준으로 비교하고, 판매자에게 요청할 사진과 무게·가격·PSA 인증번호 조회의 한계를 확인합니다.',
  },
};
const approvedPsaExcerpt = {
  before: '한국에서 PSA로 카드 보내는 가이드. 비용·기간·신청 단계·자주 하는 실수 7가지·BRG10 비교까지 처음 보내는 분도 한 번에.',
  after: '한국에서 PSA로 카드를 보내는 절차와 비용 항목, 직접 접수·대행 선택, 포장·배송 전 확인 사항을 정리합니다.',
};
const approvedPriceGuideCopy = {
  title: {
    before: '포켓몬 카드 가격 보는 법: 시세 확인법과 정해지는 원리',
    after: '포켓몬 카드 시세 확인법: 카드 번호·TCGplayer·eBay 가격 읽기',
  },
  excerpt: {
    before: '포켓몬 카드 가격이 정해지는 4가지 요인(레어도·상태·인기·수요), 같은 카드인데 가격이 다른 이유, 국내 거래가와 해외(TCGplayer 북미) 참고가 차이, 카드픽에서 시세 확인하는 법까지. 구체 금액 단정 대신 원리 중심.',
    after: '코코리·큐레무 ex 사례로 카드 이름·세트·번호·레어도를 맞추고, 언어판·가공과 Raw·PSA를 구분해 TCGplayer 참고가·eBay 판매 완료 가격·국내 거래가를 비교하는 순서를 설명합니다.',
  },
};
const approvedRarityExcerpt = {
  before: 'SAR · SIR · UR · HR · IR · AR · RR · R · U · C 한국어 등급 체계 정리. 등급별 가격대 비교, 카드 표기 식별법, SV 시리즈 신규 등급, 자주 헷갈리는 5가지까지.',
  after: 'AR·SAR와 IR·SIR을 판본별로 구분하고 일본판 MEGA의 MUR·MA 코드를 공식 자료로 확인합니다. 제품·번호·레어도를 대조하며 다른 언어판이나 가격 순위로 자동 대응하지 않습니다.',
};
const approvedHeaderCss = '  /* Page-owned header touch targets and keyboard focus. */\n'
  + '  .cp-topbar .cp-brand,.cp-topbar .cp-nav a{display:inline-flex;align-items:center;min-height:44px}\n'
  + '  .cp-topbar .cp-search{min-height:44px}\n'
  + '  .cp-topbar .cp-login-google{height:auto;min-height:44px}\n'
  + '  .cp-topbar a:focus-visible,.cp-topbar button:focus-visible,.cp-topbar input:focus-visible{outline:2px solid #26E0C2;outline-offset:2px}\n\n';

const compiledGuideCss = fs.readFileSync(new URL('styles/guides-base.css', root), 'utf8').replaceAll('\r\n', '\n');
function assertReviewedGuideFontStrategy(css) {
  assert.equal(createHash('sha256').update(compiledGuideCss).digest('hex'),
    '26527124e42a52d5dc55d010bf33997f5ac0cd5f89a36cf2e79b91a0bca6bf14',
    'Shared compiled CSS remains unchanged');
  const faces = [...css.matchAll(/@font-face\{[^}]*\}/g)];
  assert.equal(faces.length, 15);
  for (const [face] of faces) {
    assert.equal((face.match(/font-display:optional/g) || []).length, 1);
    assert.match(face, /font-family:IBM Plex Mono;/);
    assert.match(face, /font-weight:(400|500|600);/);
    assert.match(face, /src:url\(\/fonts\/ibm-plex-mono\/[-\w]+\.woff2\) format\("woff2"\)/);
  }
  assert.doesNotMatch(css, /font-display:swap/);
  assert.equal(css.replace(/@font-face\{[^}]*\}/g, face => face.replace('font-display:optional', 'font-display:swap')),
    compiledGuideCss.trim(), 'Exact optional-only transformation: all other CSS bytes are immutable');
}

function attributes(tag) {
  assert.ok(tag?.startsWith('<img '), 'Each guide card must contain an image');
  const result = {};
  const remaining = tag.slice(4, -1).replace(/\s+([\w:-]+)="([^"]*)"/g, (_, name, value) => {
    assert.equal(Object.hasOwn(result, name), false, `Duplicate image attribute: ${name}`);
    result[name] = value;
    return '';
  });
  assert.equal(remaining.trim(), '', `Malformed/unquoted image attributes: ${remaining}`);
  return result;
}

function webpDimensions(url) {
  const parsed = new URL(url, 'https://cardpick.kr');
  assert.equal(parsed.origin, 'https://cardpick.kr', 'Thumbnail must stay local');
  assert.match(parsed.pathname, /^\/images\/guides\/[\w-]+\.webp$/);
  const path = new URL(parsed.pathname.slice(1), root);
  assert.ok(fs.existsSync(path), `Missing thumbnail: ${parsed.pathname}`);
  const bytes = fs.readFileSync(path);
  assert.equal(bytes.toString('ascii', 0, 4), 'RIFF', `Not a RIFF image: ${url}`);
  assert.equal(bytes.toString('ascii', 8, 12), 'WEBP', `Not a WebP image: ${url}`);
  for (let p = 12; p + 8 <= bytes.length;) {
    const kind = bytes.toString('ascii', p, p + 4);
    const length = bytes.readUInt32LE(p + 4);
    const start = p + 8;
    assert.ok(start + length <= bytes.length, `Truncated WebP chunk: ${url}`);
    if (kind === 'VP8X') return { width: bytes.readUIntLE(start + 4, 3) + 1, height: bytes.readUIntLE(start + 7, 3) + 1 };
    if (kind === 'VP8 ') return { width: bytes.readUInt16LE(start + 6) & 0x3fff, height: bytes.readUInt16LE(start + 8) & 0x3fff };
    if (kind === 'VP8L') {
      const value = bytes.readUInt32LE(start + 1);
      return { width: (value & 0x3fff) + 1, height: ((value >>> 14) & 0x3fff) + 1 };
    }
    p = start + length + (length % 2);
  }
  assert.fail(`No dimensions in WebP: ${url}`);
}

function candidates(srcset) {
  assert.ok(srcset, 'srcset is required');
  return srcset.split(',').map(value => {
    const match = value.trim().match(/^(\S+) ([1-9]\d*)w$/);
    assert.ok(match, `Malformed srcset candidate: ${value}`);
    return { url: match[1], width: Number(match[2]) };
  });
}

test('guide response remains successful with the same headers and all 39 cards', () => {
  assert.equal(response.status, 200);
  assert.deepEqual(Object.fromEntries(response.headers), {
    'cache-control': 'public, max-age=300',
    'content-type': 'text/html; charset=utf-8',
    'x-cardpick-ssr': 'guides-hub',
  });
  assert.equal(cards.length, 39);
  assert.equal(new Set(cards.map(card => card.href)).size, 39);
  assert.equal([...html.matchAll(thumbnailPattern)].length, 39);
});

for (const card of cards) {
  test(`${card.href}: source and every candidate exist with exact width/height declarations`, () => {
    const a = attributes(card.tag);
    const original = webpDimensions(a.src);
    assert.deepEqual({ width: Number(a.width), height: Number(a.height) }, original);
    const variants = candidates(a.srcset);
    assert.equal(new Set(variants.map(item => item.width)).size, variants.length, 'Duplicate width descriptor');
    assert.equal(new Set(variants.map(item => item.url)).size, variants.length, 'Duplicate candidate URL');
    assert.ok(variants.some(item => item.url === a.src), 'Original source must remain in srcset');
    for (const item of variants) {
      const actual = webpDimensions(item.url);
      assert.equal(item.width, actual.width, `Wrong width descriptor: ${item.url}`);
      if (item.width === 480) assert.equal(actual.height, 270);
      if (item.width === 800) assert.equal(actual.height, 450);
      assert.equal(new URL(item.url, 'https://cardpick.kr').search,
        new URL(a.src, 'https://cardpick.kr').search, 'Preserve cache-version query');
    }
    assert.equal(a.sizes, '(max-width:720px) 100vw, 400px');
    assert.equal(a.decoding, card === cards[0] ? 'sync' : 'async');
    assert.equal(a.class, 'hero-img');
    assert.ok(a.alt.endsWith(' 썸네일'));
    assert.ok(a.onerror.startsWith("this.style.display='none';this.parentNode.style.background='"));
    assert.doesNotMatch(card.tag, /\b(?:undefined|NaN)\b/);
  });
}

test('PSA certification thumbnail reuses existing 480/800 assets without double suffixes', () => {
  const card = cards.find(card => card.href === '/guide-psa-cert-number-check');
  const a = attributes(card.tag);
  assert.equal(a.src, '/images/guides/psa-cert-number-check-hero-800.webp');
  assert.deepEqual(candidates(a.srcset), [
    { url: '/images/guides/psa-cert-number-check-hero-480.webp', width: 480 },
    { url: '/images/guides/psa-cert-number-check-hero-800.webp', width: 800 },
  ]);
  assert.equal(a.width, '800');
  assert.equal(a.height, '450');
  assert.doesNotMatch(html, /psa-cert-number-check-hero-800-(?:480|800)\.webp/);
});

test('the verified originals retain 10 1280px, 28 1672px and one 800px source', () => {
  const counts = {};
  for (const card of cards) {
    const { width } = attributes(card.tag);
    counts[width] = (counts[width] ?? 0) + 1;
  }
  assert.deepEqual(counts, { 800: 1, 1280: 10, 1672: 28 });
});

test('only the first thumbnail competes for first-paint bandwidth; remaining images load near the viewport', () => {
  for (const [index, card] of cards.entries()) {
    const a = attributes(card.tag);
    assert.equal(a.loading, index === 0 ? 'eager' : 'lazy');
    assert.equal(a.fetchpriority, index === 0 ? 'high' : undefined);
  }
  assert.match(html, /\.guide-card \.hero\s*\{[^}]*aspect-ratio: 16\/9;/);
});

test('the approved fake-detection title and excerpt match the rendered card and its Article metadata', () => {
  const card = cards.find(card => card.href === '/guide-fake-detection');
  assert.equal(card.body.match(/<h3 class="title">([^<]*)<\/h3>/)[1], approvedFakeGuideCopy.title.after);
  assert.equal(card.body.match(/<p class="excerpt">([^<]*)<\/p>/)[1], approvedFakeGuideCopy.excerpt.after);
  assert.equal(attributes(card.tag).alt, `${approvedFakeGuideCopy.title.after} 썸네일`);
  const ld = [...html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)]
    .map(match => JSON.parse(match[1]));
  const item = ld.find(item => item['@type'] === 'CollectionPage').mainEntity.itemListElement
    .find(entry => entry.url === 'https://cardpick.kr/guide-fake-detection').item;
  assert.equal(item.headline, approvedFakeGuideCopy.title.after);
  assert.equal(item.description, approvedFakeGuideCopy.excerpt.after);
});

test('the PSA card and Article metadata describe the actual submission guide without a BRG10 promise', () => {
  const card = cards.find(card => card.href === '/guide-psa-grading-korea');
  assert.equal(card.body.match(/<p class="excerpt">([^<]*)<\/p>/)[1], approvedPsaExcerpt.after);
  const schemas = [...html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)].map(match => JSON.parse(match[1]));
  const article = schemas.find(item => item['@type'] === 'CollectionPage').mainEntity.itemListElement
    .find(entry => entry.url === 'https://cardpick.kr/guide-psa-grading-korea').item;
  assert.equal(article.description, approvedPsaExcerpt.after);
});
test('the rarity excerpt and Article metadata describe the Japanese-only MEGA addition without a price ranking', () => {
  const card = cards.find(card => card.href === '/guide-card-rarities');
  assert.equal(card.body.match(/<p class="excerpt">([^<]*)<\/p>/)[1], approvedRarityExcerpt.after);
  const schemas = [...html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)].map(match => JSON.parse(match[1]));
  const article = schemas.find(item => item['@type'] === 'CollectionPage').mainEntity.itemListElement
    .find(entry => entry.url === 'https://cardpick.kr/guide-card-rarities').item;
  assert.equal(article.description, approvedRarityExcerpt.after);
  assert.match(article.description, /일본판 MEGA/);
  assert.doesNotMatch(article.description, /등급별 가격대 비교|동일 등급|한국판 MEGA/);
});

// Literal approval boundaries: never extract or broadly discard current ad markup.
const officialAdLoader = '<script async src="https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=ca-pub-6109192154510152" crossorigin="anonymous"></script>';
const approvedAdLoaderTemplate = `<template data-cp-ad-loader>${officialAdLoader}</template>`;
const approvedAdHead = '<link rel="stylesheet" href="/styles/ads.css?v=20261011">\n'
  + '<style id="cp-ad-size">\n'
  + '  .cp_ad_hub{display:block;width:250px;height:250px}\n'
  + '  @media(min-width:375px){.cp_ad_hub{width:300px;height:250px}}\n'
  + '  @media(min-width:768px){.cp_ad_hub{width:468px;height:60px}}\n'
  + '  @media(min-width:1024px){.cp_ad_hub{width:728px;height:90px}}\n'
  + '  @media(max-width:319px){.cp_ad_hub{display:none}}\n'
  + '</style>\n'
  + '<script defer src="/ads.js?v=20261012b"></script>\n';
const approvedAdBody = '\n  <aside class="cp-ad" id="cp-ad-hub" aria-label="광고" data-ad-placement="guide-hub">\n'
  + '    <div class="cp-ad-label">광고</div>\n'
  + '    <ins class="adsbygoogle cp_ad_hub" style="display:block" data-ad-client="ca-pub-6109192154510152" data-ad-slot="5095979154"></ins>\n'
  + '  </aside>\n';

function normalizeApprovedGuideAds(source) {
  assert.equal(source.split(approvedAdLoaderTemplate).length - 1, 1, 'Expected the one exact inert SDK template');
  assert.equal(source.split(officialAdLoader).length - 1, 1, 'No extra executable SDK snippet is approved');
  assert.equal(source.split('data-cp-ad-loader').length - 1, 1, 'The SDK template marker must be unique');
  assert.ok(source.includes('<meta charset="utf-8">' + approvedAdLoaderTemplate + '<meta name="viewport"'),
    'The unchanged SDK snippet must remain inert at its approved head boundary');
  for (const [name, block] of [['head', approvedAdHead], ['body', approvedAdBody]]) {
    assert.equal(source.split(block).length - 1, 1, `Expected the exact approved ad ${name} block once`);
  }
  assert.ok(source.includes('<meta name="viewport" content="width=device-width,initial-scale=1">\n' + approvedAdHead),
    'Ad resources must remain at the reviewed head boundary');
  assert.ok(source.includes('  </section>\n' + approvedAdBody + '\n  <!-- 데이터 출처 안내 -->'),
    'The manual unit must remain after the guide grid and before the disclosure');
  return source.replace(approvedAdHead, '').replace(approvedAdBody, '')
    .replace(approvedAdLoaderTemplate, officialAdLoader);
}

function assertOriginalGuideBaseline(source) {
  source = restoreGrowth17GuideHtml(source);
  assertReviewedGuideFontStrategy(guidesBaseCss);
  // Original baseline remains intact. Normalize only the explicitly approved
  // row's title/excerpt (once in the card and once in its Article metadata).
  let normalized = normalizeApprovedGuideAds(source).replace(thumbnailPattern, '<!-- guide-thumbnail -->');
  const offscreenContainment = '    content-visibility: auto;\n    contain-intrinsic-size: auto 420px;\n';
  assert.equal(normalized.split(offscreenContainment).length - 1, 1);
  normalized = normalized.replace(offscreenContainment, '');
  for (const copy of [...Object.values(approvedFakeGuideCopy), approvedPsaExcerpt, ...Object.values(approvedPriceGuideCopy), approvedRarityExcerpt]) {
    assert.equal(normalized.split(copy.after).length - 1, 2);
    assert.equal(normalized.split(copy.before).length - 1, 0, 'no stale approved copy');
    normalized = normalized.replaceAll(copy.after, copy.before);
  }
  assert.equal(normalized.split(approvedHeaderCss).length - 1, 1);
  assert.ok(normalized.includes('  /* Hub header */\n' + approvedHeaderCss + '  .hub-head {'),
    'Only the exact page-owned header CSS is approved at this style boundary');
  normalized = normalized.replace(approvedHeaderCss, '');
  // Preserve the original baseline hash; allow only this explicit head block
  // and ordered defer attributes, not arbitrary layout/content/SEO changes.
  const fontLinks = '<link rel="stylesheet" crossorigin href="https://cdn.jsdelivr.net/gh/orioncactus/pretendard@v1.3.9/dist/web/variable/pretendardvariable-dynamic-subset.min.css">\n'
    + '<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;500;600&display=swap">';
  const resourceBlock = /<style data-guides-base>[\s\S]*?<!-- guides-resources-end -->/g;
  const resources = [...normalized.matchAll(resourceBlock)];
  assert.equal(resources.length, 1);
  assert.equal(resources[0][0], `<style data-guides-base>${guidesBaseCss}</style>\n<!-- guides-resources-end -->`,
    'Resource normalization must not hide extra markup, scripts, or metadata');
  normalized = normalized.replace(resourceBlock, fontLinks + '\n<script src="https://cdn.tailwindcss.com"></script>\n'
    + "<script>tailwind.config={theme:{extend:{colors:{bg:'#05080D',panel:'#0D121B',panel2:'#111722',line:'rgba(255,255,255,0.08)',ink:'#E8EDF5',muted:'#8B96A8',up:'#26E0C2',down:'#FF4D6D',brand:'#26E0C2',gold:'#F2C94C'}}}}</script>");
  for (const src of ['/auth.js?v=v3clean', '/search.js?v=20260519ko']) {
    const deferred = `<script defer src="${src}"></script>`;
    assert.equal(normalized.split(deferred).length - 1, 1);
    normalized = normalized.replace(deferred, `<script src="${src}"></script>`);
  }
  assert.equal(createHash('sha256').update(normalized).digest('hex'),
    '921cfa68b26c9050d63285e52614d061d4dbe71088f146741aae53aa4925fbc2');
}

test('non-image HTML changes only the approved guide copy, header CSS, resource loading and exact ad blocks', () => {
  assertOriginalGuideBaseline(html);
  const ld = [...html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)]
    .map(match => JSON.parse(match[1]));
  assert.equal(ld.find(item => item['@type'] === 'CollectionPage').mainEntity.numberOfItems, 39);
});

test('guide-copy and header normalization rejects stale, altered, duplicated, moved and injected changes', () => {
  const cases = [
    ...Object.entries(approvedPriceGuideCopy).flatMap(([field, copy]) => [
      ['stale price ' + field, html.replaceAll(copy.after, copy.before)],
      ['altered price ' + field, html.replace(copy.after, copy.after + ' unapproved')],
      ['duplicate price ' + field, html.replace('</main>', copy.after + '</main>')],
      ['moved price ' + field, html.replace(copy.after, '').replace('</main>', copy.after + '</main>')],
    ]),
    ['stale PSA excerpt', html.replaceAll(approvedPsaExcerpt.after, approvedPsaExcerpt.before)],
    ['altered PSA excerpt', html.replace(approvedPsaExcerpt.after, approvedPsaExcerpt.after + ' unapproved')],
    ['duplicate PSA excerpt', html.replace('</main>', approvedPsaExcerpt.after + '</main>')],
    ['moved PSA excerpt', html.replace(approvedPsaExcerpt.after, '').replace('</main>', approvedPsaExcerpt.after + '</main>')],
    ['stale rarity excerpt', html.replaceAll(approvedRarityExcerpt.after, approvedRarityExcerpt.before)],
    ['altered rarity excerpt', html.replace(approvedRarityExcerpt.after, approvedRarityExcerpt.after + ' unapproved')],
    ['duplicate rarity excerpt', html.replace('</main>', approvedRarityExcerpt.after + '</main>')],
    ['moved rarity excerpt', html.replace(approvedRarityExcerpt.after, '').replace('</main>', approvedRarityExcerpt.after + '</main>')],
    ['missing header CSS', html.replace(approvedHeaderCss, '')],
    ['duplicate header CSS', html.replace(approvedHeaderCss, approvedHeaderCss.repeat(2))],
    ['altered header CSS', html.replace(approvedHeaderCss, approvedHeaderCss.replace('min-height:44px', 'min-height:24px'))],
    ['moved header CSS', html.replace(approvedHeaderCss, '').replace('</head>', '<style>' + approvedHeaderCss + '</style></head>')],
    ['injected header body rule', html.replace(approvedHeaderCss, approvedHeaderCss + '  main{display:none}\n')],
  ];
  for (const [name, changed] of cases) {
    assert.notEqual(changed, html, `${name}: mutation must change the fixture`);
    assert.throws(() => assertOriginalGuideBaseline(changed), { code: 'ERR_ASSERTION' }, name);
  }
});

test('ad normalization rejects missing, duplicate, changed, moved or injected advertisement markup', () => {
  const cases = [
    ['missing head block', html.replace(approvedAdHead, '')],
    ['missing body block', html.replace(approvedAdBody, '')],
    ['duplicate head block', html.replace(approvedAdHead, approvedAdHead.repeat(2))],
    ['duplicate body block', html.replace(approvedAdBody, approvedAdBody.repeat(2))],
    ['changed slot', html.replace('data-ad-slot="5095979154"', 'data-ad-slot="0000000000"')],
    ['changed size', html.replace('.cp_ad_hub{width:300px;height:250px}', '.cp_ad_hub{width:320px;height:250px}')],
    ['extra ad content', html.replace('    <div class="cp-ad-label">광고</div>', '    <p>unapproved content</p>\n    <div class="cp-ad-label">광고</div>')],
    ['moved body block', html.replace(approvedAdBody, '').replace('</main>', approvedAdBody + '</main>')],
    ['ad inserted inside normalized resources', html.replace('<!-- guides-resources-end -->', approvedAdBody + '<!-- guides-resources-end -->')],
    ['extra metadata inside normalized resources', html.replace('<!-- guides-resources-end -->', '<meta name="robots" content="noindex">\n<!-- guides-resources-end -->')],
    ['executable SDK', html.replace(approvedAdLoaderTemplate, officialAdLoader)],
    ['duplicate SDK template', html.replace(approvedAdLoaderTemplate, approvedAdLoaderTemplate.repeat(2))],
    ['extra executable SDK', html.replace('</head>', officialAdLoader + '</head>')],
    ['moved SDK template', html.replace(approvedAdLoaderTemplate, '').replace('</body>', approvedAdLoaderTemplate + '</body>')],
    ['changed SDK template', html.replace('data-cp-ad-loader>', 'data-cp-ad-loader data-unapproved="true">')],
  ];
  for (const [name, changed] of cases) {
    assert.notEqual(changed, html, `${name}: mutation must change the fixture`);
    assert.throws(() => assertOriginalGuideBaseline(changed), { code: 'ERR_ASSERTION' }, name);
  }
});

test('the unchanged original hash still rejects body, title, canonical and robots drift', () => {
  const cases = [
    ['body', html.replace('⚠ 가격 정보 안내', '⚠ unapproved disclosure')],
    ['title', html.replace('<title>카드픽 가이드', '<title>unapproved title')],
    ['canonical', html.replace('rel="canonical" href="https://cardpick.kr/guides"', 'rel="canonical" href="https://cardpick.kr/other"')],
    ['robots', html.replace('content="index,follow,max-image-preview:large,max-snippet:-1"', 'content="noindex,follow"')],
  ];
  for (const [name, changed] of cases) {
    assert.notEqual(changed, html, `${name}: mutation must change the fixture`);
    assert.throws(() => assertOriginalGuideBaseline(changed), { code: 'ERR_ASSERTION' }, name);
  }
});

test('guides inline a small precompiled stylesheet without any runtime compiler or CSS request', () => {
  assert.doesNotMatch(html, /cdn\.tailwindcss\.com|tailwind\.config/);
  const css = fs.readFileSync(new URL('styles/guides-base.css', root), 'utf8');
  assertReviewedGuideFontStrategy(guidesBaseCss);
  assert.equal(html.match(/<style data-guides-base>([\s\S]*?)<\/style>/)[1], guidesBaseCss);
  assert.match(css, /tailwindcss v3\.4\.17/);
  assert.ok(Buffer.byteLength(css) < 15000, 'Only ship the utilities needed by the guide hub');
  assert.ok(css.includes('.max-w-\\[1280px\\]'));
  assert.ok(css.includes('.lg\\:px-8'));
  assert.ok(css.includes('.hover\\:text-ink:hover'));
  assert.match(css, /box-sizing:border-box/);
  assert.match(css, /margin:0/);
});

test('the guide-only font transform preserves shared inputs and rejects unapproved CSS drift', () => {
  const input = fs.readFileSync(new URL('styles/guides.input.css', root), 'utf8').replaceAll('\r\n', '\n');
  assert.equal(createHash('sha256').update(input).digest('hex'),
    '9c0f2164f4fa329a4dcc557315f537cda8d80da54274a349a81bc3085d657f4f');
  assert.equal((compiledGuideCss.match(/font-display:swap/g) || []).length, 15);
  assert.equal((guidesBaseCss.match(/font-display:optional/g) || []).length, 15);
  const mutations = [
    guidesBaseCss.replace('font-display:optional', 'font-display:swap'),
    guidesBaseCss.replace('font-family:IBM Plex Mono;', 'font-family:monospace;'),
    guidesBaseCss.replace('font-weight:400;', 'font-weight:700;'),
    guidesBaseCss.replace('/fonts/ibm-plex-mono/', '/fonts/unapproved/'),
    guidesBaseCss.replace('unicode-range:u+0460-052f', 'unicode-range:u+0460-0530'),
    guidesBaseCss.replace('box-sizing:border-box', 'box-sizing:content-box'),
    guidesBaseCss + 'body{display:none}',
  ];
  for (const changed of mutations) {
    assert.notEqual(changed, guidesBaseCss, 'negative fixture must actually alter generated CSS');
    assert.throws(() => assertReviewedGuideFontStrategy(changed), { code:'ERR_ASSERTION' });
    const changedHtml = html.replace(guidesBaseCss, changed);
    assert.notEqual(changedHtml, html);
    assert.throws(() => assertOriginalGuideBaseline(changedHtml), { code:'ERR_ASSERTION' });
  }
});

test('the unchanged mono typeface is available locally without JavaScript or cross-origin CSS', () => {
  assert.doesNotMatch(html, /pretendardvariable|Pretendard Variable/);
  assert.match(html, /font-family:Pretendard,system-ui,sans-serif/);
  assert.doesNotMatch(html, /fonts\.googleapis\.com|fonts\.gstatic\.com/);
  assert.equal((guidesBaseCss.match(/@font-face/g) || []).length, 15);
  const fonts = [...guidesBaseCss.matchAll(/url\((\/fonts\/ibm-plex-mono\/[-\w]+\.woff2)\)/g)];
  assert.equal(fonts.length, 15);
  for (const [, path] of fonts) {
    const bytes = fs.readFileSync(new URL(path.slice(1), root));
    assert.equal(bytes.toString('ascii', 0, 4), 'wOF2');
    assert.ok(bytes.length > 5000);
  }
  assert.match(fs.readFileSync(new URL('fonts/ibm-plex-mono/OFL.txt', root), 'utf8'), /SIL OPEN FONT LICENSE Version 1\.1/);
  assert.ok(html.indexOf('<script defer src="/auth.js') < html.indexOf('<script defer src="/search.js'));
});

test('the image renderer adds no network or runtime filesystem dependency', async () => {
  const source = fs.readFileSync(new URL('functions/guides.js', root), 'utf8');
  assert.doesNotMatch(source.replace("import guidesBaseCss from './_lib/guides-style.js';", ''),
    /\bimport\s|\brequire\s*\(|\bfetch\s*\(|\b(?:readFile|readFileSync|statSync)\s*\(/);
  const previousFetch = globalThis.fetch;
  try {
    globalThis.fetch = () => { throw new Error('Rendering must not fetch image metadata'); };
    assert.equal(await (await onRequest()).text(), html);
  } finally { globalThis.fetch = previousFetch; }
});
