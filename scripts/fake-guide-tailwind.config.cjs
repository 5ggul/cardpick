// npm exec --yes --package=tailwindcss@3.4.17 -- tailwindcss -c scripts/fake-guide-tailwind.config.cjs -i styles/guides.input.css -o styles/fake-guide-base.css --minify
const hub = require('./guides-tailwind.config.cjs');
module.exports = {
  content: ['./guide-fake-detection.html'],
  theme: { extend: {
    colors: { ...hub.theme.extend.colors, warn: '#E0B84A' },
    fontFamily: {
      sans: ['Pretendard', 'system-ui', 'sans-serif'],
      mono: ['"IBM Plex Mono"', 'ui-monospace', 'monospace'],
    },
  } },
};
