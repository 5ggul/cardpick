"""Build same-outline UI subsets. Requires fonttools[woff]==4.60.1.

Input (not committed): Pretendard v1.3.9 packages/pretendard/dist/web/variable/
woff2/PretendardVariable.woff2 from the pinned upstream distribution.
The original dynamic subsets remain a fallback for new/unknown characters.
"""
import hashlib
import re
import sys
from pathlib import Path
from fontTools import subset
from fontTools.ttLib import TTFont

root = Path(__file__).resolve().parent.parent
source = Path(sys.argv[1])
assert hashlib.sha256(source.read_bytes()).hexdigest() == '9599f12fd42fc0bce1cd50b47a0c022e108d7aa64dd0d1bb0ed44f3282d900b4', 'Unexpected upstream font'
out = root / 'fonts' / 'cardpick-text'
out.mkdir(parents=True, exist_ok=True)

for page, sources in {
    'cgc': ['guide-cgc-grading.html'],
    'card': ['card-detail.html', 'functions/cards/[slug].js', 'auth.js', 'search.js'],
}.items():
    text = '\n'.join((root / p).read_text(encoding='utf-8') for p in sources)
    text = re.sub(r'<style\b[^>]*>[\s\S]*?</style>', '', text)
    # Include printable ASCII and every actual non-ASCII source character.
    codepoints = set(range(32, 127)) | {ord(c) for c in text if ord(c) > 127}
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
    css = f"/* Same outlines; renamed subset under SIL OFL 1.1. See /fonts/cardpick-text/OFL.txt. */\n@font-face{{font-family:'Cardpick Text';font-style:normal;font-weight:45 920;font-display:optional;src:url(/fonts/cardpick-text/{page}.woff2) format('woff2');unicode-range:{ranges}}}\n"
    (root / 'styles' / f'{page}-text-font.css').write_text(css, encoding='utf-8')
    print(f'{page}: {len(supported)} characters, {target.stat().st_size:,} bytes')
