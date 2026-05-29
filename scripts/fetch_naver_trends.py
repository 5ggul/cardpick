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

# 포켓몬 TCG 관련 키워드 그룹 (5개 그룹 × 5 키워드 = 25개 max per API call)
# 네이버 데이터랩은 한 번에 5 키워드 그룹까지 비교 가능
KEYWORD_GROUPS = [
    {"groupName": "리자몽 카드",  "keywords": ["리자몽 카드", "Charizard 카드", "리자몽 ex", "리자몽 카드 가격"]},
    {"groupName": "블래키 카드",  "keywords": ["블래키 카드", "블래키 ex", "Umbreon 카드"]},
    {"groupName": "PSA 그레이딩", "keywords": ["PSA 그레이딩", "포켓몬 PSA", "PSA 10", "PSA 카드"]},
    {"groupName": "포켓몬 카드 가격", "keywords": ["포켓몬 카드 가격", "포켓몬 카드 시세"]},
    {"groupName": "포켓몬 카드 일본", "keywords": ["포켓몬 카드 일본", "일본판 카드", "메루카리 카드"]},
]

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

def fetch_datalab():
    """30일 트렌드 fetch."""
    end = datetime.utcnow().date()
    start = end - timedelta(days=30)
    body = {
        "startDate": start.isoformat(),
        "endDate": end.isoformat(),
        "timeUnit": "date",
        "keywordGroups": KEYWORD_GROUPS
    }
    print(f"  Using NAVER_CLIENT_ID prefix={NAVER_ID[:6]}*** (len={len(NAVER_ID)})")
    print(f"  Using NAVER_CLIENT_SECRET len={len(NAVER_SECRET)}")
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

def main():
    print(f"[{datetime.utcnow().isoformat()}] Naver datalab fetch start")
    setup_db()
    try:
        data = fetch_datalab()
        results = data.get("results", [])
        print(f"  fetched: {len(results)} keyword groups")
    except Exception as e:
        print(f"  ERR fetch: {e}")
        sys.exit(1)

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
    print(f"  done: {inserted} trend rows upserted")

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
