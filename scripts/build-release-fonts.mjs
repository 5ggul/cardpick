// One-time/reproducible CSS preparation. Does not run in the browser or daily calendar job.
// The font binaries remain unmodified at their pinned upstream URLs.
import { writeFile } from 'node:fs/promises';
const source = 'https://cdn.jsdelivr.net/gh/orioncactus/pretendard@v1.3.9/dist/web/variable/pretendardvariable-dynamic-subset.css';
const response = await fetch(source);
if (!response.ok) throw new Error(`Font stylesheet HTTP ${response.status}`);
const upstream = await response.text();
if (!upstream.includes("font-family: 'Pretendard Variable'") || !upstream.includes('unicode-range:')) {
  throw new Error('Unexpected upstream font stylesheet');
}
const css = upstream
  .replaceAll("font-family: 'Pretendard Variable'", "font-family: 'Pretendard'")
  .replaceAll('font-display: swap', 'font-display: optional')
  .replace(/url\(([^)]+)\)/g, (_, path) => `url(${new URL(path, source).href})`);
await writeFile(new URL('../styles/releases-fonts.css', import.meta.url),
  `/* Source: ${source}\n * CSS family alias only; unmodified Pretendard font binaries, SIL OFL 1.1.\n * Optional prevents late font swaps on slow first visits; cached fonts keep the existing face.\n */\n${css}`, 'utf8');
console.log('Prepared release font declarations; upstream font binaries unchanged.');
