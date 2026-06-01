#!/usr/bin/env python3
"""네이버 데이터랩 검색어 트렌드 → search_trends 테이블.

원칙:
- 공식 API (https://openapi.naver.com/v1/datalab/search)
- 매일 1회 cron, 30일 윈도우
- 포켓몬 카드 관련 키워드 그룹별 trend ratio 수집

환경변수:
  NAVER_CLIENT_ID
  NAVER_CLIENT_SECRET
  SUPABASE_DB_PASSWORD
"""
import os, sys, json, urllib.request, psycopg2
from datetime import datetime, timedelta

try: sys.stdout.reconfigure(line_buffering=True)
except Exception: pass

NAVER_ID     = os.environ.get("NAVER_CLIENT_ID", "").strip()
NAVER_SECRET = os.environ.get("NAVER_CLIENT_SECRET", "").strip()
if not (NAVER_ID and NAVER_SECRET):
    print("ERR: NAVER_CLIENT_ID / NAVER_CLIENT_SECRET missing"); sys.exit(1)

PG = dict(
    host=os.environ.get("SUPABASE_DB_HOST", "aws-1-ap-northeast-2.pooler.supabase.com"),
    port=int(os.environ.get("SUPABASE_DB_PORT", "6543")),
    user=os.environ.get("SUPABASE_DB_USER", "postgres.aqxrmdratnkffvivguqs"),
    password=os.environ.get("SUPABASE_DB_PASSWORD"),
    dbname="postgres", sslmode="require", connect_timeout=30,
)
if not PG["password"]:
    print("ERR: SUPABASE_DB_PASSWORD missing"); sys.exit(1)

# 포켓몬 TCG 키워드 풀 — 30개 그룹 (Naver Datalab은 1회 호출당 5그룹 max → 6회 호출)
# 카테고리: 인기 카드(8) / 등급·그레이딩(5) / 세트·팩(6) / 거래·플랫폼(5) / 도구·기타(6)
KEYWORD_GROUPS = [
    # ── 인기 카드 ──
    {"groupName": "리자몽 카드",     "keywords": ["리자몽 카드", "Charizard 카드", "리자몽 ex"]},
    {"groupName": "블래키 카드",     "keywords": ["블래키 카드", "블래키 ex", "Umbreon 카드"]},
    {"groupName": "피카츄 카드",     "keywords": ["피카츄 카드", "Pikachu 카드", "피카츄 ex"]},
    {"groupName": "이브이 카드",     "keywords": ["이브이 카드", "Eevee 카드"]},
    {"groupName": "뮤츠 카드",       "keywords": ["뮤츠 카드", "Mewtwo 카드", "뮤츠 ex"]},
    {"groupName": "가디안 카드",     "keywords": ["가디안 카드", "Gardevoir 카드", "가디안 ex"]},
    {"groupName": "갸라도스 카드",   "keywords": ["갸라도스 카드", "Gyarados 카드"]},
    {"groupName": "뮤 카드",         "keywords": ["뮤 카드", "Mew 카드", "뮤 ex"]},

    # ── 등급·그레이딩 ──
    {"groupName": "PSA 그레이딩",    "keywords": ["PSA 그레이딩", "포켓몬 PSA", "PSA 10", "PSA 카드"]},
    {"groupName": "BGS 그레이딩",    "keywords": ["BGS 그레이딩", "BGS Black Label", "브알지"]},
    {"groupName": "포켓몬 카드 등급", "keywords": ["포켓몬 카드 등급", "카드 그레이딩"]},
    {"groupName": "PSA 가격",        "keywords": ["PSA 가격", "PSA 등급 가격"]},
    {"groupName": "센터링",          "keywords": ["포켓몬 카드 센터링", "PSA 센터링"]},

    # ── 세트·팩·등급 ──
    {"groupName": "메가 진화 카드",  "keywords": ["메가 진화 카드", "메가 카드"]},
    {"groupName": "SAR 카드",        "keywords": ["SAR 카드", "포켓몬 SAR"]},
    {"groupName": "테라스탈",        "keywords": ["테라스탈", "테라스탈 카드"]},
    {"groupName": "스칼렛 바이올렛", "keywords": ["스칼렛 바이올렛 카드", "SV 카드"]},
    {"groupName": "포켓몬 카드 박스", "keywords": ["포켓몬 카드 박스", "Booster Box 포켓몬"]},
    {"groupName": "151 카드",        "keywords": ["포켓몬 151 카드", "151 박스"]},

    # ── 거래·플랫폼 ──
    {"groupName": "포켓몬 카드 가격", "keywords": ["포켓몬 카드 가격", "포켓몬 카드 시세"]},
    {"groupName": "포켓몬 카드 일본", "keywords": ["포켓몬 카드 일본", "일본판 카드"]},
    {"groupName": "메루카리",        "keywords": ["메루카리 카드", "메루카리 포켓몬"]},
    {"groupName": "포켓몬 카드 직구", "keywords": ["포켓몬 카드 직구", "일본 카드 직구"]},
    {"groupName": "포켓몬 카드 가품", "keywords": ["포켓몬 카드 가품", "가품 판별"]},

    # ── 도구·기타 ──
    {"groupName": "박스깡",          "keywords": ["박스깡", "포켓몬 박스깡"]},
    {"groupName": "포켓몬 발매",     "keywords": ["포켓몬 카드 발매", "신규 세트"]},
    {"groupName": "포켓몬 카드 종류", "keywords": ["포켓몬 카드 종류", "포켓몬 레어도"]},
    {"groupName": "TCGplayer",      "keywords": ["TCGplayer", "TCG플레이어"]},
    {"groupName": "Cardmarket",     "keywords": ["Cardmarket", "카드마켓"]},
    {"groupName": "포켓몬 카드 입문", "keywords": ["포켓몬 카드 입문", "포켓몬 카드 시작"]},
]

# Naver Datalab은 1회당 5그룹 max → batch 분할
def _batched(seq, n):
    for i in range(0, len(seq), n): yield seq[i:i+n]

SETUP_SQL = """
CREATE TABLE IF NOT EXISTS search_trends (
  id BIGSERIAL PRIMARY KEY,
  keyword TEXT NOT NULL,
  date DATE NOT NULL,
  ratio NUMERIC(8,2),
  rank INT,
  period_days INT NOT NULL DEFAULT 7,
  fetched_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(keyword, date, period_days)
);
CREATE INDEX IF NOT EXISTS idx_search_trends_date ON search_trends(date DESC);
CREATE INDEX IF NOT EXISTS idx_search_trends_keyword ON search_trends(keyword);
ALTER TABLE search_trends ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "public_read_search_trends" ON search_trends;
CREATE POLICY "public_read_search_trends" ON search_trends FOR SELECT USING (true);
"""

def setup_db():
    conn = psycopg2.connect(**PG); conn.autocommit = True
    c = conn.cursor()
    try:
        c.execute(SETUP_SQL)
        c.execute("NOTIFY pgrst, 'reload schema'")
        print("  setup OK (search_trends ready)")
    except Exception as e:
        print(f"  setup WARN: {e}")
    c.close(); conn.close()

def fetch_datalab_batch(groups):
    """5그룹 단위 단일 호출. 30일 윈도우."""
    end = datetime.utcnow().date()
    start = end - timedelta(days=30)
    body = {
        "startDate": start.isoformat(),
        "endDate": end.isoformat(),
        "timeUnit": "date",
        "keywordGroups": groups
    }
    req = urllib.request.Request(
        "https://openapi.naver.com/v1/datalab/search",
        data=json.dumps(body).encode("utf-8"),
        headers={
            "X-Naver-Client-Id": NAVER_ID,
            "X-Naver-Client-Secret": NAVER_SECRET,
            "Content-Type": "application/json"
        },
        method="POST"
    )
    try:
        with urllib.request.urlopen(req, timeout=30) as r:
            return json.loads(r.read())
    except urllib.error.HTTPError as e:
        body_text = e.read().decode('utf-8', errors='replace')
        print(f"  HTTP {e.code} response body: {body_text[:500]}")
        raise

def fetch_datalab_all():
    """전체 KEYWORD_GROUPS를 5개 단위 batch로 호출, 결과 병합."""
    import time
    all_results = []
    batches = list(_batched(KEYWORD_GROUPS, 5))
    print(f"  Using NAVER_CLIENT_ID prefix={NAVER_ID[:6]}*** (len={len(NAVER_ID)})")
    print(f"  Total {len(KEYWORD_GROUPS)} groups → {len(batches)} batches × 5")
    for i, batch in enumerate(batches, 1):
        try:
            data = fetch_datalab_batch(batch)
            results = data.get("results", [])
            all_results.extend(results)
            print(f"  batch {i}/{len(batches)}: {len(results)} groups OK")
            if i < len(batches): time.sleep(1.0)  # rate-limit 안전
        except Exception as e:
            print(f"  batch {i} FAIL: {e}")
    return all_results

def main():
    print(f"[{datetime.utcnow().isoformat()}] Naver datalab fetch start")
    setup_db()
    try:
        results = fetch_datalab_all()
        print(f"  fetched total: {len(results)} keyword groups")
    except Exception as e:
        print(f"  ERR fetch: {e}")
        sys.exit(1)

    if not results:
        print("  no results — skip insert")
        sys.exit(0)

    conn = psycopg2.connect(**PG); conn.autocommit = False
    cur = conn.cursor()

    INS = """
        INSERT INTO search_trends (keyword, date, ratio, period_days)
        VALUES (%s, %s, %s, %s)
        ON CONFLICT (keyword, date, period_days) DO UPDATE
          SET ratio = EXCLUDED.ratio, fetched_at = now()
    """
    inserted = 0
    for group in results:
        keyword = group.get("title", "")
        for point in group.get("data", []):
            d = point.get("period")
            ratio = point.get("ratio")
            if not d or ratio is None: continue
            cur.execute(INS, (keyword, d, ratio, 30))
            inserted += 1

    conn.commit()
    cur.close(); conn.close()
    print(f"  done: {inserted} trend rows upserted ({len(results)} groups)")

    # 최근 7일 상위 키워드 출력
    conn = psycopg2.connect(**PG)
    cur = conn.cursor()
    cur.execute("""
        SELECT keyword, ROUND(AVG(ratio)::numeric, 2) AS avg_ratio
        FROM search_trends
        WHERE date >= CURRENT_DATE - INTERVAL '7 days'
          AND period_days = 30
        GROUP BY keyword
        ORDER BY avg_ratio DESC
        LIMIT 10
    """)
    print("  최근 7일 평균 ratio Top:")
    for row in cur.fetchall():
        print(f"    {row[0]:30s} | {row[1]}")
    cur.close(); conn.close()

if __name__ == "__main__":
    main()
