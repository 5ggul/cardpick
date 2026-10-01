import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import config from './cgc-tailwind.config.cjs';
import { pageFontCss } from './page-font-css.mjs';
const root = new URL('../', import.meta.url);
const html = readFileSync(new URL('guide-cgc-grading.html', root), 'utf8').replace(/\r\n/g, '\n');
const css = readFileSync(new URL('styles/cgc-base.css', root), 'utf8');

test('CGC loading optimization leaves corrected article and interactions unchanged', () => {
  assert.equal(createHash('sha256').update(html.split('</head>')[1]).digest('hex'), 'bf1d193e56c2d2c883b9fc3f97fec6ce7ed1b3ec1d6b7da6635554aec03d5ae2');
  assert.match(html, /<meta name="robots" content="index,follow,max-image-preview:large,max-snippet:-1">/);
  assert.match(html, /width="1672" height="941" fetchpriority="high"/);
});

test('CGC renders with compiled original-theme CSS, without runtime Tailwind', () => {
  assert.doesNotMatch(html, /cdn\.tailwindcss\.com|tailwind\.config|fonts\.googleapis\.com|fonts\.gstatic\.com|web\/static\/pretendard/);
  assert.equal(html.match(/<style id="cgc-base-css">([\s\S]*?)<\/style>/)[1], css.trim());
  assert.equal(config.theme.extend.colors.bg, '#05080D');
  assert.equal(config.theme.extend.colors.panel, '#0D121B');
  assert.equal(config.theme.extend.colors.ink, '#E8EDF5');
  for (const selector of ['.max-w-\\[820px\\]{', '.text-muted{', '.font-black{']) assert.ok(css.includes(selector), selector);
});

test('CGC fonts use existing licensed subsets without late layout swaps', () => {
  const fallback = readFileSync(new URL('styles/releases-fonts.css', root), 'utf8').trim().replace(/\r\n/g, '\n');
  const subset = readFileSync(new URL('styles/cgc-text-font.css', root), 'utf8').trim();
  assert.equal(html.match(/<style id="cgc-font-css">([\s\S]*?)<\/style>/)[1], pageFontCss(fallback, subset));
  assert.ok(existsSync(new URL('fonts/cardpick-text/cgc.woff2', root)));
  assert.match(css, /font-display:optional/);
  assert.doesNotMatch(css, /font-display:swap/);
  for (const [, path] of css.matchAll(/url\((\/fonts\/[^)]+)\)/g)) assert.ok(existsSync(new URL(path.slice(1), root)), path);
  assert.match(html, /\.mono\{font-family:'IBM Plex Mono','Cardpick Text',Pretendard,system-ui,monospace/);
});
