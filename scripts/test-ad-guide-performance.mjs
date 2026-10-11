import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const read = path => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const sha256 = text => createHash('sha256').update(text).digest('hex');
const marker = '__APPROVED_GUIDE_PERFORMANCE_RESOURCES__';
const pinnedPretendard = 'https://cdn.jsdelivr.net/gh/orioncactus/pretendard@v1.3.9/dist/web/static/pretendard.min.css';
const tcgPretendard = 'https://cdn.jsdelivr.net/gh/orioncactus/pretendard/dist/web/static/pretendard.css';
const pages = [
  {
    path: 'guide-grading-proxy.html', css: 'styles/ad-guides-base.css', font: pinnedPretendard,
    preserved: '1fb02e539956e73fcbb77b59a008f8ce334481496e54d24f16f5516498d801e5',
    body: 'd2ffc8f1ddb9af4c72e79476171552e92ede3845bfbe605b8597866306aea4e8',
  },
  {
    path: 'guide-pikachu-cards.html', css: 'styles/ad-guides-base.css', font: pinnedPretendard,
    preserved: '8675bd154aa7aef637c2c17d9f90e2ef2086a9a686257da6e6d493db20de6145',
    body: 'f611fa5587456d14ce4e8d3fcf5b233e491cfaefa9864991b55bf3d0e6f4866f',
  },
  {
    path: 'guide-what-is-tcg.html', css: 'styles/ad-tcg-base.css', font: tcgPretendard,
    preserved: '4f59b7b91fdcb155d15b1610b77109c2edae2d2068a67ae734c4e2b885238441',
    body: '4624dcdbc8f48ce25d8b42349acbd5a7908b8c6b22f47c10537dfe883a83d81d',
  },
];

const resourceBlock = page => [
  '<link rel="preconnect" href="https://cdn.jsdelivr.net">',
  `<link rel="stylesheet" media="print" onload="this.media='all'" href="${page.font}">`,
  `<noscript><link rel="stylesheet" href="${page.font}"></noscript>`,
].join('\n');

function assertPreserved(html, page) {
  const block = resourceBlock(page);
  assert.equal(html.split(block).length - 1, 1, 'the exact resource block must occur once');
  assert.ok(html.indexOf(block) > html.indexOf('<head>'));
  assert.ok(html.indexOf(block) + block.length < html.indexOf('</head>'));
  const compiledLink = `<link rel="stylesheet" href="/${page.css}?v=20261011">`;
  assert.equal(html.split(compiledLink).length - 1, 1, 'the compiled stylesheet must occur once');
  assert.ok(html.includes(`${compiledLink}\n</head>`), 'preserve runtime Tailwind cascade after the inline design styles');
  // The snapshot was captured before this resource-only patch, with the old
  // resource block replaced by this same marker. No body, metadata, JSON-LD,
  // inline design styles, ad markup, or other head nodes are ignored.
  assert.equal(sha256(html.replace(block, marker).replace(`${compiledLink}\n</head>`, '</head>')), page.preserved);
  assert.equal(sha256(html.slice(html.indexOf('</head>') + 7)), page.body);
}

for (const page of pages) {
  test(`${page.path}: complete document outside the approved head resources is byte-identical`, () => {
    assertPreserved(read(page.path), page);
  });

  test(`${page.path}: precompiled CSS replaces the runtime compiler and Google font stylesheet`, () => {
    const html = read(page.path);
    assert.doesNotMatch(html, /cdn\.tailwindcss\.com|tailwind\.config|fonts\.googleapis\.com|fonts\.gstatic\.com/);
    assert.equal(html.split(`href="/${page.css}?v=20261011"`).length - 1, 1);
    const css = read(page.css);
    assert.match(css, /tailwindcss v3\.4\.17/);
    assert.ok(Buffer.byteLength(css) < 15000);
  });

  test(`${page.path}: the exact existing Pretendard source has a nonblocking and no-script path`, () => {
    const html = read(page.path);
    assert.ok(html.includes(`<link rel="stylesheet" media="print" onload="this.media='all'" href="${page.font}">`));
    assert.ok(html.includes(`<noscript><link rel="stylesheet" href="${page.font}"></noscript>`));
    assert.equal(html.split(page.font).length - 1, 2);
  });

  test(`${page.path}: preservation gate rejects duplicate, moved, missing, and altered resources or content`, () => {
    const html = read(page.path);
    const block = resourceBlock(page);
    const mutations = [
      html.replace('</head>', `${block}\n</head>`),
      html.replace(block, '').replace('</head>', `</head>\n${block}`),
      html.replace('<noscript>', '<noscript data-altered="true">'),
      html.replace("this.media='all'", "this.media='screen'"),
      html.replace('<title>', '<title>changed '),
      html.replace('<body', '<body data-altered="true"'),
      html.replace('cp-ad-label">광고', 'cp-ad-label">altered'),
      html.replace('<style>\n', '<style>\nbody{color:red}\n'),
      html.replace(`<link rel="stylesheet" href="/${page.css}?v=20261011">\n`, '')
        .replace('<style>\n', `<link rel="stylesheet" href="/${page.css}?v=20261011">\n<style>\n`),
    ];
    for (const mutated of mutations) assert.throws(() => assertPreserved(mutated, page));
  });
}

test('the shared and TCG configurations retain their distinct original runtime themes', () => {
  const shared = require('./ad-guides-tailwind.config.cjs');
  const tcg = require('./ad-tcg-tailwind.config.cjs');
  assert.deepEqual(shared.content, ['./guide-grading-proxy.html', './guide-pikachu-cards.html']);
  assert.deepEqual(tcg.content, ['./guide-what-is-tcg.html']);
  assert.deepEqual(shared.theme.extend.colors, {
    bg: '#05080D', panel: '#0D121B', panel2: '#111722',
    line: 'rgba(255,255,255,0.08)', ink: '#E8EDF5', muted: '#8B96A8',
    up: '#26E0C2', down: '#FF4D6D', brand: '#26E0C2', warn: '#E0B84A',
  });
  assert.deepEqual(tcg.theme.extend.colors, {
    bg: '#080B10', panel: '#111620', panel2: '#151B26', line: '#253044',
    ink: '#E8EEF7', muted: '#8B96A8', up: '#12D6B0', down: '#FF4D6D',
    gold: '#F2C94C', brand: '#26E0C2',
  });
  const fonts = {
    sans: ['Pretendard', 'system-ui', 'sans-serif'],
    mono: ['"IBM Plex Mono"', 'ui-monospace', 'monospace'],
  };
  assert.deepEqual(shared.theme.extend.fontFamily, fonts);
  assert.deepEqual(tcg.theme.extend.fontFamily, fonts);
});

for (const [path, digest, selectors] of [
  ['styles/ad-guides-base.css', 'b2d9dec3d36166bda34fa1e8f3700e2612062aadaad716c1509d8cd6f60e16f5',
    ['.max-w-\\[820px\\]', '.font-semibold', '.text-\\[20px\\]', '.sm\\:text-\\[22px\\]', '.lg\\:px-8', '.-mx-5']],
  ['styles/ad-tcg-base.css', 'c178e322dafb390f96050d9ea4651214cee40d846e0a285433068de25fb72283',
    ['.max-w-\\[1100px\\]', '.grid-cols-\\[80px_1fr_120px\\]', '.md\\:grid-cols-\\[100px_1fr_120px_160px\\]', '.lg\\:text-\\[56px\\]', '.sm\\:text-\\[48px\\]']],
]) {
  test(`${path}: the generated design is pinned and includes each guide's responsive utilities`, () => {
    const css = read(path);
    assert.equal(sha256(css), digest);
    for (const selector of selectors) assert.ok(css.includes(selector), `missing ${selector}`);
  });

  test(`${path}: all existing local IBM Plex Mono weights and character-range files are retained`, () => {
    const css = read(path);
    const source = read('styles/guides.input.css');
    const fontFiles = [...source.matchAll(/url\((\/fonts\/ibm-plex-mono\/[^)]+)\)/g)].map(match => match[1]);
    assert.equal(fontFiles.length, 15);
    assert.equal((css.match(/@font-face\{/g) || []).length, 15);
    assert.doesNotMatch(css, /https?:\/\/[^\s]*fonts\./);
    for (const file of fontFiles) {
      assert.ok(css.includes(`url(${file})`));
      assert.ok(existsSync(new URL(`..${file}`, import.meta.url)), `missing local font ${file}`);
    }
    for (const weight of [400, 500, 600]) {
      assert.equal((css.match(new RegExp(`font-weight:${weight};font-display:swap`, 'g')) || []).length, 5);
    }
  });
}
