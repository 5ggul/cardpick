// Run after compiling releases-base.css. Retain the standalone file for reproducible tests.
import { readFile, writeFile } from 'node:fs/promises';
const root = new URL('../', import.meta.url);
const page = new URL('releases.html', root);
const html = await readFile(page, 'utf8');
const css = (await readFile(new URL('styles/releases-base.css', root), 'utf8')).trim();
if (!css.includes('tailwindcss v3.4.17') || /<\/style/i.test(css)) throw new Error('Invalid compiled CSS');
const target = /<style id="release-base-css">[\s\S]*?<\/style>|<link rel="stylesheet" href="\/styles\/releases-base\.css\?v=20261001">/g;
if ([...html.matchAll(target)].length !== 1) throw new Error('Expected one release stylesheet slot');
const updated = html.replace(target, () => `<style id="release-base-css">${css}</style>`);
if (updated !== html) await writeFile(page, updated, 'utf8');
console.log('Release base styles synchronized.');
