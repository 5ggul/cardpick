import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createHash } from 'node:crypto';
import { onRequest } from '../functions/guides.js';
import guidesBaseCss from '../functions/_lib/guides-style.js';

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

test('non-image HTML changes only the approved fake-guide copy and resource loading', () => {
  // Original baseline remains intact. Normalize only the explicitly approved
  // row's title/excerpt (once in the card and once in its Article metadata).
  let normalized = html.replace(thumbnailPattern, '<!-- guide-thumbnail -->');
  const offscreenContainment = '    content-visibility: auto;\n    contain-intrinsic-size: auto 420px;\n';
  assert.equal(normalized.split(offscreenContainment).length - 1, 1);
  normalized = normalized.replace(offscreenContainment, '');
  for (const copy of Object.values(approvedFakeGuideCopy)) {
    assert.equal(normalized.split(copy.after).length - 1, 2);
    normalized = normalized.replaceAll(copy.after, copy.before);
  }
  // Preserve the original baseline hash; allow only this explicit head block
  // and ordered defer attributes, not arbitrary layout/content/SEO changes.
  const fontLinks = '<link rel="stylesheet" crossorigin href="https://cdn.jsdelivr.net/gh/orioncactus/pretendard@v1.3.9/dist/web/variable/pretendardvariable-dynamic-subset.min.css">\n'
    + '<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;500;600&display=swap">';
  const resourceBlock = /<style data-guides-base>[\s\S]*?<!-- guides-resources-end -->/g;
  assert.equal([...normalized.matchAll(resourceBlock)].length, 1);
  normalized = normalized.replace(resourceBlock, fontLinks + '\n<script src="https://cdn.tailwindcss.com"></script>\n'
    + "<script>tailwind.config={theme:{extend:{colors:{bg:'#05080D',panel:'#0D121B',panel2:'#111722',line:'rgba(255,255,255,0.08)',ink:'#E8EDF5',muted:'#8B96A8',up:'#26E0C2',down:'#FF4D6D',brand:'#26E0C2',gold:'#F2C94C'}}}}</script>");
  for (const src of ['/auth.js?v=v3clean', '/search.js?v=20260519ko']) {
    const deferred = `<script defer src="${src}"></script>`;
    assert.equal(normalized.split(deferred).length - 1, 1);
    normalized = normalized.replace(deferred, `<script src="${src}"></script>`);
  }
  assert.equal(createHash('sha256').update(normalized).digest('hex'),
    '921cfa68b26c9050d63285e52614d061d4dbe71088f146741aae53aa4925fbc2');
  const ld = [...html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)]
    .map(match => JSON.parse(match[1]));
  assert.equal(ld.find(item => item['@type'] === 'CollectionPage').mainEntity.numberOfItems, 39);
});

test('guides inline a small precompiled stylesheet without any runtime compiler or CSS request', () => {
  assert.doesNotMatch(html, /cdn\.tailwindcss\.com|tailwind\.config/);
  const css = fs.readFileSync(new URL('styles/guides-base.css', root), 'utf8');
  assert.equal(guidesBaseCss, css.trim(), 'Rebuild the generated module when the compiled CSS changes');
  assert.equal(html.match(/<style data-guides-base>([\s\S]*?)<\/style>/)[1], guidesBaseCss);
  assert.match(css, /tailwindcss v3\.4\.17/);
  assert.ok(Buffer.byteLength(css) < 15000, 'Only ship the utilities needed by the guide hub');
  assert.ok(css.includes('.max-w-\\[1280px\\]'));
  assert.ok(css.includes('.lg\\:px-8'));
  assert.ok(css.includes('.hover\\:text-ink:hover'));
  assert.match(css, /box-sizing:border-box/);
  assert.match(css, /margin:0/);
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
