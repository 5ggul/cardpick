# Cardpick Text page subsets

Source: [Pretendard v1.3.9](https://github.com/orioncactus/pretendard/tree/v1.3.9),
`packages/pretendard/dist/web/variable/woff2/PretendardVariable.woff2`.
Original SHA-256: `9599f12fd42fc0bce1cd50b47a0c022e108d7aa64dd0d1bb0ed44f3282d900b4`.

These variable-font subsets preserve original outlines, weights, metrics and hinting.
Modified subsets are named **Cardpick Text**, respecting the upstream Reserved Font
Name. Copyright and SIL OFL 1.1 are retained in the fonts and `OFL.txt`.

Only CGC, card-detail, home, releases, the card-price guide and the three growth
guides listed below use these assets. They are not a global font change.
The full, pinned upstream dynamic subsets remain the fallback for characters not
in these page-specific files (including future card names and user text).
Both use one CSS family with explicit unicode ranges, so loading the primary
subset does not also download a duplicate fallback for the same characters.

## Rebuild

With Python and `fonttools[woff]==4.60.1` installed in a build-only environment:

```text
python scripts/build-page-fonts.py /path/to/PretendardVariable.woff2 --pages card cgc
npx --offline --yes --package=tailwindcss@3.4.17 tailwindcss -c scripts/card-tailwind.config.cjs -i styles/guides.input.css -o styles/card-base.css --minify
npx --offline --yes --package=tailwindcss@3.4.17 tailwindcss -c scripts/cgc-tailwind.config.cjs -i styles/guides.input.css -o styles/cgc-base.css --minify
node scripts/inline-card-styles.mjs
node scripts/inline-cgc-styles.mjs
```

The build checks the upstream hash and reads the current page/server/UI sources.
No font-building dependency, network download, or Python runs in production.
New characters still render via fallback before rebuilding. If rendering changes,
update the card SSR cache version together with its regression test.

## Home and releases only

Use explicit targets to avoid rebuilding the existing card/CGC assets. Python,
fonttools and the hash-verified upstream font are build-time inputs only.
The verified build uses `fonttools[woff]==4.60.1`, `brotli==1.1.0` and
`zopfli==0.2.3.post1` in a disposable build environment.
Home includes its SSR and shared UI strings; releases includes the curated
calendar JSON and renderer. Unseen API/user text retains the complete pinned
upstream fallback, with ranges disjoint from each local subset.

```text
python scripts/build-page-fonts.py /path/to/PretendardVariable.woff2 --pages home releases
node scripts/inline-release-styles.mjs --page home
npx --offline --yes --package=tailwindcss@3.4.17 tailwindcss -c scripts/releases-tailwind.config.cjs -i styles/guides.input.css -o styles/releases-base.css --minify
node scripts/inline-release-styles.mjs --page releases
```

The release-only synchronizer changes generated Mono declarations from `swap`
to `optional`, then keeps the standalone and inline CSS identical. It does not
change `guides.input.css`, Tailwind colors/utilities or other consuming pages.
Both pages declare their fonts before the first paint without preloading the
primary subset. Local comparisons found a cold-load regression on releases at
320px and additional home blocking time with preload enabled. No browser font
compiler or late-loaded font stylesheet is added.
Node's build-target rejection tests use Python 3 on PATH; set
`CARDPICK_FONT_PYTHON` to a build interpreter when using a bundled Python.
Those rejection cases run before fonttools imports and do not generate files.

## Home runtime characters

`home-runtime-chars.txt` is UTF-8 JSON containing only an explicit `characters`
payload and its capture provenance. It is a build input, not a current price,
card-name mapping, or production data source. The builder adds only that payload
when `--pages home` is selected; provenance text never enters the font subset.

The seven characters `갸몰완펄팬텀칠` were absent from the static-source subset but
present in the public GET capture at `2026-10-12T10:34:18.325Z`:
`/api/ticker` metadata contributes `펄팬텀칠`, and `/api/home-widgets` text contributes
`갸몰완`. The file records the artifact and response-body SHA-256 values for
reproduction. Those characters matched fallback subsets 75, 79, 81, 84, 85, 86
and 87 in the pinned upstream CSS. New or changed future API/user text keeps the
complete upstream fallback; this list is not a coverage guarantee.

On 2026-10-15 the payload also includes `…` (U+2026), separately identified as
CSS-generated text from existing `text-overflow:ellipsis` rules, not a character
observed in an API response or DOM text. [CSS Overflow §5.1](https://www.w3.org/TR/css-overflow-3/#text-overflow)
defines this ellipsis rendering. Only this one evidenced glyph is added; the
original two public-capture provenance records and timestamps remain unchanged.
Whether that avoids an upstream font request is a measured A/B question, not a
guarantee that a particular LCP score will be achieved.

The home and price CSS sources append the font binary's SHA-256 prefix as an
asset query revision. This prevents an updated glyph-range declaration from
reusing an older browser-cached binary. The file contents, page URLs, canonical
URLs, cache lifetimes and other page targets' generated format are unchanged.

To rebuild only the home subset and synchronize its existing inline font slot:

```text
python scripts/build-page-fonts.py /path/to/PretendardVariable.woff2 --pages home
node scripts/inline-release-styles.mjs --page home
```

The original outlines, widths, variable weights, hinting and `font-display:optional`
are retained. Card, CGC and release subsets are not regenerated by this command.

## Card-price guide only

The explicit `price` build target reads the existing `guide-card-price.html` and
shared `auth.js`/`search.js` strings. It does not generate article content or read
the price database. Its same-outline subset retains the reserved-name-safe
**Cardpick Text** name, weights, metrics, hinting, copyright and OFL license.
The unchanged, pinned `releases-fonts.css` is used only as input to the existing
disjoint-range helper; unseen future characters keep its complete fallback.

```text
python scripts/build-page-fonts.py /path/to/PretendardVariable.woff2 --pages price
node scripts/card-price-tailwind.config.cjs --build /path/to/tailwindcss-3.4.17/lib/cli.js
```

The page-owned CSS build synchronizes exactly the `price-font-css` and
`price-base-css` slots before `</head>`. It rejects missing or duplicate slots,
pins Tailwind 3.4.17, and verifies that the entire article body stays unchanged.
Only those two generated slots are excluded from the utility content scan, so
rebuilding does not accumulate CSS utility names found inside yesterday's CSS.
No compiler runs in production and no shared source stylesheet or other page's
font asset is rebuilt. The original Korean article is covered by regression
checks; generated CSS and font hashes are pinned separately from article hashes.

## Three growth guides only

The explicit `growth-guides` target covers `guide-psa-turnaround.html`,
`guide-brg-grading.html`, `guide-card-rarities.html`, `js/cp-rarity-helper.js` and
`cp-share.js`. It reuses the pinned Pretendard source and build dependencies above.
Unknown future characters retain the complete disjoint upstream fallback; this
target does not change any earlier page subset or its generated stylesheet.

```text
python scripts/build-page-fonts.py /path/to/PretendardVariable.woff2 --pages growth-guides
node scripts/growth-guides-tailwind.config.cjs --build /path/to/tailwindcss-3.4.17/lib/cli.js
```

The page-owned compiler reuses the existing theme and licensed local IBM Plex
Mono inputs without editing those shared sources. It removes runtime Tailwind
and external full-font stylesheets only for these three consumers. Generated
`growth-guides-font-css` and `growth-guides-base-css` slots remain in the head;
the entire original document body, thumbnail, ads, metadata and content dates
are unchanged. The compiler checks unique slots, a content-revisioned subset,
the pinned compiler version and body-byte preservation. A repeated build is
idempotent. The subset remains renamed **Cardpick Text** under the retained OFL.
Both sans and Mono declarations use `font-display:optional`, so a slow initial
visit may retain a system fallback rather than perform a late font swap.

On 2026-10-16, the approved Japanese MEGA MUR/MA article and helper extension
added three supported source characters to this target. The regenerated subset
contains 523 codepoints and is 112,900 bytes (460 bytes above the previous
520-codepoint build). Its SHA-256 is
`f8e301aa9649a1082758221996d725ce3b59aa47d921384e01e4c50f217292d7`.
Only the generated head slots are synchronized into the PSA-turnaround and
BRG guide consumers; their article bodies, metadata and dates are unchanged.
The rarity article's approved content changes are separate from that mechanical
build operation. No earlier page subset or shared input is regenerated.
