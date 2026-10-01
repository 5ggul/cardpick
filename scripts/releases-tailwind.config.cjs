// Build from the repository root with Tailwind 3.4.17:
// npm exec --yes --package=tailwindcss@3.4.17 -- tailwindcss -c scripts/releases-tailwind.config.cjs -i styles/guides.input.css -o styles/releases-base.css --minify
// node scripts/inline-release-styles.mjs
// Include generated calendar classes and client-created set cards, not just static HTML.
module.exports = {
  content: {
    files: ['./releases.html', './scripts/build_release_calendar.py', './auth.js', './search.js'],
    // Never scan the previous generated CSS as if its tokens were new utility classes.
    transform: { html: source => source.replace(/<style id="release-base-css">[\s\S]*?<\/style>/g, '') },
  },
  theme: { extend: {
    colors: {
      bg: '#080B10', panel: '#111620', panel2: '#151B26',
      line: '#253044', ink: '#E8EEF7', muted: '#8B96A8',
      up: '#12D6B0', down: '#FF4D6D', gold: '#F2C94C', brand: '#26E0C2',
    },
    fontFamily: {
      sans: ['Pretendard', 'system-ui', 'sans-serif'],
      mono: ['"IBM Plex Mono"', 'ui-monospace', 'monospace'],
    },
  } },
};
