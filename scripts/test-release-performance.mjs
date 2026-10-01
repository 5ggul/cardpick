import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import config from './releases-tailwind.config.cjs';

const root = new URL('../', import.meta.url);
const html = readFileSync(new URL('releases.html', root), 'utf8').replace(/\r\n/g, '\n');
const css = readFileSync(new URL('styles/releases-base.css', root), 'utf8');

test('performance work preserves the body, interactions and links outside daily generated regions', () => {
  const body = html.split('</head>')[1].replace(/<!-- CAL:[A-Z-]+:START -->[\s\S]*?<!-- CAL:[A-Z-]+:END -->/g, '');
  assert.equal(createHash('sha256').update(body).digest('hex'),
    '160047112b17870ed54b87d1e94b398609806e5de1984d66f6a30f41246d5af1');
});

test('release page uses precompiled styles with original colors and responsive utilities', () => {
  assert.doesNotMatch(html, /cdn\.tailwindcss\.com|tailwind\.config/);
  assert.equal(html.match(/<style id="release-base-css">([\s\S]*?)<\/style>/)[1], css.trim());
  assert.match(css, /tailwindcss v3\.4\.17/);
  assert.deepEqual(config.theme.extend.colors, {
    bg: '#080B10', panel: '#111620', panel2: '#151B26', line: '#253044',
    ink: '#E8EEF7', muted: '#8B96A8', up: '#12D6B0', down: '#FF4D6D', gold: '#F2C94C', brand: '#26E0C2',
  });
  for (const selector of ['.hidden{', '.sm\\:block{', '.lg\\:px-8{', '.max-w-\\[1440px\\]', '.sm\\:text-\\[46px\\]', '.lg\\:text-\\[54px\\]', '.hover\\:bg-panel2:hover']) {
    assert.ok(css.includes(selector), `Missing ${selector}`);
  }
  assert.ok(config.content.files.includes('./scripts/build_release_calendar.py'));
  assert.equal(config.content.transform.html('<style id="release-base-css">compiled</style><div class="hidden">keep</div>'), '<div class="hidden">keep</div>');
  assert.ok(Buffer.byteLength(css) < 25000);
});

test('font loading preserves the existing families and works without JavaScript', () => {
  assert.doesNotMatch(html, /fonts\.googleapis\.com|fonts\.gstatic\.com/);
  assert.match(html, /<link rel="stylesheet" media="print" href="\/styles\/releases-fonts\.css\?v=20261001" onload="this.onload=null;this.media='all'">/);
  assert.match(html, /<noscript><link rel="stylesheet" href="\/styles\/releases-fonts\.css\?v=20261001"><\/noscript>/);
  const fonts = readFileSync(new URL('styles/releases-fonts.css', root), 'utf8');
  assert.match(fonts, /SIL Open Font License/);
  assert.match(fonts, /font-family: 'Pretendard'/);
  assert.match(fonts, /font-weight: 45 920/);
  assert.doesNotMatch(fonts, /font-display: swap/);
  const faces = [...fonts.matchAll(/@font-face\s*\{([^}]+)\}/g)];
  assert.ok(faces.length > 50, 'Keep all upstream character ranges, including future calendar names');
  for (const [, face] of faces) {
    assert.match(face, /font-display: optional/);
    assert.match(face, /unicode-range:/);
    assert.match(face, /url\(https:\/\/cdn\.jsdelivr\.net\/gh\/orioncactus\/pretendard@v1\.3\.9\/packages\/pretendard\/dist\/web\/variable\/woff2-dynamic-subset\/PretendardVariable\.subset\.\d+\.woff2\)/);
  }
  for (const [, path] of css.matchAll(/url\((\/fonts\/[^)]+)\)/g)) {
    assert.ok(existsSync(new URL(path.slice(1), root)), `Missing ${path}`);
  }
  assert.ok(existsSync(new URL('fonts/ibm-plex-mono/OFL.txt', root)));
});

test('shared auth and search keep their order and no longer block parsing', () => {
  const auth = '<script defer src="/auth.js?v=v3clean"></script>';
  const search = '<script defer src="/search.js?v=20260519ko"></script>';
  assert.ok(html.includes(auth) && html.includes(search));
  assert.ok(html.indexOf(auth) < html.indexOf(search));
});

test('canonical, robots and structured data remain present', () => {
  assert.match(html, /<link rel="canonical" href="https:\/\/cardpick.kr\/releases">/);
  assert.match(html, /<meta name="robots" content="index,follow,max-image-preview:large,max-snippet:-1">/);
  const schemas = [...html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)].map(match => JSON.parse(match[1]));
  assert.deepEqual(schemas.map(value => value['@type']).sort(), ['BreadcrumbList', 'FAQPage', 'ItemList']);
  const answer = html.match(/<!-- CAL:FAQ1:START -->\s*([\s\S]*?)\s*<!-- CAL:FAQ1:END -->/)[1];
  assert.equal(schemas.find(value => value['@type'] === 'FAQPage').mainEntity[0].acceptedAnswer.text, answer);
});
