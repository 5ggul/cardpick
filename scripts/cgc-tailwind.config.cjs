// Compile only the existing CGC guide; retain its original color tokens.
module.exports = {
  content: {
    files: ['./guide-cgc-grading.html'],
    transform: { html: source => source.replace(/<style id="cgc-(?:base|font)-css">[\s\S]*?<\/style>/g, '') },
  },
  theme: { extend: {
    colors: {
      bg: '#05080D', panel: '#0D121B', panel2: '#111722', line: 'rgba(255,255,255,0.08)',
      ink: '#E8EDF5', muted: '#8B96A8', up: '#26E0C2', down: '#FF4D6D',
      brand: '#26E0C2', warn: '#E0B84A',
    },
    fontFamily: {
      sans: ['"Cardpick Text"', 'Pretendard', 'system-ui', 'sans-serif'],
      mono: ['"IBM Plex Mono"', '"Cardpick Text"', 'Pretendard', 'system-ui', 'monospace'],
    },
  } },
};
