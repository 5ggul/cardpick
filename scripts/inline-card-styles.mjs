// npx --offline --yes --package=tailwindcss@3.4.17 tailwindcss -c scripts/card-tailwind.config.cjs -i styles/guides.input.css -o styles/card-base.css --minify
// node scripts/inline-card-styles.mjs
import { readFile, writeFile } from 'node:fs/promises';
import { pageFontCss } from './page-font-css.mjs';
const root = new URL('../', import.meta.url);
const page = new URL('card-detail.html', root);
const cssFile = new URL('styles/card-base.css', root);
const html = await readFile(page, 'utf8');
// Keep shared font source intact; cards opt out of late font swaps that move the price hero.
const css = (await readFile(cssFile, 'utf8')).trim().replace(/font-display:swap/g, 'font-display:optional');
if (!css.includes('tailwindcss v3.4.17') || /<\/style/i.test(css)) throw new Error('Invalid compiled CSS');
const target = /<style id="card-base-css">[\s\S]*?<\/style>/g;
if ([...html.matchAll(target)].length !== 1) throw new Error('Expected one card stylesheet slot');
const fontCss = pageFontCss(await readFile(new URL('styles/releases-fonts.css', root), 'utf8'),
  await readFile(new URL('styles/card-text-font.css', root), 'utf8'));
const fontTarget = /<style id="card-font-css">[\s\S]*?<\/style>/g;
if ([...html.matchAll(fontTarget)].length !== 1 || /<\/style/i.test(fontCss)) throw new Error('Invalid card font slot');
const updated = html.replace(target, () => `<style id="card-base-css">${css}</style>`)
  .replace(fontTarget, () => `<style id="card-font-css">${fontCss}</style>`);
await writeFile(cssFile, css + '\n', 'utf8');
if (updated !== html) await writeFile(page, updated, 'utf8');
console.log('Card styles synchronized; late font swaps disabled.');
