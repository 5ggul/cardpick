// Keep the existing /guides Tailwind 3.4.17 design, without a browser compiler.
// Rebuild from the repository root:
// npm exec --yes --package=tailwindcss@3.4.17 -- tailwindcss -c scripts/guides-tailwind.config.cjs -i styles/guides.input.css -o styles/guides-base.css --minify
// node scripts/inline-guides-styles.mjs
module.exports = {
  content: ['./functions/guides.js', './auth.js', './search.js'],
  theme: {
    extend: {
      colors: {
        bg: '#05080D', panel: '#0D121B', panel2: '#111722',
        line: 'rgba(255,255,255,0.08)', ink: '#E8EDF5', muted: '#8B96A8',
        up: '#26E0C2', down: '#FF4D6D', brand: '#26E0C2', gold: '#F2C94C',
      },
    },
  },
};
