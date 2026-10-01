// Compile cgc-base.css with cgc-tailwind.config.cjs and styles/guides.input.css first.
import { readFile, writeFile } from 'node:fs/promises';
import { pageFontCss } from './page-font-css.mjs';
const root = new URL('../', import.meta.url);
const page = new URL('guide-cgc-grading.html', root);
const cssFile = new URL('styles/cgc-base.css', root);
const html = await readFile(page, 'utf8');
const css = (await readFile(cssFile, 'utf8')).trim().replace(/font-display:swap/g, 'font-display:optional');
const fonts = pageFontCss(await readFile(new URL('styles/releases-fonts.css', root), 'utf8'),
  await readFile(new URL('styles/cgc-text-font.css', root), 'utf8'));
if (!css.includes('tailwindcss v3.4.17') || /<\/style/i.test(css + fonts)) throw new Error('Invalid stylesheet');
let updated = html;
for (const [id, content] of [['base', css], ['font', fonts]]) {
  const target = new RegExp(`<style id="cgc-${id}-css">[\\s\\S]*?<\\/style>`, 'g');
  if ([...updated.matchAll(target)].length !== 1) throw new Error(`Expected one ${id} stylesheet slot`);
  updated = updated.replace(target, () => `<style id="cgc-${id}-css">${content}</style>`);
}
await writeFile(cssFile, css + '\n', 'utf8');
if (updated !== html) await writeFile(page, updated, 'utf8');
console.log('CGC styles synchronized; no runtime CSS generation or late font swaps.');
