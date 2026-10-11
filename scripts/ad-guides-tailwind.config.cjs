// Preserve the two guides' existing Tailwind 3.4.17 theme without a browser compiler.
// Rebuild from the repository root:
// npm exec --yes --package=tailwindcss@3.4.17 -- tailwindcss -c scripts/ad-guides-tailwind.config.cjs -i styles/guides.input.css -o styles/ad-guides-base.css --minify
module.exports = {
  content: ['./guide-grading-proxy.html', './guide-pikachu-cards.html'],
  theme: { extend: {
    colors: {
      bg: '#05080D', panel: '#0D121B', panel2: '#111722',
      line: 'rgba(255,255,255,0.08)', ink: '#E8EDF5', muted: '#8B96A8',
      up: '#26E0C2', down: '#FF4D6D', brand: '#26E0C2', warn: '#E0B84A',
    },
    fontFamily: {
      sans: ['Pretendard', 'system-ui', 'sans-serif'],
      mono: ['"IBM Plex Mono"', 'ui-monospace', 'monospace'],
    },
  } },
};
