// Build disjoint font ranges: never download upstream glyphs already in the local subset.
export function parseRanges(value) {
  const values = new Set();
  for (const item of value.split(',')) {
    const [start, end = start] = item.trim().replace(/^U\+/i, '').split('-').map(x => parseInt(x, 16));
    if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) throw new Error('Invalid font range');
    for (let n = start; n <= end; n++) values.add(n);
  }
  return values;
}

function formatRanges(values) {
  const codes = [...values].sort((a, b) => a - b);
  const ranges = [];
  for (let i = 0; i < codes.length; i++) {
    const start = codes[i];
    while (i + 1 < codes.length && codes[i + 1] === codes[i] + 1) i++;
    ranges.push('U+' + start.toString(16) + (codes[i] === start ? '' : '-' + codes[i].toString(16)));
  }
  return ranges.join(',');
}

export function pageFontCss(upstream, subset) {
  upstream = upstream.replace(/\r\n/g, '\n');
  subset = subset.replace(/\r\n/g, '\n');
  const covered = parseRanges(subset.match(/unicode-range:([^;}]+)/)[1]);
  const fallback = upstream.trim().replaceAll("font-family: 'Pretendard'", "font-family: 'Cardpick Text'")
    .replace(/@font-face\s*\{[^}]+\}/g, face => {
      const original = face.match(/unicode-range:\s*([^;}]+)/)[1];
      const remaining = [...parseRanges(original)].filter(code => !covered.has(code));
      return remaining.length ? face.replace(original, formatRanges(remaining)) : '';
    });
  return fallback + '\n' + subset.trim();
}
