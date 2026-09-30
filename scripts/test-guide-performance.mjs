import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
const html = readFileSync(new URL('../guide-fake-detection.html', import.meta.url), 'utf8').replace(/\r\n/g, '\n');

test('fake guide performance changes leave the approved body and structured metadata byte-identical', () => {
  const body = html.split('</head>')[1];
  assert.equal(createHash('sha256').update(body).digest('hex'),
    '0b402bd771303dd4f5a70798c230d050b9bd6821f67ca43361167649871de3c9');
});

test('fake guide uses the pinned precompiled design and no runtime Tailwind compiler', () => {
  assert.doesNotMatch(html, /cdn\.tailwindcss\.com|tailwind\.config/);
  assert.match(html, /<link rel="stylesheet" href="\/styles\/fake-guide-base\.css\?v=20260930">/);
  const css = readFileSync(new URL('../styles/fake-guide-base.css', import.meta.url), 'utf8');
  assert.match(css, /tailwindcss v3\.4\.17/);
  assert.ok(css.includes('.max-w-\\[820px\\]'));
  assert.ok(css.includes('.lg\\:px-8'));
  assert.ok(Buffer.byteLength(css) < 15000);
});

test('the existing guide fonts are nonblocking and retained for no-script readers', () => {
  const fallback = html.match(/<noscript>([\s\S]*?)<\/noscript>/)[1];
  const scripted = html.replace(/<noscript>[\s\S]*?<\/noscript>/, '');
  for (const [, href] of fallback.matchAll(/href="([^"]+)"/g)) {
    const links = scripted.match(/<link rel="stylesheet" media="print"[^>]*>/g);
    assert.ok(links.some(link => link.includes(`href="${href}"`) && link.includes("this.media='all'")));
  }
});
