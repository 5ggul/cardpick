#!/usr/bin/env python3
"""PokéBeach RSS → drop_events 테이블 INSERT (1일 1회 cron).

원칙:
- RSS 공식 출처 사용 (https://www.pokebeach.com/feed)
- 본문 번역 복붙 X (summary 한 줄만 저장)
- 이미지 자체 호스팅 X (외부 URL 그대로 참조)
- 중복 차단: source_id (RSS guid 또는 link hash)
- fetch 실패 시 기존 데이터 유지 (skip)

환경변수:
  SUPABASE_DB_PASSWORD
"""
import os, sys, hashlib, re, urllib.request, urllib.parse, psycopg2
from datetime import datetime
from email.utils import parsedate_to_datetime
from xml.etree import ElementTree as ET

try: sys.stdout.reconfigure(line_buffering=True)
except Exception: pass

PG = dict(
    host=os.environ.get("SUPABASE_DB_HOST", "aws-1-ap-northeast-2.pooler.supabase.com"),
    port=int(os.environ.get("SUPABASE_DB_PORT", "6543")),
    user=os.environ.get("SUPABASE_DB_USER", "postgres.aqxrmdratnkffvivguqs"),
    password=os.environ.get("SUPABASE_DB_PASSWORD"),
    dbname="postgres", sslmode="require", connect_timeout=30,
)
if not PG["password"]:
    print("ERR: SUPABASE_DB_PASSWORD missing"); sys.exit(1)

RSS_URL = "https://www.pokebeach.com/feed"
SOURCE_NAME = "pokebeach"
USER_AGENT = "Mozilla/5.0 cardpick.kr RSS fetcher (admin@cardpick.kr)"

# 태그 자동 분류 키워드
TAG_RULES = [
    ("new_set",  r"\b(set|expansion|reveal|new product)\b"),
    ("promo",    r"\b(promo|promotional)\b"),
    ("event",    r"\b(event|tournament|championship|worlds)\b"),
    ("japan",    r"\b(japan|japanese)\b"),
    ("english",  r"\b(english|tcg release|us release)\b"),
    ("lottery",  r"\b(lottery|raffle|drawing)\b"),
    ("preorder", r"\b(preorder|pre-order)\b"),
]

# 한글 명사 매핑 (포켓몬 + 키 용어) — 자동 한글 짧은 제목 생성용
NOUN_KO = {
    # 포켓몬 (cards.name_ko와 동일 매핑)
    'charizard': '리자몽', 'pikachu': '피카츄', 'mewtwo': '뮤츠', 'mew': '뮤',
    'umbreon': '블래키', 'eevee': '이브이', 'sylveon': '님피아', 'espeon': '에브이',
    'greninja': '개굴닌자', 'lucario': '루카리오', 'gengar': '팬텀', 'snorlax': '잠만보',
    'rayquaza': '레쿠쟈', 'lugia': '루기아', 'zoroark': '조로아크', 'tyranitar': '마기라스',
    'garchomp': '한카리아스', 'charmander': '파이리', 'squirtle': '꼬부기', 'bulbasaur': '이상해씨',
    # 카드 시스템
    'mega evolution': '메가 진화', 'mega': '메가', 'tera': '테라',
    # 세트·시즌
    'paldean fates': '팔디언 페이츠', 'prismatic evolutions': '프리스매틱 에볼루션',
    'scarlet & violet': 'SV 시리즈', 'sword & shield': 'SWSH 시리즈',
    # 이벤트
    'worlds': '월드 챔피언십', 'pokémon worlds': '월드 챔피언십',
    'championship': '챔피언십', 'tournament': '토너먼트',
    # 액션
    'release': '발매', 'released': '발매', 'launch': '출시', 'launched': '출시',
    'announce': '공개', 'announced': '공개', 'reveal': '공개', 'revealed': '공개',
    'preview': '미리보기', 'leak': '유출', 'leaked': '유출',
    'open': '시작', 'opens': '시작', 'begin': '시작',
}

CATEGORY_KO = {
    'new_set':  '신규 세트',
    'promo':    '프로모',
    'lottery':  '응모',
    'preorder': '예약 판매',
    'event':    '이벤트',
}

def auto_title_ko(title_en, tags):
    """영어 제목 + 태그 기반 짧은 한글 요약 (휴리스틱).
    예: "New Mega Charizard ex Set Announced" + [new_set, english]
        → "신규 메가 리자몽 ex 세트 공개"
    """
    title_l = title_en.lower()
    parts = []

    # 1. 'New' / 'First' prefix
    if re.search(r'\bnew\b', title_l): parts.append('신규')
    elif re.search(r'\bfirst\b', title_l): parts.append('최초')

    # 2. 포켓몬 이름 + 카드 시스템 매핑 (순서대로 매칭, 첫 번째만 사용)
    matched_noun = None
    for en, ko in sorted(NOUN_KO.items(), key=lambda x: -len(x[0])):
        if en in title_l:
            matched_noun = ko
            # 'ex'/'V'/'VMAX' 접미사 보존
            for suffix in [' ex', ' v ', ' vmax', ' vstar', ' gx']:
                if f'{en}{suffix.lower()}' in title_l:
                    matched_noun = ko + suffix.replace(' ', ' ').upper().replace('  ', ' ').strip()
                    matched_noun = ko + (' EX' if 'ex' in suffix.lower() else suffix.upper())
                    break
            parts.append(matched_noun)
            break

    # 3. 카테고리 명사
    if 'new_set' in tags: parts.append('세트')
    elif 'promo' in tags: parts.append('프로모 카드')
    elif 'lottery' in tags: parts.append('응모')
    elif 'preorder' in tags: parts.append('예약')

    # 4. 동사 (공개/발매/시작)
    verb = None
    if re.search(r'\b(announc|reveal|preview)', title_l): verb = '공개'
    elif re.search(r'\b(releas|launch|out now|drops)', title_l): verb = '발매'
    elif re.search(r'\b(open|begin|start)', title_l): verb = '시작'
    elif re.search(r'\b(leak)', title_l): verb = '유출'
    if verb: parts.append(verb)

    # 5. 국가 표시 (꼬리)
    suffix_country = ''
    if 'japan' in tags: suffix_country = ' (일본판)'
    elif 'english' in tags: suffix_country = ' (영문판)'

    # 6. fallback — 매핑된 명사·카테고리·동사 부족 시
    if len(parts) < 2:
        if tags and tags[0] in CATEGORY_KO:
            cat_label = CATEGORY_KO[tags[0]]
            return f"{cat_label} 소식{suffix_country}"
        return f"포켓몬 TCG 소식{suffix_country}"

    return ' '.join(parts) + suffix_country


def fetch_rss():
    req = urllib.request.Request(RSS_URL, headers={"User-Agent": USER_AGENT, "Accept": "application/rss+xml"})
    with urllib.request.urlopen(req, timeout=30) as r:
        return r.read()

def parse_rss(xml_bytes):
    root = ET.fromstring(xml_bytes)
    channel = root.find("channel")
    if channel is None: return []
    items = []
    for item in channel.findall("item"):
        title = (item.findtext("title") or "").strip()
        link  = (item.findtext("link") or "").strip()
        guid  = (item.findtext("guid") or link).strip()
        desc  = (item.findtext("description") or "").strip()
        pubraw = (item.findtext("pubDate") or "").strip()
        try:
            pub_dt = parsedate_to_datetime(pubraw)
        except Exception:
            pub_dt = datetime.utcnow()
        # description에서 첫 이미지 추출 (외부 URL 참조용, 자체 호스팅 X)
        img_match = re.search(r'<img[^>]+src=["\']([^"\']+)["\']', desc)
        image_url = img_match.group(1) if img_match else None
        # summary: HTML 태그 제거 + 200자 자르기
        summary = re.sub(r'<[^>]+>', '', desc)
        summary = re.sub(r'\s+', ' ', summary).strip()[:300]
        items.append(dict(
            title=title, link=link, guid=guid,
            summary=summary, image_url=image_url, pub_dt=pub_dt
        ))
    return items

def classify_tags(title, summary):
    text = (title + " " + summary).lower()
    tags = []
    for tag, pattern in TAG_RULES:
        if re.search(pattern, text):
            tags.append(tag)
    if not tags:
        tags.append("news")
    return tags

def make_source_id(guid):
    return hashlib.sha1((SOURCE_NAME + ":" + guid).encode("utf-8")).hexdigest()[:32]

def main():
    print(f"[{datetime.utcnow().isoformat()}] PokéBeach RSS fetch start")
    try:
        xml = fetch_rss()
        print(f"  fetched: {len(xml)} bytes")
    except Exception as e:
        print(f"  ERR fetch: {e}")
        sys.exit(1)

    items = parse_rss(xml)
    print(f"  parsed: {len(items)} items")
    if not items:
        print("  no items, exit"); return

    conn = psycopg2.connect(**PG); conn.autocommit = False
    cur = conn.cursor()

    inserted = 0; skipped = 0
    INS = """
        INSERT INTO drop_events
          (source_id, source_name, title, title_ko, summary, source_url, image_url, category, tags, country, published_at)
        VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
        ON CONFLICT (source_id) DO NOTHING
    """
    for it in items:
        sid = make_source_id(it["guid"])
        tags = classify_tags(it["title"], it["summary"])
        # category 자동: lottery/preorder는 별도, 나머지는 news
        if "lottery" in tags: category = "lottery"
        elif "preorder" in tags: category = "preorder"
        elif "new_set" in tags or "promo" in tags: category = "release"
        elif "event" in tags: category = "event"
        else: category = "news"
        country = "JP" if "japan" in tags else ("US" if "english" in tags else "GLOBAL")
        title_ko_auto = auto_title_ko(it["title"], tags)
        try:
            cur.execute(INS, (
                sid, SOURCE_NAME, it["title"], title_ko_auto, it["summary"],
                it["link"], it["image_url"], category, tags, country, it["pub_dt"]
            ))
            if cur.rowcount > 0:
                inserted += 1
                print(f"  + [{category}] {title_ko_auto}  ←  {it['title'][:60]}")
            else: skipped += 1
        except Exception as e:
            print(f"  ERR insert {sid}: {e}")
            skipped += 1

    conn.commit()
    cur.close(); conn.close()
    print(f"  done: inserted={inserted} skipped={skipped} (total parsed={len(items)})")

if __name__ == "__main__":
    main()
