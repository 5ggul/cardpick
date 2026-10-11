// Preserve the TCG introduction's distinct Tailwind 3.4.17 theme.
// Rebuild from the repository root:
// npm exec --yes --package=tailwindcss@3.4.17 -- tailwindcss -c scripts/ad-tcg-tailwind.config.cjs -i styles/guides.input.css -o styles/ad-tcg-base.css --minify
module.exports = {
  content: ['./guide-what-is-tcg.html'],
  theme: { extend: {
    colors: {
      bg: '#080B10', panel: '#111620', panel2: '#151B26', line: '#253044',
      ink: '#E8EEF7', muted: '#8B96A8', up: '#12D6B0', down: '#FF4D6D',
      gold: '#F2C94C', brand: '#26E0C2',
    },
    fontFamily: {
      sans: ['Pretendard', 'system-ui', 'sans-serif'],
      mono: ['"IBM Plex Mono"', 'ui-monospace', 'monospace'],
    },
  } },
};
