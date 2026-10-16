// Resource/behavior regression checks are not Lighthouse scores or indexing proof.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { pageFontCss } from './page-font-css.mjs';
const root = new URL('../', import.meta.url);
const read = file => readFileSync(new URL(file, root), 'utf8').replaceAll('\r\n', '\n');
const sha = value => createHash('sha256').update(value).digest('hex');
const html = read('guide-card-price.html');
const oldResources = "<link rel=\"preconnect\" href=\"https://cdn.jsdelivr.net\">\n<link rel=\"preconnect\" href=\"https://fonts.googleapis.com\">\n<link rel=\"preconnect\" href=\"https://fonts.gstatic.com\" crossorigin>\n<link rel=\"preconnect\" href=\"https://cdn.tailwindcss.com\">\n<link rel=\"stylesheet\" href=\"https://cdn.jsdelivr.net/gh/orioncactus/pretendard@v1.3.9/dist/web/static/pretendard.min.css\">\n<link rel=\"stylesheet\" href=\"https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;500;600&display=swap\">\n<script src=\"https://cdn.tailwindcss.com\"></script>\n<script>tailwind.config={theme:{extend:{colors:{bg:'#05080D',panel:'#0D121B',panel2:'#111722',line:'rgba(255,255,255,0.08)',ink:'#E8EDF5',muted:'#8B96A8',up:'#26E0C2',down:'#FF4D6D',brand:'#26E0C2',warn:'#E0B84A'},fontFamily:{sans:['Pretendard','system-ui','sans-serif'],mono:['\"IBM Plex Mono\"','ui-monospace','monospace']}}}}</script>";
const fonts = pageFontCss(read('styles/releases-fonts.css'), read('styles/price-text-font.css'));
const resources = '<link rel="preconnect" href="https://cdn.jsdelivr.net" crossorigin>\n<style id="price-font-css">' + fonts + '</style>';
const compiledBlock = '<style id="price-base-css">' + read('styles/card-price-base.css') + '</style>';
const originalBodyFont = '  html,body{background:#05080D;color:#E8EDF5;font-family:Pretendard,system-ui,sans-serif}';
const currentBodyFont = "  html,body{background:#05080D;color:#E8EDF5;font-family:'Cardpick Text',Pretendard,system-ui,sans-serif}\n  button[onclick=\"cpShare()\"]{font-family:'Cardpick Text',Pretendard,system-ui,sans-serif!important}";
const originalModified = '<meta property="article:modified_time" content="2026-09-21T18:30:00+09:00">';
const currentModified = '<meta property="article:modified_time" content="2026-10-14">';
const occurrences = (source, value) => source.split(value).length - 1;

function assertPricePreserved(source) {
  assert.equal(occurrences(source, resources), 1, 'One exact same-outline subset plus complete disjoint fallback');
  assert.ok(source.includes(resources + '\n\n<style>'), 'Font resources stay at their original head anchor');
  assert.equal(occurrences(source, compiledBlock), 1, 'One exact synchronized page-owned compiled stylesheet');
  assert.ok(source.includes(compiledBlock + '\n</head>'), 'Compiled CSS retains the runtime stylesheet cascade position');
  assert.equal(occurrences(source, currentBodyFont), 1, 'Only the exact same-outline font aliases change');
  assert.equal(occurrences(source, currentModified), 1);
  const restored = source.replace(resources, oldResources)
    .replace(compiledBlock + '\n</head>', '</head>')
    .replace(currentBodyFont, originalBodyFont)
    .replace(currentModified, originalModified);
  assert.equal(sha(restored), '6ab3a96f5acd324668a10b1b00d036fb688028ef4a89048a99094d8aad6df048',
    'The entire previously approved document outside exact resources/date stays unchanged');
  assert.equal(sha(source.slice(source.indexOf('</head>') + 7)),
    'd345ee3de27d42a1a4557e4c188794c96a40953bd98037edbf68017380e97a8e',
    'All guide body, facts, links, sharing and layout remain unchanged');
}

test('price guide preserves the complete approved article except exact resource/date changes', () => assertPricePreserved(html));
test('price resource guard rejects duplicate, moved, stale and arbitrary head/body changes', () => {
  const cases = [
    html.replace(resources, resources + '\n' + resources),
    html.replace(resources, oldResources),
    html.replace(resources, '').replace('</head>', resources + '\n</head>'),
    html.replace('font-display:optional', 'font-display:swap'),
    html.replace('<style id="price-font-css">', '<style id="price-font-css" data-changed>'),
    html.replace(compiledBlock, compiledBlock + '\n' + compiledBlock),
    html.replace(compiledBlock + '\n</head>', '</head>').replace('<style>', compiledBlock + '\n<style>'),
    html.replace('price-base-css', 'unapproved-base-css'),
    html.replace(currentBodyFont, originalBodyFont),
    html.replace(currentBodyFont, currentBodyFont + '\nbody{display:none}'),
    html.replace('<title>', '<title>changed '),
    html.replace('rel="canonical"', 'rel="alternate"'),
    html.replace('content="index,follow', 'content="noindex,follow'),
    html.replace('name="robots"', 'name="unapproved"'),
    html.replace('언어판·홀로·리버스 홀로 등 가공', '카드 이름'),
    html.replace('color:#E8EDF5;font-family:', 'color:red;font-family:'),
    html.replace('</body>', '<script>unapproved()</script></body>'),
    html.replace(currentModified, originalModified),
  ];
  for (const changed of cases) {
    assert.notEqual(changed, html, 'Negative fixture must change the document');
    assert.throws(() => assertPricePreserved(changed), { code: 'ERR_ASSERTION' });
  }
});

test('page-owned CSS/config keep the original theme and licensed local Mono files', () => {
  const require = createRequire(import.meta.url);
  const config = require('./card-price-tailwind.config.cjs');
  assert.deepEqual(config.content.files, ['./guide-card-price.html']);
  const fixture = 'before<style id="price-font-css">.collapse{}</style>middle<style id="price-base-css">.block{}</style>after';
  assert.equal(config.content.transform.html(fixture), 'beforemiddleafter', 'Only the two generated slots are excluded from content scanning');
  assert.equal(config.content.transform.html(html), config.content.transform.html(config.content.transform.html(html)),
    'Repeated builds cannot accumulate utility classes from generated styles');
  assert.equal(config.content.transform.html('<style>body{color:red}</style><div class="block"></div>'),
    '<style>body{color:red}</style><div class="block"></div>', 'Original styles and actual body utility classes stay in the scan');
  assert.deepEqual(config.theme.extend.colors, {
    bg:'#05080D', panel:'#0D121B', panel2:'#111722', line:'rgba(255,255,255,0.08)',
    ink:'#E8EDF5', muted:'#8B96A8', up:'#26E0C2', down:'#FF4D6D', brand:'#26E0C2', warn:'#E0B84A',
  });
  assert.deepEqual(config.theme.extend.fontFamily, {
    sans:['"Cardpick Text"','Pretendard','system-ui','sans-serif'], mono:['"IBM Plex Mono"','ui-monospace','monospace'],
  });
  const css = read('styles/card-price-base.css');
  assert.match(css, /tailwindcss v3\.4\.17/);
  assert.ok(Buffer.byteLength(css) < 30_000);
  assert.equal(sha(css), '964f6c5bdbb5764e7724fdeb6d9482f9254f271030cf162cb560c27b76443047', 'Exact generated CSS, not a broad CSS exception');
  assert.equal(sha(read('styles/price-text-font.css')), 'a129dcb01c5b8d5b9a79d40f92a8f157513aa25997d0968d0d4bf532e2e9e72c');
  assert.equal(sha(readFileSync(new URL('fonts/cardpick-text/price.woff2', root))), 'cf9502ec606838c6a4f6f9679a8755126b623d50d95ed3cf5d87eb6e384ba4ef');
  assert.doesNotMatch(html, /<link[^>]+(?:card-price-base|releases-fonts|price-text-font)\.css/);
  assert.doesNotMatch(html, /cdn\.tailwindcss\.com|tailwind\.config|fonts\.googleapis\.com|fonts\.gstatic\.com/);
  assert.doesNotMatch(css, /font-display:swap|url\([^)]*https?:/);
  assert.match(css, /\.bg-bg\{/);
  assert.match(css, /\.max-w-\\\[820px\\\]/);
  const fonts = [...css.matchAll(/url\((\/fonts\/ibm-plex-mono\/[^)]+)\)/g)].map(match => match[1]);
  assert.ok(fonts.length >= 15, 'Keep all existing Mono unicode/weight faces, not a guessed Latin-only face');
  for (const url of fonts) assert.ok(existsSync(new URL(url.slice(1), root)), url);
  const sharedInput = read('styles/guides.input.css');
  const upstreamFonts = [...sharedInput.matchAll(/url\((\/fonts\/ibm-plex-mono\/[^)]+)\)/g)].map(match => match[1]);
  assert.deepEqual(fonts, upstreamFonts, 'Font binaries and Unicode coverage remain the original licensed set');
});

test('shared CSS, upstream dynamic font resources and other consumers remain byte-identical', () => {
  const hashes = {
    'styles/guides.input.css':'9c0f2164f4fa329a4dcc557315f537cda8d80da54274a349a81bc3085d657f4f',
    'styles/releases-fonts.css':'7d0f063277161d13cc8a09600a4c02e731eef406846a93c0273c4b9b7d9f5063',
    'styles/set-fonts.css':'9a20ba1737cc7fd798a2e0fb345ed44c845a07fcae8c1159ab1c062991adcb35',
  };
  for (const [file, digest] of Object.entries(hashes)) {
    assert.equal(sha(readFileSync(new URL(file, root))), digest, file);
  }
  const pretendard = read('styles/releases-fonts.css');
  assert.match(pretendard, /pretendard@v1\.3\.9/);
  assert.match(pretendard, /font-family: 'Pretendard'/);
  assert.match(pretendard, /font-display: optional/);
  assert.doesNotMatch(pretendard, /font-display:\s*swap/);
});

test('the isolated CSS builder rejects incomplete or unrelated requests before producing output', () => {
  const config = fileURLToPath(new URL('scripts/card-price-tailwind.config.cjs', root));
  const before = sha(readFileSync(new URL('styles/card-price-base.css', root)));
  const beforeArticle = sha(readFileSync(new URL('guide-card-price.html', root)));
  for (const args of [[], ['--build'], ['--wrong', 'unused']]) {
    const result = spawnSync(process.execPath, [config, ...args], { encoding:'utf8' });
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /Usage:/);
    assert.equal(sha(readFileSync(new URL('styles/card-price-base.css', root))), before);
    assert.equal(sha(readFileSync(new URL('guide-card-price.html', root))), beforeArticle);
  }
});

function assertToolLoading(source, name) {
  const scripted = source.replace(/<noscript>[\s\S]*?<\/noscript>/g, '');
  const links = [...scripted.matchAll(/<link\b[^>]*>/g)].map(match => match[0]);
  const fonts = links.filter(tag => /href="https:\/\/fonts\.googleapis\.com\//.test(tag));
  assert.equal(fonts.length, 1, 'One nonblocking existing Google font stylesheet');
  assert.match(fonts[0], /media="print"/);
  assert.match(fonts[0], /onload="this\.media='all'"/);
  assert.match(fonts[0], /display=optional/);
  assert.match(fonts[0], /JetBrains\+Mono/);
  assert.doesNotMatch(fonts[0], /VT323/);
  const href = fonts[0].match(/href="([^"]+)"/)[1];
  const fallback = source.match(/<noscript>([\s\S]*?)<\/noscript>/)?.[1] || '';
  assert.ok(fallback.includes('href="' + href + '"'), 'No-JavaScript readers retain the same font source');
  if (name === 'centering-checker') return;
  const auth = [...scripted.matchAll(/<script\b([^>]*)src="\/auth\.js\?v=v3clean"([^>]*)><\/script>/g)];
  assert.equal(auth.length, 1);
  assert.match(auth[0][0], /\bdefer\b/);
  if (name === 'psa-grading-break-even') {
    const search = [...scripted.matchAll(/<script\b([^>]*)src="\/search\.js\?v=20260519ko"([^>]*)><\/script>/g)];
    assert.equal(search.length, 1);
    assert.match(search[0][0], /\bdefer\b/);
    assert.ok(auth[0].index < search[0].index, 'Shared auth/search execution order is retained');
  }
}
for (const name of ['centering-checker','overseas-card-cost','psa-grading-break-even']) {
  test(name + ': existing fonts and shared scripts no longer block document parsing', () => {
    assertToolLoading(read('tools/' + name + '.html'), name);
  });
}
test('tool loading checks reject a missing fallback, blocking stylesheet or changed script order', () => {
  const source = read('tools/psa-grading-break-even.html');
  const auth = source.match(/<script\b[^>]*src="\/auth\.js\?v=v3clean"[^>]*><\/script>/)[0];
  const search = source.match(/<script\b[^>]*src="\/search\.js\?v=20260519ko"[^>]*><\/script>/)[0];
  const cases = [
    source.replace(/media="print"/, 'media="all"'),
    source.replace('display=optional', 'display=swap'),
    source.replace(/<noscript>[\s\S]*?<\/noscript>/, ''),
    source.replace(auth, auth.replace(/\sdefer\b/, '')),
    source.replace(auth, '').replace(search, search + '\n' + auth),
  ];
  for (const changed of cases) {
    assert.notEqual(changed, source, 'Negative fixture must change its source');
    assert.throws(() => assertToolLoading(changed, 'psa-grading-break-even'), { code:'ERR_ASSERTION' });
  }
});
