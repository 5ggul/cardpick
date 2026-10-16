// Three approved guide consumers only. Reuse the existing price-guide theme and
// shared licensed CSS/font inputs without regenerating or modifying that page.
// node scripts/growth-guides-tailwind.config.cjs --build <tailwindcss-3.4.17/lib/cli.js>
const price = require('./card-price-tailwind.config.cjs');
const pages = ['guide-psa-turnaround.html', 'guide-brg-grading.html', 'guide-card-rarities.html'];
module.exports = {
  content: {
    files: pages.map(page => './' + page),
    transform: { html: source => source.replace(/<style id="growth-guides-(?:font|base)-css">[\s\S]*?<\/style>/g, '') },
  },
  theme: price.theme,
};

function assertHeadSlots(page, html) {
  const font = /<style id="growth-guides-font-css">[\s\S]*?<\/style>/g;
  const base = /<style id="growth-guides-base-css">[\s\S]*?<\/style>/g;
  const headOpen = html.indexOf('<head>'), headClose = html.indexOf('</head>');
  const fontIndex = html.indexOf('<style id="growth-guides-font-css">');
  const baseIndex = html.indexOf('<style id="growth-guides-base-css">');
  const anchor = '<link rel="preconnect" href="https://cdn.jsdelivr.net" crossorigin>';
  if ((html.match(/<head\b[^>]*>/gi) || []).length !== 1 ||
      (html.match(/<\/head\s*>/gi) || []).length !== 1 ||
      [...html.matchAll(font)].length !== 1 || [...html.matchAll(base)].length !== 1 ||
      (html.match(/id="growth-guides-font-css"/g) || []).length !== 1 ||
      (html.match(/id="growth-guides-base-css"/g) || []).length !== 1 ||
      !(headOpen < fontIndex && fontIndex < baseIndex && baseIndex < headClose) ||
      !(html.slice(0, fontIndex).endsWith(anchor + '\n') || html.slice(0, fontIndex).endsWith(anchor + '\r\n')) ||
      !html.match(/<style id="growth-guides-base-css">[\s\S]*?<\/style>\r?\n<\/head>/)) {
    throw new Error('Expected unique, ordered font/base slots at their exact head anchors in ' + page);
  }
}
// Non-enumerable: available to negative-fixture tests, not a Tailwind option.
Object.defineProperty(module.exports, 'assertHeadSlots', {value:assertHeadSlots});

async function build() {
  const { readFileSync, writeFileSync } = require('node:fs');
  const { resolve, dirname } = require('node:path');
  const { spawnSync } = require('node:child_process');
  const args = process.argv.slice(2);
  if (args.length !== 2 || args[0] !== '--build') {
    throw new Error('Usage: node scripts/growth-guides-tailwind.config.cjs --build <tailwindcss-3.4.17/lib/cli.js>');
  }
  const cli = resolve(args[1]);
  const pkg = JSON.parse(readFileSync(resolve(dirname(cli), '../package.json'), 'utf8'));
  if (pkg.name !== 'tailwindcss' || pkg.version !== '3.4.17') throw new Error('Expected pinned Tailwind CSS 3.4.17');
  const root = resolve(__dirname, '..');
  const fontSlot = /<style id="growth-guides-font-css">[\s\S]*?<\/style>/g;
  const baseSlot = /<style id="growth-guides-base-css">[\s\S]*?<\/style>/g;
  const inputs = pages.map(page => ({page, html: readFileSync(resolve(root, page), 'utf8')}));
  for (const {page, html} of inputs) assertHeadSlots(page, html);
  const { pageFontCss } = await import('./page-font-css.mjs');
  const subset = readFileSync(resolve(root, 'styles/growth-guides-text-font.css'), 'utf8');
  const fontPath = subset.match(/src:url\(\/fonts\/cardpick-text\/growth-guides\.woff2\?v=([a-f0-9]{12})\)/);
  const { createHash } = require('node:crypto');
  const binary = readFileSync(resolve(root, 'fonts/cardpick-text/growth-guides.woff2'));
  if (!fontPath || createHash('sha256').update(binary).digest('hex').slice(0, 12) !== fontPath[1]) {
    throw new Error('Expected the content-revisioned growth-guide subset');
  }
  const fonts = pageFontCss(readFileSync(resolve(root, 'styles/releases-fonts.css'), 'utf8'), subset);
  if (fonts.includes('</style') || !fonts.includes("font-family: 'Cardpick Text'") || !fonts.includes('font-display:optional')) {
    throw new Error('Unexpected disjoint font stylesheet');
  }
  const output = resolve(root, 'styles/growth-guides-base.css');
  const result = spawnSync(process.execPath, [cli, '-c', __filename, '-i', 'styles/guides.input.css', '-o', output, '--minify'], {cwd:root, encoding:'utf8'});
  if (result.status !== 0) throw new Error(result.stderr || result.error?.message || 'CSS build failed');
  // Preserve all 15 original Mono faces; only opt out of late swaps for these pages.
  const css = readFileSync(output, 'utf8').replace(/font-display:swap/g, 'font-display:optional');
  if (!css.includes('tailwindcss v3.4.17') || css.includes('</style') || css.includes('font-display:swap') ||
      (css.match(/@font-face\{/g) || []).length !== 15) throw new Error('Unexpected compiled guide stylesheet');
  const updated = inputs.map(({page, html}) => {
    const next = html.replace(fontSlot, () => '<style id="growth-guides-font-css">' + fonts + '</style>')
      .replace(baseSlot, () => '<style id="growth-guides-base-css">' + css + '</style>');
    if (next.slice(next.indexOf('</head>')) !== html.slice(html.indexOf('</head>'))) throw new Error('Guide body changed: ' + page);
    return {page, html:next};
  });
  writeFileSync(output, css, 'utf8');
  for (const {page, html} of updated) writeFileSync(resolve(root, page), html, 'utf8');
  console.log('Three growth-guide head assets synchronized; bodies and shared inputs unchanged.');
}
if (require.main === module) build().catch(error => { console.error(error.message); process.exitCode = 1; });
