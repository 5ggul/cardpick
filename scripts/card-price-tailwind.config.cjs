// Page-owned build. The shared input and all other consuming pages are read-only.
// Rebuild: node scripts/card-price-tailwind.config.cjs --build <tailwindcss-3.4.17/lib/cli.js>
// Same-outline page subset; the full pinned upstream ranges remain a disjoint fallback.
module.exports = {
  content: {
    files: ['./guide-card-price.html'],
    // Do not treat yesterday's generated stylesheet as today's utility content.
    transform: { html: source => source.replace(/<style id="price-(?:font|base)-css">[\s\S]*?<\/style>/g, '') },
  },
  theme: {
    extend: {
      colors: {
        bg: '#05080D', panel: '#0D121B', panel2: '#111722',
        line: 'rgba(255,255,255,0.08)', ink: '#E8EDF5', muted: '#8B96A8',
        up: '#26E0C2', down: '#FF4D6D', brand: '#26E0C2', warn: '#E0B84A',
      },
      fontFamily: {
        sans: ['"Cardpick Text"', 'Pretendard', 'system-ui', 'sans-serif'],
        mono: ['"IBM Plex Mono"', 'ui-monospace', 'monospace'],
      },
    },
  },
};

async function buildPrice() {
  const { readFileSync, writeFileSync } = require('node:fs');
  const { resolve, dirname } = require('node:path');
  const { spawnSync } = require('node:child_process');
  const args = process.argv.slice(2);
  if (args.length !== 2 || args[0] !== '--build') {
    throw new Error('Usage: node scripts/card-price-tailwind.config.cjs --build <tailwindcss-3.4.17/lib/cli.js>');
  }
  const cli = resolve(args[1]);
  const pkg = JSON.parse(readFileSync(resolve(dirname(cli), '../package.json'), 'utf8'));
  if (pkg.name !== 'tailwindcss' || pkg.version !== '3.4.17') throw new Error('Expected pinned Tailwind CSS 3.4.17');
  const root = resolve(__dirname, '..');
  const output = resolve(root, 'styles/card-price-base.css');
  const htmlPath = resolve(root, 'guide-card-price.html');
  const html = readFileSync(htmlPath, 'utf8');
  const fontSlot = /<style id="price-font-css">[\s\S]*?<\/style>/g;
  const baseSlot = /<style id="price-base-css">[\s\S]*?<\/style>/g;
  if ([...html.matchAll(fontSlot)].length !== 1 || [...html.matchAll(baseSlot)].length !== 1) {
    throw new Error('Expected one exact price-only generated font/CSS slot');
  }
  const result = spawnSync(process.execPath, [cli, '-c', __filename, '-i', 'styles/guides.input.css',
    '-o', output, '--minify'], { cwd: root, encoding: 'utf8' });
  if (result.status !== 0) throw new Error(result.stderr || result.error?.message || 'CSS build failed');
  // Keep licensed, unmodified local Mono files; avoid a late swap on a slow visit.
  const css = readFileSync(output, 'utf8').replace(/font-display:swap/g, 'font-display:optional');
  if (!css.includes('tailwindcss v3.4.17') || css.includes('</style') || css.includes('font-display:swap')) {
    throw new Error('Unexpected generated stylesheet');
  }
  writeFileSync(output, css, 'utf8');
  const { pageFontCss } = await import('./page-font-css.mjs');
  const fonts = pageFontCss(readFileSync(resolve(root, 'styles/releases-fonts.css'), 'utf8'),
    readFileSync(resolve(root, 'styles/price-text-font.css'), 'utf8'));
  if (fonts.includes('</style')) throw new Error('Unexpected font stylesheet');
  const updated = html.replace(fontSlot, () => '<style id="price-font-css">' + fonts + '</style>')
    .replace(baseSlot, () => '<style id="price-base-css">' + css + '</style>');
  if (updated.slice(updated.indexOf('</head>')) !== html.slice(html.indexOf('</head>'))) {
    throw new Error('Price guide body changed during resource synchronization');
  }
  writeFileSync(htmlPath, updated, 'utf8');
  console.log('Price-guide font/CSS synchronized; article body, shared inputs and other page assets unchanged.');
}
if (require.main === module) buildPrice().catch(error => { console.error(error.message); process.exitCode = 1; });
