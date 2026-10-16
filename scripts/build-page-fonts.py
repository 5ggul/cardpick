"""Build same-outline UI subsets. Requires fonttools[woff]==4.60.1.

Input (not committed): Pretendard v1.3.9 packages/pretendard/dist/web/variable/
woff2/PretendardVariable.woff2 from the pinned upstream distribution.
The original dynamic subsets remain a fallback for new/unknown characters.
"""
import argparse
import hashlib
import json
import re
from pathlib import Path

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('source', type=Path)
parser.add_argument('--pages', nargs='+', required=True, choices=('cgc', 'card', 'home', 'releases', 'price', 'growth-guides'),
                    help='Explicit targets only; never regenerate another page implicitly.')
args = parser.parse_args()
if len(args.pages) != len(set(args.pages)):
    parser.error('Duplicate page targets are not allowed')

import fontTools
assert fontTools.__version__ == '4.60.1', 'Use the pinned fonttools[woff]==4.60.1 build dependency'
from fontTools import subset
from fontTools.ttLib import TTFont

root = Path(__file__).resolve().parent.parent
source = args.source
assert hashlib.sha256(source.read_bytes()).hexdigest() == '9599f12fd42fc0bce1cd50b47a0c022e108d7aa64dd0d1bb0ed44f3282d900b4', 'Unexpected upstream font'
out = root / 'fonts' / 'cardpick-text'
out.mkdir(parents=True, exist_ok=True)

page_sources = {
    'cgc': ['guide-cgc-grading.html'],
    'card': ['card-detail.html', 'functions/cards/[slug].js', 'auth.js', 'search.js'],
    'home': ['index.html', 'functions/_middleware.js', 'auth.js', 'search.js'],
    'releases': ['releases.html', 'data/release-calendar.json', 'scripts/build_release_calendar.py', 'auth.js', 'search.js'],
    'price': ['guide-card-price.html', 'auth.js', 'search.js'],
    'growth-guides': ['guide-psa-turnaround.html', 'guide-brg-grading.html', 'guide-card-rarities.html', 'js/cp-rarity-helper.js', 'cp-share.js'],
}
for page in args.pages:
    sources = page_sources[page]
    text = '\n'.join((root / p).read_text(encoding='utf-8') for p in sources)
    text = re.sub(r'<style\b[^>]*>[\s\S]*?</style>', '', text)
    # Include printable ASCII and every actual non-ASCII source character.
    codepoints = set(range(32, 127)) | {ord(c) for c in text if ord(c) > 127}
    if page == 'home':
        # Read only the explicit character payload, never provenance or prices.
        # Unknown future API/user characters retain the complete CSS fallback.
        runtime = json.loads((out / 'home-runtime-chars.txt').read_text(encoding='utf-8'))
        characters = runtime.get('characters')
        if runtime.get('version') != 1 or not isinstance(characters, str) or not characters:
            parser.error('Expected version 1 home runtime character payload')
        if len(set(characters)) != len(characters) or any(c.isspace() or ord(c) < 128 for c in characters):
            parser.error('Home runtime characters must be distinct non-ASCII characters')
        provenance = runtime.get('provenance')
        if not isinstance(provenance, list) or not provenance or not all(
            isinstance(item, dict) and isinstance(item.get('characters'), str) for item in provenance
        ) or set(characters) != set(''.join(item['characters'] for item in provenance)):
            parser.error('Home runtime characters must match their recorded provenance')
        codepoints.update(ord(c) for c in characters)
    font = TTFont(source, recalcTimestamp=False)
    supported = codepoints & set(font.getBestCmap())
    options = subset.Options()
    options.name_IDs = ['*']
    options.name_legacy = True
    options.name_languages = ['*']
    options.layout_features = ['*']
    sub = subset.Subsetter(options=options)
    sub.populate(unicodes=supported)
    sub.subset(font)
    # Respect the original OFL Reserved Font Name for this modified subset.
    for record in font['name'].names:
        if record.nameID in (1, 3, 4, 6, 16, 21, 25):
            name = 'CardpickText' if record.nameID in (6, 25) else 'Cardpick Text'
            record.string = name.encode(record.getEncoding())
    font.flavor = 'woff2'
    target = out / f'{page}.woff2'
    font.save(target)
    ranges = ','.join(f'U+{c:X}' for c in sorted(supported))
    # Updated home/price assets must not reuse an older browser-cached binary.
    # Other explicitly selected page targets retain their existing output format.
    revision = '?v=' + hashlib.sha256(target.read_bytes()).hexdigest()[:12] if page in ('home', 'price', 'growth-guides') else ''
    css = f"/* Same outlines; renamed subset under SIL OFL 1.1. See /fonts/cardpick-text/OFL.txt. */\n@font-face{{font-family:'Cardpick Text';font-style:normal;font-weight:45 920;font-display:optional;src:url(/fonts/cardpick-text/{page}.woff2{revision}) format('woff2');unicode-range:{ranges}}}\n"
    (root / 'styles' / f'{page}-text-font.css').write_text(css, encoding='utf-8')
    print(f'{page}: {len(supported)} characters, {target.stat().st_size:,} bytes')
