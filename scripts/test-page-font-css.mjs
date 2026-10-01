import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, statSync } from 'node:fs';
import { pageFontCss, parseRanges } from './page-font-css.mjs';
const root = new URL('../', import.meta.url);
const upstream = readFileSync(new URL('styles/releases-fonts.css', root), 'utf8');
const ranges = css => [...css.matchAll(/unicode-range:\s*([^;}]+)/g)].map(m => parseRanges(m[1]));
const union = sets => new Set(sets.flatMap(s => [...s]));

for (const page of ['card', 'cgc']) {
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
    const pageHtml = readFileSync(new URL(page === 'card' ? 'card-detail.html' : 'guide-cgc-grading.html', root), 'utf8');
    assert.equal(pageHtml.match(new RegExp(`<style id="${page}-font-css">([\\s\\S]*?)<\\/style>`))[1].replace(/\r\n/g, '\n'), output.replace(/\r\n/g, '\n'));
  });
}

test('range splitting retains unknown and newly introduced characters', () => {
  const full = "@font-face{font-family: 'Pretendard';unicode-range:U+41-46;}";
  const small = "@font-face{font-family:'Cardpick Text';unicode-range:U+42,U+44-45;}";
  const output = pageFontCss(full, small);
  assert.match(output, /unicode-range:U\+41,U\+43,U\+46/);
  assert.deepEqual(union(ranges(output)), new Set([65,66,67,68,69,70]));
});
