// Explicit page-only build: no network and no changes to shared font/CSS inputs.
import { readFile, writeFile } from 'node:fs/promises';
import { pageFontCss } from './page-font-css.mjs';
const root = new URL('../', import.meta.url);
const args = process.argv.slice(2);
if (args.length !== 2 || args[0] !== '--page' || !['home', 'releases'].includes(args[1])) {
  throw new Error('Usage: node scripts/inline-release-styles.mjs --page home|releases');
}
const name = args[1];
const page = new URL(name === 'home' ? 'index.html' : 'releases.html', root);
const html = await readFile(page, 'utf8');
let css;
let updated = html;
if (name === 'releases') {
  // Shared guides.input.css remains unchanged; only this generated page opts out
  // of late Mono swaps. The same transform is used by the existing card build.
  css = (await readFile(new URL('styles/releases-base.css', root), 'utf8')).trim()
    .replace(/font-display:swap/g, 'font-display:optional');
  if (!css.includes('tailwindcss v3.4.17') || /<\/style/i.test(css)) throw new Error('Invalid compiled CSS');
  const target = /<style id="release-base-css">[\s\S]*?<\/style>/g;
  if ([...html.matchAll(target)].length !== 1) throw new Error('Expected one release stylesheet slot');
  updated = updated.replace(target, () => `<style id="release-base-css">${css}</style>`);
}
let fonts = pageFontCss(await readFile(new URL('styles/releases-fonts.css', root), 'utf8'),
  await readFile(new URL(`styles/${name}-text-font.css`, root), 'utf8'));
if (name === 'home') fonts += '\n' + (await readFile(new URL('styles/set-fonts.css', root), 'utf8')).trim();
// Auth/search intentionally retain their shared code and inline family chains.
// Keep their original glyph outlines through these page-owned family aliases.
fonts += '\n#cp-user-menu,#cp-search-results,#cp-nick-modal>div,#cp-nick-modal input{font-family:'
  + (name === 'home' ? 'var(--sans)' : "'Cardpick Text',Pretendard,system-ui,sans-serif") + '!important}';
if (/<\/style/i.test(fonts)) throw new Error('Invalid page font declarations');
const fontTarget = new RegExp(`<style id="${name}-font-css">[\\s\\S]*?<\\/style>`, 'g');
const fontSlots = [...updated.matchAll(fontTarget)];
if (fontSlots.length !== 1 || fontSlots[0].index > updated.indexOf('</head>')) throw new Error('Expected one head font slot');
updated = updated.replace(fontTarget, () => `<style id="${name}-font-css">${fonts}</style>`);
// All validation above completes before touching either approved output.
if (name === 'releases') await writeFile(new URL('styles/releases-base.css', root), css + '\n', 'utf8');
if (updated !== html) await writeFile(page, updated, 'utf8');
console.log(`${name} page styles synchronized; original font outlines and complete fallback retained.`);
