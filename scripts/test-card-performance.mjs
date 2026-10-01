import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import config from './card-tailwind.config.cjs';
import { pageFontCss } from './page-font-css.mjs';
const root = new URL('../', import.meta.url);
const html = readFileSync(new URL('card-detail.html', root), 'utf8').replace(/\r\n/g, '\n');
const css = readFileSync(new URL('styles/card-base.css', root), 'utf8');
test('card performance changes preserve the complete body and price interactions', () => {
  const body = html.split('</head>')[1].replace(
    /document\.querySelectorAll\(selector\)\.forEach\(function\(el\) \{\n      \/\/ Keep unchanged SSR text nodes: replacing them makes stable text a late LCP candidate\.\n      if \(el\.textContent !== text\) el\.textContent = text;\n    \}\);/,
    'document.querySelectorAll(selector).forEach(function(el) { el.textContent = text; });');
  assert.equal(createHash('sha256').update(body).digest('hex'), 'c0d89ed8765f84aa22c4904a29716325fae4e8e7ebe0c7ed760e74bc8fe43386');
});
test('card CSS is compiled from static, server and client classes', () => {
  assert.doesNotMatch(html, /cdn\.tailwindcss\.com|tailwind\.config|fonts\.googleapis\.com|fonts\.gstatic\.com/);
  assert.equal(html.match(/<style id="card-base-css">([\s\S]*?)<\/style>/)[1], css.trim());
  assert.ok(config.content.files.includes('./functions/cards/*.js'));
  assert.ok(config.content.files.includes('./search.js'));
  assert.equal(config.content.transform.html('<style id="card-base-css">old</style>keep'), 'keep');
  for (const selector of ['.hidden{', '.text-up{', '.text-muted{', '.lg\\:grid-cols-3{']) assert.ok(css.includes(selector), selector);
});
test('fonts keep original families and no longer cause late swaps', () => {
  const fallback = readFileSync(new URL('styles/releases-fonts.css', root), 'utf8').trim().replace(/\r\n/g, '\n');
  const subset = readFileSync(new URL('styles/card-text-font.css', root), 'utf8').trim();
  assert.equal(html.match(/<style id="card-font-css">([\s\S]*?)<\/style>/)[1], pageFontCss(fallback, subset));
  assert.match(subset, /font-family:'Cardpick Text';.*font-display:optional;.*unicode-range:U\+20,/);
  assert.ok(existsSync(new URL('fonts/cardpick-text/card.woff2', root)));
  assert.doesNotMatch(html, /media="print"/);
  assert.match(css, /font-display:optional/);
  assert.doesNotMatch(css, /font-display:swap/);
  for (const [, path] of css.matchAll(/url\((\/fonts\/[^)]+)\)/g)) assert.ok(existsSync(new URL(path.slice(1), root)), path);
  const fonts = readFileSync(new URL('styles/releases-fonts.css', root), 'utf8');
  assert.match(fonts, /font-family: 'Pretendard'/);
  assert.match(fonts, /font-display: optional/);
  assert.match(html, /\.mono \{ font-family: 'IBM Plex Mono', 'Cardpick Text', Pretendard, system-ui, monospace/);
  assert.match(html, /--cp-mono:"IBM Plex Mono","Cardpick Text",Pretendard,system-ui,monospace/);
});
test('auth and search stay ordered but do not block parsing; indexing untouched', () => {
  const auth = '<script defer src="/auth.js?v=v3clean"></script>';
  const search = '<script defer src="/search.js?v=20260519ko"></script>';
  assert.ok(html.includes(auth) && html.includes(search));
  assert.ok(html.indexOf(auth) < html.indexOf(search));
  assert.match(html, /<meta name="robots" content="noindex,follow">/);
  assert.match(html, /<link rel="canonical" href="https:\/\/cardpick.kr\/card-detail">/);
});

test('mobile status rows reserve height when observation date wraps', () => {
  assert.match(html, /@media \(max-width:639px\)\{\.cp-statusbar \.cp-row\{height:auto;min-height:34px;row-gap:4px;padding-block:8px\}\}/);
});
