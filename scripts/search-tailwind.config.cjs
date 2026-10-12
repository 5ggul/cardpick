// Search-only Tailwind 3.4.17 build. Keep the existing SSR theme and all result states.
// Rebuild from the repository root:
// npm exec --yes --package=tailwindcss@3.4.17 -- tailwindcss -c scripts/search-tailwind.config.cjs -i styles/search.input.css -o styles/search-base.css --minify
module.exports = {
  content: ['./functions/search.js'],
  theme: { extend: {
    colors: {
      bg: '#05080D', panel: '#0D121B', panel2: '#111722',
      line: 'rgba(255,255,255,0.08)', ink: '#E8EDF5', muted: '#8B96A8',
      up: '#26E0C2', down: '#FF4D6D', brand: '#26E0C2',
    },
    fontFamily: {
      sans: ['Pretendard', 'system-ui', 'sans-serif'],
      mono: ['"IBM Plex Mono"', 'ui-monospace', 'monospace'],
    },
  } },
};
