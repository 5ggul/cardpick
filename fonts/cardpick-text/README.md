# Cardpick Text page subsets

Source: [Pretendard v1.3.9](https://github.com/orioncactus/pretendard/tree/v1.3.9),
`packages/pretendard/dist/web/variable/woff2/PretendardVariable.woff2`.
Original SHA-256: `9599f12fd42fc0bce1cd50b47a0c022e108d7aa64dd0d1bb0ed44f3282d900b4`.

These variable-font subsets preserve original outlines, weights, metrics and hinting.
Modified subsets are named **Cardpick Text**, respecting the upstream Reserved Font
Name. Copyright and SIL OFL 1.1 are retained in the fonts and `OFL.txt`.

Only CGC and card-detail pages use these assets. They are not a global font change.
The full, pinned upstream dynamic subsets remain the fallback for characters not
in these page-specific files (including future card names and user text).
Both use one CSS family with explicit unicode ranges, so loading the primary
subset does not also download a duplicate fallback for the same characters.

## Rebuild

With Python and `fonttools[woff]==4.60.1` installed in a build-only environment:

```text
python scripts/build-page-fonts.py /path/to/PretendardVariable.woff2
npx --offline --yes --package=tailwindcss@3.4.17 tailwindcss -c scripts/card-tailwind.config.cjs -i styles/guides.input.css -o styles/card-base.css --minify
npx --offline --yes --package=tailwindcss@3.4.17 tailwindcss -c scripts/cgc-tailwind.config.cjs -i styles/guides.input.css -o styles/cgc-base.css --minify
node scripts/inline-card-styles.mjs
node scripts/inline-cgc-styles.mjs
```

The build checks the upstream hash and reads the current page/server/UI sources.
No font-building dependency, network download, or Python runs in production.
New characters still render via fallback before rebuilding. If rendering changes,
update the card SSR cache version together with its regression test.
