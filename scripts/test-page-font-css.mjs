import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, statSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { pageFontCss, parseRanges } from './page-font-css.mjs';
const root = new URL('../', import.meta.url);
const upstream = readFileSync(new URL('styles/releases-fonts.css', root), 'utf8');
const ranges = css => [...css.matchAll(/unicode-range:\s*([^;}]+)/g)].map(m => parseRanges(m[1]));
const union = sets => new Set(sets.flatMap(s => [...s]));
const read = file => readFileSync(new URL(file, root), 'utf8').replaceAll('\r\n', '\n');
const sha = value => createHash('sha256').update(value).digest('hex');
const assets = {
  card: ['2ac15934055162c7fc0653be9a71c8070bdb9d2022a1047c4c551ab5cabf02ec', 'dc33b65cc07b73e4705dd02d0eda50a73d45cbffaf37580134d23f24fcee52e3'],
  cgc: ['722a266db936eca0499e3b8dde73497ce5a5a52243ecccc4155295a217b1a296', 'bebb961a6be4000a6405bc95157a5f415378145370b16090b815858249b5f157'],
  // Pinned home-only regeneration after the approved home FAQ wording change.
  home: ['2b2de6fe427f7098df8aa191316a1d8d415ac9e81e3496012bc6378a45c2f0de', 'f7a9c674f8062bf254172356accb17c47cfc8a09e9c3b6f1e05421b88b9765f8'],
  releases: ['cb86869c68f16b8c7a03c30ea30ccb93c66947f6f246b0b755cdec13f9388465', '793432e204226ec7f0cf3d9bef184d49a3c23e12eed5137a5705a2093a7e1161'],
  price: ['cf9502ec606838c6a4f6f9679a8755126b623d50d95ed3cf5d87eb6e384ba4ef', 'a129dcb01c5b8d5b9a79d40f92a8f157513aa25997d0968d0d4bf532e2e9e72c'],
};

for (const page of ['card', 'cgc', 'home', 'releases', 'price']) {
  test(`${page}: subset and fallback ranges are disjoint and preserve complete coverage`, () => {
    const subset = readFileSync(new URL(`styles/${page}-text-font.css`, root), 'utf8');
    const output = pageFontCss(upstream, subset);
    const produced = ranges(output);
    const local = produced.pop();
    assert.deepEqual(union([...produced, local]), union([...ranges(upstream), ...ranges(subset)]));
    for (const range of produced) for (const code of range) assert.ok(!local.has(code), `duplicate ${code.toString(16)}`);
    assert.match(output, /font-family:'Cardpick Text'/);
    assert.doesNotMatch(output, /font-family: 'Pretendard'/);
    assert.ok(statSync(new URL(`fonts/cardpick-text/${page}.woff2`, root)).size < 150_000);
    const file = { card:'card-detail.html', cgc:'guide-cgc-grading.html', home:'index.html', releases:'releases.html', price:'guide-card-price.html' }[page];
    const pageHtml = read(file);
    let expected = output.replace(/\r\n/g, '\n');
    if (page === 'home') expected += '\n' + read('styles/set-fonts.css').trim();
    if (['home', 'releases'].includes(page)) expected += '\n#cp-user-menu,#cp-search-results,#cp-nick-modal>div,#cp-nick-modal input{font-family:'
      + (page === 'home' ? 'var(--sans)' : "'Cardpick Text',Pretendard,system-ui,sans-serif") + '!important}';
    assert.equal(pageHtml.match(new RegExp(`<style id="${page}-font-css">([\\s\\S]*?)<\\/style>`))[1], expected);
    assert.equal(sha(readFileSync(new URL(`fonts/cardpick-text/${page}.woff2`, root))), assets[page][0]);
    assert.equal(sha(read(`styles/${page}-text-font.css`)), assets[page][1]);
    if (page === 'home' || page === 'price') {
      assert.ok(subset.includes(`/fonts/cardpick-text/${page}.woff2?v=${assets[page][0].slice(0,12)}`),
        'Changed home/price assets use their exact content revision rather than stale browser cache');
    }
  });
}

test('shared source CSS stays byte-identical; new subsets do not modify card/CGC or global typography', () => {
  assert.equal(sha(read('styles/releases-fonts.css')), '7d0f063277161d13cc8a09600a4c02e731eef406846a93c0273c4b9b7d9f5063');
  assert.equal(sha(read('styles/set-fonts.css')), '9a20ba1737cc7fd798a2e0fb345ed44c845a07fcae8c1159ab1c062991adcb35');
  const builder = read('scripts/build-page-fonts.py');
  assert.match(builder, /parser\.add_argument\('--pages', nargs='\+', required=True/);
  assert.match(builder, /for page in args\.pages:/);
  assert.match(builder, /if len\(args\.pages\) != len\(set\(args\.pages\)\):/);
  assert.match(builder, /9599f12fd42fc0bce1cd50b47a0c022e108d7aa64dd0d1bb0ed44f3282d900b4/);
  assert.match(builder, /recalcTimestamp=False/);
  assert.match(builder, /'data\/release-calendar\.json'/);
  assert.match(builder, /record\.nameID in \(1, 3, 4, 6, 16, 21, 25\)/);
  for (const page of ['home', 'releases']) {
    const html = read(page === 'home' ? 'index.html' : 'releases.html');
    assert.doesNotMatch(html, new RegExp(`<link[^>]*rel="preload"[^>]*href="/fonts/cardpick-text/${page}\\.woff2"`));
    assert.ok(html.indexOf(`<style id="${page}-font-css">`) < html.indexOf('</head>'));
    assert.match(read(`styles/${page}-text-font.css`), /font-weight:45 920;font-display:optional/);
    assert.match(read(`styles/${page}-text-font.css`), /SIL OFL 1\.1/);
  }
});

test('home runtime coverage preserves the seven captured API characters and adds only the evidenced CSS ellipsis', () => {
  assert.equal(sha(read('fonts/cardpick-text/home-runtime-chars.txt')),
    '91501a6c4fcb90ba4d0fb48abdd1f9f1397d9e275dab4fefb1c5cce0fafec8a0',
    'The exact API payload/provenance plus separately identified CSS-generated character is pinned');
  const runtime = JSON.parse(read('fonts/cardpick-text/home-runtime-chars.txt'));
  assert.deepEqual(Object.keys(runtime).sort(), ['characters','provenance','version']);
  assert.equal(runtime.version, 1);
  assert.equal(runtime.characters, '갸몰완펄팬텀칠…');
  assert.equal(new Set(runtime.characters).size, 8);
  const local = union(ranges(read('styles/home-text-font.css')));
  const fallback = union(ranges(pageFontCss(upstream, read('styles/home-text-font.css'))).slice(0, -1));
  for (const character of runtime.characters) {
    assert.ok(local.has(character.codePointAt(0)), `local runtime coverage: ${character}`);
    assert.ok(!fallback.has(character.codePointAt(0)), `no duplicate runtime fallback: ${character}`);
  }
  assert.equal(runtime.provenance.length, 3);
  const apiProvenance = runtime.provenance.slice(0, 2);
  assert.deepEqual(new Set(apiProvenance.map(item => item.endpoint)), new Set(['/api/ticker','/api/home-widgets']));
  assert.deepEqual(new Set(runtime.provenance.flatMap(item => [...item.characters])), new Set(runtime.characters));
  for (const item of apiProvenance) {
    assert.equal(item.artifact, 'cardpick-layout-20261013/api-snapshots.json');
    assert.equal(item.observedAt, '2026-10-12T10:34:18.325Z');
    assert.match(item.artifactSha256, /^[a-f0-9]{64}$/);
    assert.match(item.bodySha256, /^[a-f0-9]{64}$/);
  }
  assert.deepEqual(runtime.provenance[2], {
    source:'index.html', cssProperty:'text-overflow:ellipsis',
    reference:'https://www.w3.org/TR/css-overflow-3/#text-overflow', verifiedOn:'2026-10-15',
    rendering:'CSS-generated U+2026; not an API or DOM text character', characters:'…',
  });
  assert.match(read('index.html'), /text-overflow:\s*ellipsis/);
  const unlisted = [...union(ranges(upstream))].find(code => code >= 0xAC00 && code <= 0xD7A3 && !local.has(code));
  assert.ok(unlisted && fallback.has(unlisted), 'unlisted future Hangul remains in the pinned fallback');
  const builder = read('scripts/build-page-fonts.py');
  assert.match(builder, /if page == 'home':[\s\S]*runtime = json\.loads/);
  assert.match(builder, /characters = runtime\.get\('characters'\)/);
  assert.match(builder, /codepoints\.update\(ord\(c\) for c in characters\)/);
  assert.doesNotMatch(builder, /text \+=.*runtime|codepoints\.update\([^\n]*provenance/);
});

test('CSS-generated ellipsis is local without duplicate fallback and removing its glyph fails', () => {
  const assertEllipsis = css => {
    assert.ok(union(ranges(css)).has(0x2026), 'The actual text-overflow ellipsis glyph is covered');
    assert.ok(!union(ranges(pageFontCss(upstream, css)).slice(0,-1)).has(0x2026), 'No duplicate ellipsis fallback');
  };
  const css = read('styles/home-text-font.css');
  assertEllipsis(css);
  const changed = css.replace('U+2026,', '');
  assert.notEqual(changed, css);
  assert.throws(() => assertEllipsis(changed), {code:'ERR_ASSERTION'});
});

function assertCurrentHomeCopyCoverage(css) {
  const local = union(ranges(css));
  for (const character of '목날짜') {
    assert.ok(local.has(character.codePointAt(0)), `current static home copy: ${character}`);
  }
}

test('home-only regeneration covers the newly approved static copy without weakening fallback or glyph guards', () => {
  const css = read('styles/home-text-font.css');
  const source = read('index.html').replace(/<style\b[^>]*>[\s\S]*?<\/style>/g, '');
  for (const character of '목날짜') assert.ok(source.includes(character), 'Observed static source character');
  assertCurrentHomeCopyCoverage(css);
  for (const character of '목날짜') {
    const token = `U+${character.codePointAt(0).toString(16).toUpperCase()}`;
    const changed = css.replace(token + ',', '');
    assert.notEqual(changed, css, 'negative coverage fixture must remove a real source character');
    assert.throws(() => assertCurrentHomeCopyCoverage(changed), { code:'ERR_ASSERTION' });
  }
});

function assertPriceCopyCoverage(css) {
  const local = union(ranges(css));
  const source = read('guide-card-price.html').replace(/<style\b[^>]*>[\s\S]*?<\/style>/g, '');
  for (const character of new Set(source)) {
    const code = character.codePointAt(0);
    if (code >= 0xAC00 && code <= 0xD7A3) assert.ok(local.has(code), `price-guide Hangul coverage: ${character}`);
  }
}
test('explicit price target covers the complete existing Korean article with a loss-of-glyph rejection check', () => {
  const css = read('styles/price-text-font.css');
  assertPriceCopyCoverage(css);
  const changed = css.replace('U+BC88,', ''); // 번: the actual card-number paragraph and LCP copy.
  assert.notEqual(changed, css);
  assert.throws(() => assertPriceCopyCoverage(changed), {code:'ERR_ASSERTION'});
  const builder = read('scripts/build-page-fonts.py');
  assert.match(builder, /'price': \['guide-card-price\.html', 'auth\.js', 'search\.js'\]/);
});

test('font build rejects missing, invalid and duplicate targets before touching any output', () => {
  const python = process.env.CARDPICK_FONT_PYTHON || (process.platform === 'win32' ? 'py' : 'python3');
  const prefix = !process.env.CARDPICK_FONT_PYTHON && process.platform === 'win32' ? ['-3'] : [];
  const generator = new URL('scripts/build-page-fonts.py', root);
  for (const args of [[], ['--pages', 'all'], ['--pages', 'home', 'home']]) {
    const result = spawnSync(python, [...prefix, fileURLToPath(generator), 'unused.woff2', ...args], { encoding:'utf8' });
    assert.equal(result.status, 2, result.error?.message || result.stderr);
    assert.match(result.stderr, /required|invalid choice|Duplicate page targets/);
  }
  const synchronizer = new URL('scripts/inline-release-styles.mjs', root);
  for (const args of [[], ['--page', 'card'], ['--page', 'home', '--page', 'releases']]) {
    const result = spawnSync(process.execPath, [fileURLToPath(synchronizer), ...args], { encoding:'utf8' });
    assert.equal(result.status, 1);
    assert.match(result.stderr, /Usage: node scripts\/inline-release-styles\.mjs --page home\|releases/);
  }
});

test('range splitting retains unknown and newly introduced characters', () => {
  const full = "@font-face{font-family: 'Pretendard';unicode-range:U+41-46;}";
  const small = "@font-face{font-family:'Cardpick Text';unicode-range:U+42,U+44-45;}";
  const output = pageFontCss(full, small);
  assert.match(output, /unicode-range:U\+41,U\+43,U\+46/);
  assert.deepEqual(union(ranges(output)), new Set([65,66,67,68,69,70]));
});

const growthSources = ['guide-psa-turnaround.html', 'guide-brg-grading.html', 'guide-card-rarities.html',
  'js/cp-rarity-helper.js', 'cp-share.js'];
function assertGrowthCopyCoverage(css) {
  const covered = union(ranges(css));
  for (const file of growthSources) {
    const text = read(file).replace(/<style\b[^>]*>[\s\S]*?<\/style>/g, '');
    for (const character of new Set(text)) {
      const code = character.codePointAt(0);
      if (code >= 0xAC00 && code <= 0xD7A3) assert.ok(covered.has(code), `${file}: missing ${character}`);
    }
  }
  for (let code = 32; code < 127; code++) assert.ok(covered.has(code), 'Printable ASCII remains covered');
}

test('growth guides use one bounded, same-source subset with complete disjoint fallback', () => {
  const subset = read('styles/growth-guides-text-font.css');
  const combined = pageFontCss(upstream, subset);
  const produced = ranges(combined);
  const local = produced.pop();
  assert.deepEqual(union([...produced, local]), union([...ranges(upstream), ...ranges(subset)]));
  for (const fallback of produced) for (const code of fallback) assert.ok(!local.has(code));
  assert.match(subset, /font-weight:45 920;font-display:optional/);
  assert.match(subset, /SIL OFL 1\.1/);
  const binary = readFileSync(new URL('fonts/cardpick-text/growth-guides.woff2', root));
  assert.ok(binary.length < 150_000);
  assert.equal(sha(binary), 'f8e301aa9649a1082758221996d725ce3b59aa47d921384e01e4c50f217292d7');
  assert.equal(sha(subset), 'ae4857a9f109fa54d16e524bf1f34f5478ef42f437f2625894b742b8a42c0b3e');
  assert.ok(subset.includes(`/fonts/cardpick-text/growth-guides.woff2?v=${sha(binary).slice(0, 12)}`));
  assertGrowthCopyCoverage(subset);
  for (const file of growthSources.slice(0, 3)) {
    const html = read(file);
    const matches = [...html.matchAll(/<style id="growth-guides-font-css">([\s\S]*?)<\/style>/g)];
    assert.equal(matches.length, 1, file + ': exactly one font slot');
    assert.equal(matches[0][1], combined, file + ': generated CSS is exact');
    assert.ok(html.indexOf(matches[0][0]) < html.indexOf('</head>'));
    assert.doesNotMatch(html, /<link[^>]*rel="preload"[^>]*growth-guides\.woff2/);
  }
  const unknown = [...union(ranges(upstream))].find(code => code >= 0xAC00 && code <= 0xD7A3 && !local.has(code));
  assert.ok(unknown && union(produced).has(unknown), 'Future unlisted Korean text retains fallback');
});

test('growth font coverage rejects the loss of an actual shared article character', () => {
  const css = read('styles/growth-guides-text-font.css');
  assertGrowthCopyCoverage(css);
  const character = [...read('guide-psa-turnaround.html')].find(value => /[가-힣]/.test(value));
  const token = `U+${character.codePointAt(0).toString(16).toUpperCase()}`;
  const changed = css.replace(token + ',', '');
  assert.notEqual(changed, css, 'Fixture removes a real source glyph');
  assert.throws(() => assertGrowthCopyCoverage(changed), { code:'ERR_ASSERTION' });
  assert.match(read('scripts/build-page-fonts.py'), /'growth-guides':\s*\[/);
});
