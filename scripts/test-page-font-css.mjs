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
  home: ['e3cb933d6dd33151a0ef52fc5351099fb9e7e4b2c5641be6ab8676b78dda77f4', 'b81b84380614570fedd38c1a9da5f14727ad70e0cbc5b9db7c599130154f8081'],
  releases: ['cb86869c68f16b8c7a03c30ea30ccb93c66947f6f246b0b755cdec13f9388465', '793432e204226ec7f0cf3d9bef184d49a3c23e12eed5137a5705a2093a7e1161'],
};

for (const page of ['card', 'cgc', 'home', 'releases']) {
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
    const file = { card:'card-detail.html', cgc:'guide-cgc-grading.html', home:'index.html', releases:'releases.html' }[page];
    const pageHtml = read(file);
    let expected = output.replace(/\r\n/g, '\n');
    if (page === 'home') expected += '\n' + read('styles/set-fonts.css').trim();
    if (['home', 'releases'].includes(page)) expected += '\n#cp-user-menu,#cp-search-results,#cp-nick-modal>div,#cp-nick-modal input{font-family:'
      + (page === 'home' ? 'var(--sans)' : "'Cardpick Text',Pretendard,system-ui,sans-serif") + '!important}';
    assert.equal(pageHtml.match(new RegExp(`<style id="${page}-font-css">([\\s\\S]*?)<\\/style>`))[1], expected);
    assert.equal(sha(readFileSync(new URL(`fonts/cardpick-text/${page}.woff2`, root))), assets[page][0]);
    assert.equal(sha(read(`styles/${page}-text-font.css`)), assets[page][1]);
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

test('home runtime coverage includes only the seven recorded payload characters and preserves future fallback', () => {
  const runtime = JSON.parse(read('fonts/cardpick-text/home-runtime-chars.txt'));
  assert.deepEqual(Object.keys(runtime).sort(), ['characters','provenance','version']);
  assert.equal(runtime.version, 1);
  assert.equal(runtime.characters, '갸몰완펄팬텀칠');
  assert.equal(new Set(runtime.characters).size, 7);
  const local = union(ranges(read('styles/home-text-font.css')));
  const fallback = union(ranges(pageFontCss(upstream, read('styles/home-text-font.css'))).slice(0, -1));
  for (const character of runtime.characters) {
    assert.ok(local.has(character.codePointAt(0)), `local runtime coverage: ${character}`);
    assert.ok(!fallback.has(character.codePointAt(0)), `no duplicate runtime fallback: ${character}`);
  }
  assert.equal(runtime.provenance.length, 2);
  assert.deepEqual(new Set(runtime.provenance.map(item => item.endpoint)), new Set(['/api/ticker','/api/home-widgets']));
  assert.deepEqual(new Set(runtime.provenance.flatMap(item => [...item.characters])), new Set(runtime.characters));
  for (const item of runtime.provenance) {
    assert.equal(item.artifact, 'cardpick-layout-20261013/api-snapshots.json');
    assert.equal(item.observedAt, '2026-10-12T10:34:18.325Z');
    assert.match(item.artifactSha256, /^[a-f0-9]{64}$/);
    assert.match(item.bodySha256, /^[a-f0-9]{64}$/);
  }
  const unlisted = [...union(ranges(upstream))].find(code => code >= 0xAC00 && code <= 0xD7A3 && !local.has(code));
  assert.ok(unlisted && fallback.has(unlisted), 'unlisted future Hangul remains in the pinned fallback');
  const builder = read('scripts/build-page-fonts.py');
  assert.match(builder, /if page == 'home':[\s\S]*runtime = json\.loads/);
  assert.match(builder, /characters = runtime\.get\('characters'\)/);
  assert.match(builder, /codepoints\.update\(ord\(c\) for c in characters\)/);
  assert.doesNotMatch(builder, /text \+=.*runtime|codepoints\.update\([^\n]*provenance/);
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
