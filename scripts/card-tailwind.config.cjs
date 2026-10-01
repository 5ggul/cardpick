// From the repository root: compile with Tailwind 3.4.17, then inline-card-styles.mjs.
module.exports = {
  content: {
    files: ['./card-detail.html', './functions/cards/*.js', './auth.js', './search.js'],
    transform: { html: source => source.replace(/<style id="card-(?:base|font)-css">[\s\S]*?<\/style>/g, '') },
  },
  theme: { extend: {
    colors: {
      bg: '#080B10', panel: '#111620', panel2: '#151B26', line: '#253044',
      ink: '#E8EEF7', muted: '#8B96A8', up: '#12D6B0', down: '#FF4D6D',
      gold: '#F2C94C', brand: '#26E0C2',
    },
    fontFamily: {
      sans: ['"Cardpick Text"', 'Pretendard', 'system-ui', 'sans-serif'],
      mono: ['"IBM Plex Mono"', '"Cardpick Text"', 'Pretendard', 'system-ui', 'monospace'],
    },
  } },
};
