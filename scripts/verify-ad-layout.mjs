import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import { realpath, readFile, stat } from 'node:fs/promises';
import { createServer } from 'node:http';
import path from 'node:path';
import test from 'node:test';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(fileURLToPath(new URL('../', import.meta.url)));
const PREVIEW_HOST = '127.0.0.1';
const PREVIEW_PORT = 4213;
const SERVE_MODE = process.argv.includes('--serve');
const BASE_SHA = '3f1906e40a20d66ae5317332955384957e7ec601';

const AD_SOURCE_FILES = [
  'index.html',
  'functions/_middleware.js',
  'functions/guides.js',
  'functions/hot.js',
  'functions/search.js',
  'guide-grading-proxy.html',
  'guide-pikachu-cards.html',
  'guide-what-is-tcg.html',
];

const APPROVED_FILES = new Set([
  ...AD_SOURCE_FILES,
  'ads.js',
  'styles/ads.css',
  'scripts/verify-ad-layout.mjs',
  'scripts/test-search-ssr.mjs',
  'scripts/test-guide-thumbnails.mjs',
  'scripts/ad-guides-tailwind.config.cjs',
  'scripts/ad-tcg-tailwind.config.cjs',
  'styles/ad-guides-base.css',
  'styles/ad-tcg-base.css',
  'scripts/test-ad-guide-performance.mjs',
]);

// Exact resource migrations only: the original inline styles, metadata and body
// remain protected by the full-source comparison against the immutable rollout base.
const ORIGINAL_SHARED_GUIDE_RESOURCES = `<link rel="preconnect" href="https://cdn.jsdelivr.net">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="preconnect" href="https://cdn.tailwindcss.com">
<link rel="stylesheet" as="style" href="https://cdn.jsdelivr.net/gh/orioncactus/pretendard@v1.3.9/dist/web/static/pretendard.min.css">
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;500;600&display=swap">
<script src="https://cdn.tailwindcss.com"></script>
<script>tailwind.config={theme:{extend:{colors:{bg:'#05080D',panel:'#0D121B',panel2:'#111722',line:'rgba(255,255,255,0.08)',ink:'#E8EDF5',muted:'#8B96A8',up:'#26E0C2',down:'#FF4D6D',brand:'#26E0C2',warn:'#E0B84A'},fontFamily:{sans:['Pretendard','system-ui','sans-serif'],mono:['"IBM Plex Mono"','ui-monospace','monospace']}}}}</script>`;

const COMPILED_SHARED_GUIDE_RESOURCES = `<link rel="preconnect" href="https://cdn.jsdelivr.net">
<link rel="stylesheet" media="print" onload="this.media='all'" href="https://cdn.jsdelivr.net/gh/orioncactus/pretendard@v1.3.9/dist/web/static/pretendard.min.css">
<noscript><link rel="stylesheet" href="https://cdn.jsdelivr.net/gh/orioncactus/pretendard@v1.3.9/dist/web/static/pretendard.min.css"></noscript>`;

const PERFORMANCE_RESOURCES = {
  'index.html': {
    original: `<link rel="stylesheet" as="style" crossorigin href="https://cdn.jsdelivr.net/gh/orioncactus/pretendard@v1.3.9/dist/web/variable/pretendardvariable-dynamic-subset.min.css">
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;500;600&display=swap">`,
    replacement: `<link rel="stylesheet" as="style" crossorigin href="https://cdn.jsdelivr.net/gh/orioncactus/pretendard@v1.3.9/dist/web/variable/pretendardvariable-dynamic-subset.min.css" media="print" onload="this.media='all'">
<noscript><link rel="stylesheet" as="style" crossorigin href="https://cdn.jsdelivr.net/gh/orioncactus/pretendard@v1.3.9/dist/web/variable/pretendardvariable-dynamic-subset.min.css"></noscript>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;500;600&display=swap" media="print" onload="this.media='all'">
<noscript><link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;500;600&display=swap"></noscript>`,
  },
  'guide-grading-proxy.html': {
    original: ORIGINAL_SHARED_GUIDE_RESOURCES,
    replacement: COMPILED_SHARED_GUIDE_RESOURCES,
    endHeadStylesheet: '<link rel="stylesheet" href="/styles/ad-guides-base.css?v=20261011">',
  },
  'guide-pikachu-cards.html': {
    original: ORIGINAL_SHARED_GUIDE_RESOURCES,
    replacement: COMPILED_SHARED_GUIDE_RESOURCES,
    endHeadStylesheet: '<link rel="stylesheet" href="/styles/ad-guides-base.css?v=20261011">',
  },
  'guide-what-is-tcg.html': {
    original: `<link rel="preconnect" href="https://cdn.jsdelivr.net">
<link rel="stylesheet" href="https://cdn.jsdelivr.net/gh/orioncactus/pretendard/dist/web/static/pretendard.css">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;500;600&display=swap" rel="stylesheet">

<script src="https://cdn.tailwindcss.com"></script>
<script>
  tailwind.config = { theme: { extend: {
    colors: { bg:'#080B10', panel:'#111620', panel2:'#151B26', line:'#253044', ink:'#E8EEF7', muted:'#8B96A8', up:'#12D6B0', down:'#FF4D6D', gold:'#F2C94C', brand:'#26E0C2' },
    fontFamily: { sans:['Pretendard','system-ui','sans-serif'], mono:['"IBM Plex Mono"','ui-monospace','monospace'] }
  }}}
</script>`,
    replacement: `<link rel="preconnect" href="https://cdn.jsdelivr.net">
<link rel="stylesheet" media="print" onload="this.media='all'" href="https://cdn.jsdelivr.net/gh/orioncactus/pretendard/dist/web/static/pretendard.css">
<noscript><link rel="stylesheet" href="https://cdn.jsdelivr.net/gh/orioncactus/pretendard/dist/web/static/pretendard.css"></noscript>`,
    endHeadStylesheet: '<link rel="stylesheet" href="/styles/ad-tcg-base.css?v=20261011">',
  },
};

// These paths were already dirty before the ad rollout. They are deliberately ignored,
// never read by this test, and must not be folded into the advertisement change.
const PRESERVED_DIRTY_PATHS = new Set([
  'docs/release-performance-20261001.md',
  'docs/guide-performance-20260930.md',
  'docs/indexing-audit-20260930.md',
  'scripts/audit-sitemap-lastmod.mjs',
]);

const TARGET_PAGES = [
  { name: 'home', file: 'index.html', placement: 'home' },
  { name: 'guide hub', render: renderGuideHub, placement: 'guide-hub' },
  { name: 'grading proxy guide', file: 'guide-grading-proxy.html', placement: 'guide-body' },
  { name: 'Pikachu guide', file: 'guide-pikachu-cards.html', placement: 'guide-body' },
  { name: 'TCG guide', file: 'guide-what-is-tcg.html', placement: 'guide-body' },
];

const VOID_ELEMENTS = new Set([
  'area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta',
  'param', 'source', 'track', 'wbr',
]);

const PUBLIC_DIRS = new Set(['styles', 'fonts', 'images', 'js', 'assets', 'tools']);
const PUBLIC_ROOT_SCRIPTS = new Set(['ads.js', 'auth.js', 'card-detail.js', 'cp-share.js', 'search.js']);
const PUBLIC_ROOT_FILES = new Set([
  'ads.txt', 'robots.txt', 'manifest.json', 'favicon.ico', 'apple-touch-icon.png',
  'icon-192.png', 'icon-512.png', 'logo-180.png', 'logo-mark.png', 'logo-sm.png',
  'logo.png', 'rss.xml', 'sitemap.xml', 'sitemap-app.xml',
]);
const PUBLIC_ASSET_EXTENSIONS = new Set([
  '.css', '.js', '.woff', '.woff2', '.ttf', '.otf', '.png', '.jpg', '.jpeg',
  '.gif', '.svg', '.webp', '.avif', '.ico', '.json', '.xml', '.txt', '.html',
]);

function readUtf8(relativePath) {
  return fs.readFileSync(path.join(ROOT, relativePath), 'utf8');
}

function occurrences(source, pattern) {
  return [...source.matchAll(pattern)].length;
}

function parseAttributes(fragment) {
  const attributes = Object.create(null);
  const pattern = /([^\s"'<>\/=]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g;
  for (const match of fragment.matchAll(pattern)) {
    const name = match[1].toLowerCase();
    if (!Object.hasOwn(attributes, name)) {
      attributes[name] = match[2] ?? match[3] ?? match[4] ?? '';
    }
  }
  return attributes;
}

function parseHtmlTree(html) {
  const structural = html.replace(
    /<(script|style)\b([^>]*)>[\s\S]*?<\/\1\s*>/gi,
    (_, tag, attributes) => `<${tag}${attributes}></${tag}>`,
  );
  const roots = [];
  const stack = [];
  const tagPattern = /<!--[\s\S]*?-->|<![^>]*>|<\/?[a-zA-Z][^>]*>/g;

  for (const match of structural.matchAll(tagPattern)) {
    const token = match[0];
    if (token.startsWith('<!--') || token.startsWith('<!')) continue;
    const closing = token.match(/^<\/\s*([\w:-]+)/);
    if (closing) {
      const tag = closing[1].toLowerCase();
      for (let index = stack.length - 1; index >= 0; index -= 1) {
        const node = stack[index];
        stack.length = index;
        node.endStart = match.index;
        node.end = match.index + token.length;
        if (node.tag === tag) break;
      }
      continue;
    }

    const opening = token.match(/^<\s*([\w:-]+)([\s\S]*?)\/?\s*>$/);
    if (!opening) continue;
    const tag = opening[1].toLowerCase();
    const node = {
      tag,
      attrs: parseAttributes(opening[2]),
      parent: stack.at(-1) || null,
      children: [],
      start: match.index,
      openEnd: match.index + token.length,
      endStart: null,
      end: null,
    };
    if (node.parent) node.parent.children.push(node);
    else roots.push(node);
    if (!VOID_ELEMENTS.has(tag) && !token.endsWith('/>')) stack.push(node);
  }
  return roots;
}

function walk(nodes) {
  const result = [];
  const visit = node => {
    result.push(node);
    node.children.forEach(visit);
  };
  nodes.forEach(visit);
  return result;
}

function classNames(node) {
  return String(node.attrs.class || '').split(/\s+/).filter(Boolean);
}

function hasClass(node, className) {
  return classNames(node).includes(className);
}

function ancestors(node) {
  const result = [];
  for (let current = node.parent; current; current = current.parent) result.push(current);
  return result;
}

function descendants(node) {
  return walk(node.children);
}

function assertSafePlacement(pageName, html, adNode) {
  const parents = ancestors(adNode);
  assert.ok(parents.some(node => node.tag === 'main'), `${pageName}: the ad must remain in main content`);
  assert.ok(
    parents.every(node => !['nav', 'a', 'button', 'table'].includes(node.tag)),
    `${pageName}: the ad must not be nested in interactive or tabular UI`,
  );
  assert.ok(
    parents.every(node => !['prices', 'guide-grid'].includes(node.attrs.id)),
    `${pageName}: the ad must not be nested in a price or guide grid`,
  );
  assert.ok(
    parents.every(node => !(hasClass(node, 'guide') && node.parent?.attrs.id === 'guides')),
    `${pageName}: the ad must not be a child of the home guide grid`,
  );
  assert.ok(
    parents.every(node => {
      const markers = [node.attrs.id, node.attrs.class, node.attrs['aria-label'], node.attrs['aria-labelledby']]
        .filter(Boolean).join(' ').toLowerCase();
      return !/(?:^|[\s_-])(faq|toc)(?:$|[\s_-])|table-of-contents|목차/.test(markers);
    }),
    `${pageName}: the ad must not be nested in FAQ or table-of-contents content`,
  );

  const labels = descendants(adNode).filter(node => hasClass(node, 'cp-ad-label'));
  assert.equal(labels.length, 1, `${pageName}: expected one visible ad label`);
  assert.match(html, /<[^>]+class=["'][^"']*\bcp-ad-label\b[^"']*["'][^>]*>\s*광고\s*<\//i,
    `${pageName}: a visible neutral ad label is required`);
}

function styleById(html, id) {
  const styles = [...html.matchAll(/<style\b([^>]*)>([\s\S]*?)<\/style>/gi)];
  const matches = styles.filter(match => parseAttributes(match[1]).id === id);
  assert.equal(matches.length, 1, `Expected one #${id} style block`);
  return matches[0][2];
}

function mediaBlocks(css) {
  const blocks = [];
  const pattern = /@media\s*([^\{]+)\{/gi;
  let match;
  while ((match = pattern.exec(css))) {
    let depth = 1;
    let cursor = pattern.lastIndex;
    while (cursor < css.length && depth > 0) {
      if (css[cursor] === '{') depth += 1;
      else if (css[cursor] === '}') depth -= 1;
      cursor += 1;
    }
    assert.equal(depth, 0, 'Responsive ad CSS has balanced braces');
    blocks.push({ query: match[1].replace(/\s+/g, '').toLowerCase(), body: css.slice(pattern.lastIndex, cursor - 1) });
    pattern.lastIndex = cursor;
  }
  return blocks;
}

function hasPixelDeclaration(css, property, value) {
  const pattern = new RegExp(`(?:^|[;{])\\s*${property}\\s*:\\s*${value}px(?:\\s*[;}])`, 'i');
  return pattern.test(css);
}

function assertSizePair(css, width, height, message) {
  assert.ok(
    hasPixelDeclaration(css, 'width', width) && hasPixelDeclaration(css, 'height', height),
    message,
  );
}

function assertResponsiveContract(pageName, html) {
  const css = styleById(html, 'cp-ad-size');
  const blocks = mediaBlocks(css);
  const base = css.slice(0, css.search(/@media/i) < 0 ? css.length : css.search(/@media/i));
  assertSizePair(base, 250, 250, `${pageName}: 320-374px must reserve 250x250`);

  for (const [minimum, width, height] of [[375, 300, 250], [768, 468, 60], [1024, 728, 90]]) {
    const candidates = blocks.filter(block => block.query.includes(`min-width:${minimum}px`));
    assert.equal(candidates.length, 1, `${pageName}: expected one ${minimum}px ad breakpoint`);
    assertSizePair(candidates[0].body, width, height, `${pageName}: incorrect reserved size at ${minimum}px`);
  }

  const hidden = blocks.filter(block => block.query.includes('max-width:319px'));
  assert.equal(hidden.length, 1, `${pageName}: expected one below-320px hide rule`);
  assert.match(hidden[0].body, /(?:^|[;{])\s*display\s*:\s*none\s*[;}]/i,
    `${pageName}: below-320px rule must hide the unit`);
}

async function renderGuideHub() {
  const { onRequest } = await import('../functions/guides.js');
  const response = await onRequest({
    request: new Request(`http://${PREVIEW_HOST}:${PREVIEW_PORT}/guides`),
    waitUntil() {},
  });
  assert.equal(response.status, 200, 'Guide hub SSR must succeed');
  return response.text();
}

async function targetHtml(target) {
  return target.file ? readUtf8(target.file) : target.render();
}

function gitOutput(args) {
  return execFileSync('git', args, {
    cwd: ROOT,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
}

function normalizeApprovedResources(relativePath, source) {
  const migration = PERFORMANCE_RESOURCES[relativePath];
  if (!migration) return source;
  const { original, replacement, endHeadStylesheet } = migration;
  const count = literal => source.split(literal).length - 1;
  assert.equal(count(original) + count(replacement), 1,
    `${relativePath}: expected one exact reviewed resource block`);
  assert.equal(occurrences(source, /<head>/g), 1, `${relativePath}: expected one head`);
  assert.equal(occurrences(source, /<\/head>/g), 1, `${relativePath}: expected one head ending`);

  const literal = source.includes(replacement) ? replacement : original;
  const start = source.indexOf(literal);
  const end = start + literal.length;
  assert.ok(start > source.indexOf('<head>') && end < source.indexOf('</head>'),
    `${relativePath}: resource migration must stay inside head`);
  assert.ok(source.slice(end).startsWith('\n\n<style>'),
    `${relativePath}: resource block moved from the reviewed style anchor`);
  let normalized = source.replace(replacement, original);
  if (endHeadStylesheet) {
    const replacementPresent = literal === replacement;
    assert.equal(count(endHeadStylesheet), replacementPresent ? 1 : 0,
      `${relativePath}: expected one exact compiled stylesheet only with migrated resources`);
    if (replacementPresent) {
      assert.ok(source.includes(`\n${endHeadStylesheet}\n</head>`),
        `${relativePath}: compiled stylesheet must stay at the reviewed end-of-head anchor`);
      normalized = normalized.replace(`${endHeadStylesheet}\n</head>`, '</head>');
    }
  }
  return normalized;
}

function normalizeApprovedSource(relativePath, source) {
  let normalized = source.replace(/\r\n?/g, '\n');
  normalized = normalizeApprovedResources(relativePath, normalized);
  normalized = normalized
    .replace(/\s*<link\b(?=[^>]*\bhref=["']\/styles\/ads\.css(?:\?[^"']*)?["'])[^>]*>\s*/gi, ' ')
    .replace(/\s*<style\b(?=[^>]*\bid=["']cp-ad-size["'])[^>]*>[\s\S]*?<\/style>\s*/gi, ' ')
    .replace(/\s*<script\b(?=[^>]*\bsrc=["']\/ads\.js(?:\?[^"']*)?["'])[^>]*>\s*<\/script>\s*/gi, ' ')
    .replace(/\s*<aside\b(?=[^>]*\bclass=["'][^"']*\bcp-ad\b[^"']*["'])[^>]*>[\s\S]*?<\/aside>\s*/gi, ' ')
    .replace(/\s*<script\b(?=[^>]*\bsrc=["']https:\/\/pagead2\.googlesyndication\.com\/pagead\/js\/adsbygoogle\.js\?[^"']*["'])[^>]*>\s*<\/script>\s*/gi, ' ');

  if (relativePath === 'functions/search.js') {
    normalized = normalized
      .replace(/\n\s*\/\/ AdSense 조건부 로드[\s\S]*?\n\s*const adsScript\s*=\s*hasContent[\s\S]*?\n\s*:\s*'';\s*/m, '\n')
      .replace(/\$\{adsScript\}/g, '');
  }

  // Only the reviewed cache-key literal may change; cache policy and rendering stay intact.
  const cacheKeys = {
    'functions/_middleware.js': ['__home_ssr_v10_content_accuracy', '__home_ssr_v12_manual_ads_fonts'],
    'functions/hot.js': ['__hot_ssr_v3_dyn_title', '__hot_ssr_v4_no_ads'],
  };
  if (cacheKeys[relativePath]) {
    const [oldKey, newKey] = cacheKeys[relativePath].map(key =>
      `const cacheKey = new Request('https://cardpick.kr/${key}', { method: 'GET' });`);
    const count = literal => normalized.split(literal).length - 1;
    assert.equal(count(oldKey) + count(newKey), 1, `${relativePath}: expected one reviewed cache key`);
    normalized = normalized.replace(newKey, oldKey);
  }

  // Fix only the existing full-bleed figures inside the original mobile media block.
  if (['guide-grading-proxy.html', 'guide-what-is-tcg.html'].includes(relativePath)) {
    const anchor = '    main { padding-left: 16px !important; padding-right: 16px !important }\n';
    const rule = '    main figure.-mx-5 { margin-left: -16px; margin-right: -16px }\n';
    if (normalized.includes(rule)) {
      assert.equal(normalized.split(rule).length - 1, 1, `${relativePath}: mobile figure rule must be unique`);
      assert.ok(normalized.includes(anchor + rule), `${relativePath}: mobile figure rule moved from its approved anchor`);
      normalized = normalized.replace(anchor + rule, anchor);
    }
  }

  return normalized.replace(/>\s+</g, '><').replace(/\s+/g, ' ').trim();
}

function changedPaths() {
  const status = gitOutput(['status', '--porcelain=v1', '--untracked-files=all']);
  return status.split(/\r?\n/).filter(Boolean).map(line => {
    const value = line.slice(3);
    return value.includes(' -> ') ? value.split(' -> ').at(-1) : value;
  }).map(value => value.replaceAll('\\', '/'));
}

async function withGlobals(replacements, callback) {
  const originals = new Map();
  for (const [name, value] of Object.entries(replacements)) {
    originals.set(name, Object.getOwnPropertyDescriptor(globalThis, name));
    Object.defineProperty(globalThis, name, { configurable: true, writable: true, value });
  }
  try {
    return await callback();
  } finally {
    for (const [name, descriptor] of originals) {
      if (descriptor) Object.defineProperty(globalThis, name, descriptor);
      else delete globalThis[name];
    }
  }
}

async function renderSearchFixture() {
  const calls = [];
  const fakeFetch = async (input, options = {}) => {
    assert.equal(options.method || 'GET', 'GET', 'Search SSR fixture must remain read-only');
    const url = new URL(input);
    calls.push(url.pathname);
    const resource = url.pathname.split('/').at(-1);
    const rows = resource === 'cards' ? [{
      slug: 'fixture-card', name: 'Fixture', name_en: 'Fixture', name_ko: '', game: 'pokemon',
      set_name: 'Fixture Set', set_code: 'FIX', number: '1', rarity_class: 'Rare', popularity_rank: 1,
    }] : [];
    return new Response(JSON.stringify(rows), { headers: { 'Content-Type': 'application/json' } });
  };

  return withGlobals({ fetch: fakeFetch }, async () => {
    const { onRequest } = await import('../functions/search.js');
    const response = await onRequest({ request: new Request(`http://${PREVIEW_HOST}:${PREVIEW_PORT}/search?q=fixture`) });
    assert.equal(response.status, 200, 'Search SSR fixture must succeed');
    assert.ok(calls.length >= 1, 'Search result route must exercise its SSR read path');
    return response.text();
  });
}

async function renderHotFixture() {
  const pending = [];
  const fakeFetch = async () => new Response('[]', { headers: { 'Content-Type': 'application/json' } });
  const fakeCaches = { default: {
    async match() { return undefined; },
    async put() {},
  } };

  return withGlobals({ fetch: fakeFetch, caches: fakeCaches }, async () => {
    const { onRequest } = await import('../functions/hot.js');
    const response = await onRequest({
      request: new Request(`http://${PREVIEW_HOST}:${PREVIEW_PORT}/hot`),
      waitUntil(promise) { pending.push(Promise.resolve(promise)); },
    });
    await Promise.all(pending);
    assert.equal(response.status, 200, 'Hot-card SSR fixture must succeed');
    return response.text();
  });
}

class FakeElement {
  constructor(tagName, attributes = {}) {
    this.tagName = tagName.toUpperCase();
    this.attributes = new Map(Object.entries(attributes));
    this.children = [];
    this.className = attributes.class || '';
    this.textContent = '';
  }

  getAttribute(name) {
    return this.attributes.has(name) ? this.attributes.get(name) : null;
  }

  setAttribute(name, value) {
    this.attributes.set(name, String(value));
  }

  appendChild(child) {
    this.children.push(child);
    return child;
  }

  querySelector(selector) {
    const matches = element => {
      if (selector === 'ins.adsbygoogle') {
        return element.tagName === 'INS' && String(element.className).split(/\s+/).includes('adsbygoogle');
      }
      if (selector === '[data-cp-ad-preview-note]') return element.attributes.has('data-cp-ad-preview-note');
      return false;
    };
    const queue = [...this.children];
    while (queue.length) {
      const element = queue.shift();
      if (matches(element)) return element;
      queue.push(...element.children);
    }
    return null;
  }
}

function adsVmFixture({
  hostname = 'cardpick.kr',
  minimumWidth = true,
  readyState = 'complete',
  placement = 'home',
  client = 'ca-pub-1234567890123456',
  slotId = '1234567890',
  slotAttributes = {},
  queue,
} = {}) {
  const wrapper = new FakeElement('aside', { class: 'cp-ad', 'data-ad-placement': placement });
  const slot = new FakeElement('ins', {
    class: 'adsbygoogle fixture-unit',
    'data-ad-client': client,
    'data-ad-slot': slotId,
    ...slotAttributes,
  });
  wrapper.appendChild(slot);
  const listeners = [];
  const document = {
    readyState,
    querySelectorAll(selector) {
      assert.equal(selector, 'aside.cp-ad[data-ad-placement]');
      return [wrapper];
    },
    querySelector() { return null; },
    createElement(tagName) { return new FakeElement(tagName); },
    addEventListener(type, callback, options) { listeners.push({ type, callback, options }); },
  };
  const window = {
    location: { hostname },
    matchMedia(query) {
      assert.equal(query, '(min-width: 320px)');
      return { matches: minimumWidth };
    },
  };
  if (queue !== undefined) window.adsbygoogle = queue;
  const context = vm.createContext({ document, window });
  const source = readUtf8('ads.js');
  const execute = () => vm.runInContext(source, context, { filename: 'ads.js' });
  execute();
  return { context, document, execute, listeners, slot, window, wrapper };
}

function safeDecodePath(rawPathname) {
  let decoded = rawPathname;
  for (let index = 0; index < 3; index += 1) {
    const next = decodeURIComponent(decoded);
    if (next === decoded) break;
    decoded = next;
  }
  if (decoded.includes('\0') || decoded.includes('\\')) return null;
  if (!decoded.startsWith('/') || decoded.startsWith('//')) return null;
  const segments = decoded.split('/').filter(Boolean);
  if (segments.some(segment => segment === '..' || segment.startsWith('.'))) return null;
  if (segments.some(segment => /^(?:private|secrets?|credentials?)$/i.test(segment))) return null;
  return { decoded, segments };
}

function publicCandidate(rawPathname) {
  const safe = safeDecodePath(rawPathname);
  if (!safe) return null;
  const { decoded, segments } = safe;
  if (decoded === '/') return path.join(ROOT, 'index.html');
  if (decoded === '/guides' || decoded === '/guides/') return { dynamic: 'guides' };
  if (!segments.length) return null;

  let relative;
  if (segments.length === 1) {
    const name = segments[0];
    const extension = path.extname(name).toLowerCase();
    if (!extension) relative = `${name}.html`;
    else if (extension === '.html' || PUBLIC_ROOT_FILES.has(name) || PUBLIC_ROOT_SCRIPTS.has(name)) relative = name;
    else return null;
  } else {
    const first = segments[0];
    if (!PUBLIC_DIRS.has(first)) return null;
    const extension = path.extname(segments.at(-1)).toLowerCase();
    if (!PUBLIC_ASSET_EXTENSIONS.has(extension)) {
      if (first === 'tools' && !extension) segments[segments.length - 1] += '.html';
      else return null;
    }
    relative = segments.join(path.sep);
  }

  const candidate = path.resolve(ROOT, relative);
  const relation = path.relative(ROOT, candidate);
  if (!relation || relation.startsWith('..') || path.isAbsolute(relation)) return null;
  return candidate;
}

function sanitizePreviewHtml(html) {
  return html.replace(/<script\b([^>]*)>([\s\S]*?)<\/script\s*>/gi, (block, rawAttributes, body) => {
    const attributes = parseAttributes(rawAttributes);
    const src = String(attributes.src || '');
    const isGoogleRuntime = /(?:pagead2\.googlesyndication\.com\/pagead\/js\/adsbygoogle\.js|googletagmanager\.com\/gtag\/js|google-analytics\.com)/i.test(src);
    const isAccountRuntime = /^\/auth\.js(?:\?|$)/i.test(src);
    const isInlineGoogleRuntime = !src && (/\bgtag\s*\(/.test(body) || /adsbygoogle[\s\S]*?\.push\s*\(/.test(body));
    if (isGoogleRuntime || isAccountRuntime || isInlineGoogleRuntime) return '<!-- omitted in read-only local preview -->';
    return block;
  });
}

function contentType(filePath) {
  const types = {
    '.avif': 'image/avif', '.css': 'text/css; charset=utf-8', '.gif': 'image/gif',
    '.html': 'text/html; charset=utf-8', '.ico': 'image/x-icon', '.jpeg': 'image/jpeg',
    '.jpg': 'image/jpeg', '.js': 'text/javascript; charset=utf-8', '.json': 'application/json; charset=utf-8',
    '.otf': 'font/otf', '.png': 'image/png', '.svg': 'image/svg+xml', '.ttf': 'font/ttf',
    '.txt': 'text/plain; charset=utf-8', '.webp': 'image/webp', '.woff': 'font/woff',
    '.woff2': 'font/woff2', '.xml': 'application/xml; charset=utf-8',
  };
  return types[path.extname(filePath).toLowerCase()] || 'application/octet-stream';
}

function sendResponse(response, statusCode, body, type = 'text/plain; charset=utf-8', method = 'GET', extraHeaders = {}) {
  const bytes = Buffer.isBuffer(body) ? body : Buffer.from(body);
  response.writeHead(statusCode, {
    'Cache-Control': 'no-store',
    'Content-Length': bytes.length,
    'Content-Type': type,
    'X-Cardpick-Preview': 'read-only',
    ...extraHeaders,
  });
  response.end(method === 'HEAD' ? undefined : bytes);
}

async function proxyReadOnlyApi(requestUrl, response) {
  const url = new URL(requestUrl, `http://${PREVIEW_HOST}:${PREVIEW_PORT}`);
  if (url.pathname === '/api/home-widgets') {
    if ([...url.searchParams].length) {
      sendResponse(response, 400, '{"error":"unsupported preview query"}', 'application/json; charset=utf-8');
      return;
    }
  } else if (url.pathname === '/api/ticker') {
    const keys = [...url.searchParams.keys()];
    const tab = url.searchParams.get('tab') || 'all';
    if (keys.some(key => key !== 'tab') || !['all', 'up', 'down', 'high'].includes(tab)) {
      sendResponse(response, 403, '{"error":"authenticated preview filters are disabled"}', 'application/json; charset=utf-8');
      return;
    }
    url.search = tab === 'all' ? '' : `?tab=${encodeURIComponent(tab)}`;
  } else {
    sendResponse(response, 404, 'Not found');
    return;
  }

  const upstream = new URL(url.pathname + url.search, 'https://cardpick.kr');
  try {
    const upstreamResponse = await fetch(upstream, {
      method: 'GET',
      headers: { Accept: 'application/json' },
      redirect: 'error',
      signal: AbortSignal.timeout(8000),
    });
    const text = await upstreamResponse.text();
    if (text.length > 1_000_000) throw new Error('preview_response_too_large');
    const json = JSON.parse(text);
    sendResponse(response, upstreamResponse.ok ? 200 : 502, JSON.stringify(json), 'application/json; charset=utf-8');
  } catch {
    sendResponse(response, 502, '{"error":"read-only preview data unavailable"}', 'application/json; charset=utf-8');
  }
}

async function serveRequest(request, response, rootRealPath) {
  const method = request.method || 'GET';
  const requestUrl = new URL(request.url || '/', `http://${PREVIEW_HOST}:${PREVIEW_PORT}`);
  if (requestUrl.pathname.startsWith('/api/')) {
    if (method !== 'GET') {
      sendResponse(response, 405, 'Method not allowed', 'text/plain; charset=utf-8', method, { Allow: 'GET' });
      return;
    }
    await proxyReadOnlyApi(request.url || '/', response);
    return;
  }
  if (method !== 'GET' && method !== 'HEAD') {
    sendResponse(response, 405, 'Method not allowed', 'text/plain; charset=utf-8', method, { Allow: 'GET, HEAD' });
    return;
  }

  let candidate;
  try {
    candidate = publicCandidate(requestUrl.pathname);
  } catch {
    candidate = null;
  }
  if (!candidate) {
    sendResponse(response, 404, 'Not found', 'text/plain; charset=utf-8', method);
    return;
  }

  if (candidate.dynamic === 'guides') {
    const html = sanitizePreviewHtml(await renderGuideHub());
    sendResponse(response, 200, html, 'text/html; charset=utf-8', method);
    return;
  }

  try {
    const [candidateRealPath, details] = await Promise.all([realpath(candidate), stat(candidate)]);
    const relation = path.relative(rootRealPath, candidateRealPath);
    if (!details.isFile() || relation.startsWith('..') || path.isAbsolute(relation)) throw new Error('outside_public_root');
    let bytes = await readFile(candidateRealPath);
    const type = contentType(candidateRealPath);
    if (type.startsWith('text/html')) bytes = Buffer.from(sanitizePreviewHtml(bytes.toString('utf8')));
    sendResponse(response, 200, bytes, type, method);
  } catch {
    sendResponse(response, 404, 'Not found', 'text/plain; charset=utf-8', method);
  }
}

async function startPreviewServer() {
  const rootRealPath = await realpath(ROOT);
  const server = createServer((request, response) => {
    serveRequest(request, response, rootRealPath).catch(() => {
      if (!response.headersSent) sendResponse(response, 500, 'Preview error');
      else response.destroy();
    });
  });
  server.on('clientError', (_error, socket) => socket.end('HTTP/1.1 400 Bad Request\r\n\r\n'));
  server.on('error', error => {
    console.error(`Read-only preview failed: ${error.code || 'server_error'}`);
    process.exitCode = 1;
  });
  server.listen(PREVIEW_PORT, PREVIEW_HOST, () => {
    console.log(`Cardpick read-only preview: http://${PREVIEW_HOST}:${PREVIEW_PORT}`);
  });
  let closing = false;
  const close = () => {
    if (closing) process.exit(0);
    closing = true;
    server.close(() => process.exit(0));
    server.closeAllConnections?.();
  };
  process.once('SIGINT', close);
  process.once('SIGTERM', close);
}

function registerTests() {
  test('only the approved ad and performance files differ; pre-existing dirty work remains out of scope', () => {
    const changed = changedPaths();
    const unexpected = changed.filter(file => !APPROVED_FILES.has(file) && !PRESERVED_DIRTY_PATHS.has(file));
    assert.ok(unexpected.length === 0, `Unexpected ad-rollout paths: ${unexpected.join(', ')}`);
  });

  test('the eight existing source files differ from the immutable base only by approved ads, resources, mobile fix and cache keys', () => {
    for (const file of AD_SOURCE_FILES) {
      const head = gitOutput(['show', `${BASE_SHA}:${file}`]);
      const current = readUtf8(file);
      assert.ok(
        normalizeApprovedSource(file, current) === normalizeApprovedSource(file, head),
        `${file}: unapproved source drift detected`,
      );
    }
  });

  test('approved mobile and cache migrations reject changed, duplicate, moved or unrelated source', () => {
    const sameAsHead = (file, source) => normalizeApprovedSource(file, source) ===
      normalizeApprovedSource(file, gitOutput(['show', `${BASE_SHA}:${file}`]));
    for (const file of ['guide-grading-proxy.html', 'guide-what-is-tcg.html']) {
      const source = readUtf8(file).replace(/\r\n?/g, '\n');
      const rule = '    main figure.-mx-5 { margin-left: -16px; margin-right: -16px }\n';
      assert.equal(source.split(rule).length - 1, 1, `${file}: reviewed fix must be present once`);
      assert.ok(source.indexOf(rule) > source.indexOf('@media (max-width: 720px)'), 'Fix stays mobile-only');
      for (const changed of [
        source.replace(rule, rule.replace('-16px', '-20px')),
        source.replace(rule, rule.replace('figure.-mx-5', 'figure')),
        source.replace(rule, rule + rule),
        source.replace(rule, '') + rule,
        source.replace('<h1 ', '<h1 data-unapproved="true" '),
      ]) {
        let rejected = false;
        try { rejected = !sameAsHead(file, changed); } catch { rejected = true; }
        assert.ok(rejected, `${file}: unapproved mutation must fail`);
      }
    }
    for (const [file, key] of [
      ['functions/_middleware.js', '__home_ssr_v12_manual_ads_fonts'],
      ['functions/hot.js', '__hot_ssr_v4_no_ads'],
    ]) {
      const source = readUtf8(file);
      assert.equal(source.split(key).length - 1, 1, `${file}: new cache version must be present once`);
      for (const changed of [source.replace(key, key + '_other'), source + '\n' + source,
        source.replace('edgeCache.match(cacheKey)', 'edgeCache.match(request)')]) {
        let rejected = false;
        try { rejected = !sameAsHead(file, changed); } catch { rejected = true; }
        assert.ok(rejected, `${file}: unapproved mutation must fail`);
      }
    }
  });

  test('performance normalization rejects changed, duplicated, moved and injected resource or content mutations', () => {
    for (const [file, { original, replacement, endHeadStylesheet }] of Object.entries(PERFORMANCE_RESOURCES)) {
      const source = readUtf8(file).replace(/\r\n?/g, '\n');
      const baseline = normalizeApprovedSource(file, gitOutput(['show', `${BASE_SHA}:${file}`]));
      assert.equal(source.split(replacement).length - 1, 1,
        `${file}: the approved performance block must be present once`);
      assert.equal(source.split(original).length - 1, 0,
        `${file}: the replaced render-blocking block must not remain`);
      const mutations = [
        source.replace(replacement, replacement.replace('this.media=\'all\'', 'this.media=\'screen\'')),
        source.replace(replacement, replacement.replace('media="print"', 'media="all"')),
        source.replace(replacement, replacement.replace('<noscript>', '<noscript data-unapproved="true">')),
        source.replace(replacement, replacement + '\n' + replacement),
        source.replace(replacement, '').replace('<title>', replacement + '\n<title>'),
        source.replace(replacement, '').replace('</body>', replacement + '\n</body>'),
        source.replace('</body>', replacement + '\n</body>'),
        source.replace('</head>', '<meta name="unapproved" content="mutation">\n</head>'),
        source.replace('</body>', '<p>Unapproved body mutation</p>\n</body>'),
      ];
      if (endHeadStylesheet) {
        mutations.push(
          source.replace('base.css?v=20261011', 'base.css?v=unreviewed'),
          source.replace(endHeadStylesheet, endHeadStylesheet + '\n' + endHeadStylesheet),
          source.replace(endHeadStylesheet, '').replace('<style>', endHeadStylesheet + '\n<style>'),
          source.replace(endHeadStylesheet, '').replace('</body>', endHeadStylesheet + '\n</body>'),
          source.replace(endHeadStylesheet, ''),
          source.replace(endHeadStylesheet, endHeadStylesheet.replace('rel="stylesheet"', 'rel="stylesheet" media="print"')),
          source.replace('</body>', endHeadStylesheet + '\n</body>'),
        );
      }
      for (const mutation of mutations) {
        let rejected = false;
        try { rejected = normalizeApprovedSource(file, mutation) !== baseline; } catch { rejected = true; }
        assert.ok(rejected, `${file}: an unapproved performance mutation must fail`);
      }
    }
  });

  test('five pages have one labeled manual unit in a safe content position', async () => {
    const slotsByPlacement = new Map();
    const clients = new Set();
    let total = 0;

    for (const target of TARGET_PAGES) {
      const html = await targetHtml(target);
      assert.equal(occurrences(html, /<script\b[^>]*\bsrc=["']https:\/\/pagead2\.googlesyndication\.com\/pagead\/js\/adsbygoogle\.js\?[^"']*["'][^>]*>/gi), 1,
        `${target.name}: expected one official loader`);
      assert.equal(occurrences(html, /<script\b[^>]*\bsrc=["']\/ads\.js(?:\?[^"']*)?["'][^>]*>/gi), 1,
        `${target.name}: expected one local ad initializer`);
      assert.equal(occurrences(html, /<link\b[^>]*\bhref=["']\/styles\/ads\.css(?:\?[^"']*)?["'][^>]*>/gi), 1,
        `${target.name}: expected one ad stylesheet`);
      assert.doesNotMatch(html, /\bdata-ad-format\s*=|\bdata-full-width-responsive\s*=/i,
        `${target.name}: automatic/full-width unit attributes are not approved`);

      const nodes = walk(parseHtmlTree(html));
      const ads = nodes.filter(node => node.tag === 'aside' && hasClass(node, 'cp-ad'));
      assert.equal(ads.length, 1, `${target.name}: expected exactly one manual unit`);
      const ad = ads[0];
      assert.equal(ad.attrs['data-ad-placement'], target.placement, `${target.name}: incorrect placement name`);
      assert.equal(ad.attrs['aria-label'], '광고', `${target.name}: neutral aria-label is required`);
      assertSafePlacement(target.name, html, ad);

      const units = descendants(ad).filter(node => node.tag === 'ins' && hasClass(node, 'adsbygoogle'));
      assert.equal(units.length, 1, `${target.name}: expected exactly one ins.adsbygoogle`);
      const unit = units[0];
      assert.match(unit.attrs['data-ad-client'] || '', /^ca-pub-\d+$/, `${target.name}: configured client is required`);
      assert.match(unit.attrs['data-ad-slot'] || '', /^\d+$/, `${target.name}: configured slot is required`);
      clients.add(unit.attrs['data-ad-client']);
      const existing = slotsByPlacement.get(target.placement);
      if (existing === undefined) slotsByPlacement.set(target.placement, unit.attrs['data-ad-slot']);
      else assert.equal(unit.attrs['data-ad-slot'], existing, `${target.name}: placement must reuse its reviewed slot`);

      const loaderClient = html.match(/pagead\/js\/adsbygoogle\.js\?client=(ca-pub-\d+)/i)?.[1];
      assert.ok(loaderClient === unit.attrs['data-ad-client'], `${target.name}: loader and unit publisher must match`);
      assertResponsiveContract(target.name, html);
      total += ads.length;
    }

    assert.equal(total, 5, 'The approved rollout contains five total units');
    assert.equal(clients.size, 1, 'All units use one publisher without exposing it in test output');
    assert.equal(slotsByPlacement.size, 3, 'home, guide hub, and guide body use three reviewed slots');
  });

  test('/hot and /search SSR render without any ad loader or manual unit', async () => {
    for (const [name, html] of [['hot', await renderHotFixture()], ['search', await renderSearchFixture()]]) {
      assert.doesNotMatch(html, /pagead\/js\/adsbygoogle\.js|<aside\b[^>]*\bcp-ad\b|<ins\b[^>]*\badsbygoogle\b|\/ads\.js/i,
        `${name}: ads must remain disabled`);
    }
  });

  test('shared ad CSS reserves the wrapper and never collapses no-fill content', () => {
    const css = readUtf8('styles/ads.css');
    assert.match(css, /\.cp-ad\s*\{[\s\S]*?(?:^|[;{])\s*display\s*:\s*none\s*[;}]/im);
    const min320 = mediaBlocks(css).find(block => block.query.includes('min-width:320px'));
    assert.ok(min320, 'Shared CSS must reveal units from 320px');
    assert.match(min320.body, /\.cp-ad\s*\{[^}]*\bdisplay\s*:\s*grid\s*[;}]/i);
    assert.doesNotMatch(css, /data-ad-status|adsbygoogle-status|:empty|height\s*:\s*0(?:\D|$)|max-height\s*:\s*0(?:\D|$)/i,
      'No-fill styles must not collapse the reserved area');
  });

  test('ads.js requests one production unit once and blocks duplicate/status retries', () => {
    const queue = [];
    const fixture = adsVmFixture({ queue });
    assert.equal(queue.length, 1);
    assert.equal(fixture.slot.getAttribute('data-cp-ad-requested'), 'true');
    assert.equal(fixture.wrapper.getAttribute('data-cp-ad-state'), 'requested');
    fixture.execute();
    assert.equal(queue.length, 1, 'Global guard blocks a second initialization');

    for (const statusAttributes of [
      { 'data-cp-ad-requested': 'true' },
      { 'data-adsbygoogle-status': 'done' },
      { 'data-ad-status': 'unfilled' },
    ]) {
      const existingQueue = [];
      adsVmFixture({ queue: existingQueue, slotAttributes: statusAttributes });
      assert.equal(existingQueue.length, 0, 'Already handled or unfilled units must not be requested again');
    }
  });

  test('ads.js never requests on local, IP, preview, lookalike, port-like, or sub-320 hosts', () => {
    for (const hostname of ['localhost', '127.0.0.1', '::1', 'preview.cardpick.kr', 'cardpick.kr.example', 'cardpick.kr:443']) {
      const queue = [];
      const fixture = adsVmFixture({ hostname, queue });
      assert.equal(queue.length, 0, 'Non-production hosts must never request ads');
      assert.equal(fixture.wrapper.getAttribute('data-cp-ad-state'), 'preview');
      assert.ok(fixture.wrapper.querySelector('[data-cp-ad-preview-note]'));
      fixture.execute();
      assert.equal(fixture.wrapper.children.filter(child => child.attributes.has('data-cp-ad-preview-note')).length, 1,
        'Preview note must not duplicate');
    }

    const narrowQueue = [];
    const narrow = adsVmFixture({ hostname: 'cardpick.kr', minimumWidth: false, queue: narrowQueue });
    assert.equal(narrowQueue.length, 0);
    assert.equal(narrow.wrapper.getAttribute('data-cp-ad-state'), 'too-narrow');

    for (const hostname of ['cardpick.kr', 'www.cardpick.kr', 'CARDPICK.KR']) {
      const queue = [];
      adsVmFixture({ hostname, queue });
      assert.equal(queue.length, 1, 'Only the two exact production hostnames may request ads');
    }
  });

  test('ads.js validates configuration, preserves failure state, and initializes after DOMContentLoaded', () => {
    for (const options of [
      { client: 'publisher-fixture' },
      { slotId: 'slot-fixture' },
      { placement: 'unknown' },
    ]) {
      const queue = [];
      const fixture = adsVmFixture({ ...options, queue });
      assert.equal(queue.length, 0);
      if (options.placement !== 'unknown') assert.equal(fixture.wrapper.getAttribute('data-cp-ad-state'), 'unconfigured');
    }

    const throwingQueue = { push() { throw new Error('fixture failure'); } };
    const failed = adsVmFixture({ queue: throwingQueue });
    assert.equal(failed.wrapper.getAttribute('data-cp-ad-state'), 'unavailable');
    assert.equal(failed.slot.getAttribute('data-cp-ad-requested'), 'true', 'Failure remains marked to prevent refresh/retry');

    const deferredQueue = [];
    const deferred = adsVmFixture({ readyState: 'loading', queue: deferredQueue });
    assert.equal(deferredQueue.length, 0);
    assert.equal(deferred.listeners.length, 1);
    assert.equal(deferred.listeners[0].type, 'DOMContentLoaded');
    assert.equal(deferred.listeners[0].options.once, true);
    deferred.listeners[0].callback();
    deferred.listeners[0].callback();
    assert.equal(deferredQueue.length, 1, 'Slot marker blocks repeat calls even in a synthetic fixture');
  });

  test('ads.js contains no loader injection, lazy observer, timer, resize refresh, or no-fill collapse', () => {
    const source = readUtf8('ads.js');
    assert.doesNotMatch(source, /createElement\s*\(\s*['"]script['"]|MutationObserver|ResizeObserver|IntersectionObserver|setInterval|setTimeout|requestAnimationFrame/i);
    assert.doesNotMatch(source, /addEventListener\s*\(\s*['"]resize['"]|\.remove\s*\(|style\.display\s*=|height\s*=\s*['"]?0/i);
    assert.equal(occurrences(source, /\.push\s*\(\s*\{\s*\}\s*\)/g), 1, 'Initializer has one reviewed push site');
  });

  test('read-only preview sanitizes remote ad, analytics, and account runtimes but keeps /ads.js', () => {
    const sample = `<script async src="https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=fixture"></script>
      <script async src="https://www.googletagmanager.com/gtag/js?id=fixture"></script>
      <script>function gtag(){}</script><script src="/auth.js?v=fixture"></script><script defer src="/ads.js?v=fixture"></script>`;
    const sanitized = sanitizePreviewHtml(sample);
    assert.doesNotMatch(sanitized, /pagead2\.googlesyndication|googletagmanager|function gtag|\/auth\.js/i);
    assert.match(sanitized, /\/ads\.js\?v=fixture/);
  });

  test('read-only preview path resolver exposes only public files and blocks traversal/private trees', () => {
    for (const pathname of ['/', '/guide-pikachu-cards', '/styles/ads.css', '/ads.js', '/images/logo.png', '/tools/grading-cost-compare']) {
      assert.ok(publicCandidate(pathname), `Expected public preview path: ${pathname}`);
    }
    for (const pathname of [
      '/.env', '/.git/config', '/.wrangler/state', '/functions/search.js', '/scripts/verify-ad-layout.mjs',
      '/docs/internal.html', '/data/private.json', '/node_modules/pkg/index.js', '/AGENTS.md', '/wrangler.toml',
      '/%2e%2e/.env', '/styles/%2e%2e/functions/search.js', '/styles/%252e%252e/functions/search.js',
      '/styles%2f..%2ffunctions%2fsearch.js', '/private/anything.html',
    ]) {
      assert.equal(publicCandidate(pathname), null, `Blocked preview path resolved: ${pathname}`);
    }
  });
}

if (SERVE_MODE) await startPreviewServer();
else registerTests();
