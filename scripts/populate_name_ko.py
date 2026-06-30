#!/usr/bin/env python3
"""cards.name_ko 채우기 — 검증된 종족명 사전(card-name-translator DICT)으로 영문 카드명의 종족 토큰을 한국어로 치환.
목적: 한국어 검색(리자몽/블래키 등)·온사이트 검색·카드 한국어 SEO 활성화 (현재 name_ko 전부 null).

안전 원칙 (§2-1 / §4):
- 검증된 DICT 종족명만 사용(6/3 오역 사고 후 정리된 큐레이션). 추측 매핑 금지.
- 종족명을 word-boundary로 longest-match 치환, 접미사(ex/V/VMAX 등)·트레이너 접두는 그대로 유지.
- DICT에 없는 카드는 건너뜀(name_ko=null 유지). 커버리지보다 정확성 우선.
- 기본 --dry-run: 쓰기 없이 미리보기/통계만. 실제 쓰기는 --write + SUPABASE_DB_PASSWORD(Actions).

사용:
  python scripts/populate_name_ko.py            # dry-run (REST read, 미리보기)
  python scripts/populate_name_ko.py --write     # 실제 DB 쓰기 (psycopg2, Actions에서)
  python scripts/populate_name_ko.py --write --limit 500   # 드립: 인기순 N장만
"""
import os, sys, re, json, urllib.request

SUPA = "https://aqxrmdratnkffvivguqs.supabase.co"
ANON = "sb_publishable_AeDBjfn3ymozGyw06ohMUw_S6n1-qpj"
DICT_HTML = os.path.join(os.path.dirname(__file__), "..", "tools", "card-name-translator.html")

try: sys.stdout.reconfigure(line_buffering=True, encoding="utf-8")
except Exception: pass


def load_dict():
    t = open(DICT_HTML, encoding="utf-8").read()
    m = re.search(r"var DICT\s*=\s*\{(.*?)\};", t, re.S)
    if not m:
        print("ERR: DICT 블록 못 찾음"); sys.exit(1)
    pairs = re.findall(r'"([a-z][a-z0-9.\' -]*)"\s*:\s*"([가-힣A-Za-z0-9 ()·]+)"', m.group(1))
    d = {k.strip().lower(): v.strip() for k, v in pairs}
    return d


def rest_get(path):
    req = urllib.request.Request(SUPA + path, headers={"apikey": ANON})
    return json.load(urllib.request.urlopen(req, timeout=40))


def fetch_cards():
    rows = []
    for off in range(0, 40000, 1000):
        d = rest_get(f"/rest/v1/cards?select=slug,name,name_ko,popularity_rank&game=eq.pokemon&offset={off}&limit=1000")
        if not d: break
        rows.extend(d)
    return rows


# 검증된 접두/수식어 (high-frequency). Mega=메가, Team Rocket=로켓단 공식.
EXTRA = {"team rocket's": "로켓단의", "mega": "메가"}


def make_name_ko(name, keys, D, extra_keys, MERGED):
    """name 안의 모든 종족명 + 검증 접두를 한국어로 전역 치환(longest-first, word-boundary, 대소문자무시).
    DICT 종족명이 하나도 안 맞으면 None(건너뜀)."""
    out = name
    species_hit = False
    for k in (extra_keys + keys):  # 접두 먼저, 그다음 긴 종족명 우선
        pat = re.compile(r"\b" + re.escape(k) + r"\b", re.I)
        if pat.search(out):
            if k in D:
                species_hit = True
            out = pat.sub(MERGED[k], out)
    return out if (species_hit and out != name) else None


def main():
    write = "--write" in sys.argv
    limit = None
    if "--limit" in sys.argv:
        limit = int(sys.argv[sys.argv.index("--limit") + 1])

    D = load_dict()
    keys = sorted(D.keys(), key=len, reverse=True)
    extra_keys = sorted(EXTRA.keys(), key=len, reverse=True)
    MERGED = {**D, **EXTRA}
    print(f"[populate_name_ko] DICT {len(D)}종 + 접두 {len(EXTRA)} · mode={'WRITE' if write else 'DRY-RUN'}" + (f" · limit={limit}" if limit else ""))

    cards = fetch_cards()
    print(f"카탈로그 {len(cards)}장 (name_ko=null {sum(1 for c in cards if not c.get('name_ko'))})")

    # 후보 산출 (name_ko 비어있고 매칭되는 것)
    cands = []
    for c in cards:
        if c.get("name_ko"):  # 이미 있으면 skip
            continue
        nk = make_name_ko(c["name"], keys, D, extra_keys, MERGED)
        if nk and nk != c["name"]:
            cands.append((c["slug"], c["name"], nk, c.get("popularity_rank")))
    # 인기순(popularity_rank 작을수록 인기 가정) → 드립 시 인기부터
    cands.sort(key=lambda x: (x[3] is None, x[3] if x[3] is not None else 1e9))
    if limit:
        cands = cands[:limit]
    print(f"name_ko 채울 후보: {len(cands)}장\n")

    # 미리보기 25장 + 잠재 이슈(영문 잔존 많은 것)
    print("--- 미리보기 (상위 25) ---")
    for slug, en, ko, _ in cands[:25]:
        print(f"  {en:38.38} -> {ko}")
    # 트레이너 접두 등 영문 잔존 케이스(검수 포인트)
    eng_left = [(en, ko) for slug, en, ko, _ in cands if re.search(r"[A-Za-z]{3,}", ko)]
    print(f"\n--- 한국어+영문 혼합(접두/접미 잔존) {len(eng_left)}장, 샘플 8 ---")
    for en, ko in eng_left[:8]:
        print(f"  {en:38.38} -> {ko}")

    if not write:
        print("\n[DRY-RUN] DB 쓰기 안 함. 검수 후 --write 로 실행.")
        return

    # --- 실제 쓰기 (psycopg2 배치 UPDATE, SUPABASE_DB_PASSWORD 필요) ---
    import psycopg2
    from psycopg2.extras import execute_values
    pw = os.environ.get("SUPABASE_DB_PASSWORD")
    if not pw:
        print("ERR: SUPABASE_DB_PASSWORD missing (write 모드)"); sys.exit(1)
    conn = psycopg2.connect(
        host=os.environ.get("SUPABASE_DB_HOST", "aws-1-ap-northeast-2.pooler.supabase.com"),
        port=int(os.environ.get("SUPABASE_DB_PORT", "6543")),
        user=os.environ.get("SUPABASE_DB_USER", "postgres.aqxrmdratnkffvivguqs"),
        password=pw, dbname="postgres", sslmode="require", connect_timeout=30)
    conn.autocommit = False
    cur = conn.cursor()
    # 배치 UPDATE: VALUES 리스트 1회 조인 (4,806 round-trip → page_size 단위)
    rows = [(slug, ko) for slug, en, ko, _ in cands]
    execute_values(
        cur,
        "UPDATE cards AS c SET name_ko = v.nk, updated_at = now() "
        "FROM (VALUES %s) AS v(slug, nk) "
        "WHERE c.slug = v.slug AND c.game = 'pokemon' AND c.name_ko IS NULL",
        rows, template="(%s, %s)", page_size=1000)
    n = cur.rowcount
    conn.commit(); cur.close(); conn.close()
    print(f"\n[WRITE] name_ko 배치 갱신 완료 (대상 {len(rows)}장)")


if __name__ == "__main__":
    main()
