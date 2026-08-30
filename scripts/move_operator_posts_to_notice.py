"""운영자 재작성 8개 posts → 'notice' board 이동 (2026-08-30)

사용자가 3e8782bc 계정으로 재작성한 공지·가이드성 8건이 자유/질문/후기
board 에 분산 → 공지·가이드 탭으로 이동.

실행: set SUPABASE_DB_PASSWORD=<pw>; python scripts/move_operator_posts_to_notice.py
또는 GitHub Actions workflow_dispatch. Idempotent.
"""
import os, sys
try:
    import psycopg2
except ImportError:
    print("ERR: psycopg2 필요.", file=sys.stderr); sys.exit(1)

PG = dict(
    host=os.environ.get("SUPABASE_DB_HOST", "aws-1-ap-northeast-2.pooler.supabase.com"),
    port=int(os.environ.get("SUPABASE_DB_PORT", "6543")),
    user=os.environ.get("SUPABASE_DB_USER", "postgres.aqxrmdratnkffvivguqs"),
    password=os.environ.get("SUPABASE_DB_PASSWORD"),
    dbname="postgres", sslmode="require", connect_timeout=30,
)
if not PG["password"]:
    print("ERR: SUPABASE_DB_PASSWORD 미설정", file=sys.stderr); sys.exit(1)

OP_UUID = "3e8782bc-4790-4d9a-91ad-cccddb68994a"

print(f"[connect] {PG['user']}@{PG['host']}:{PG['port']}")
conn = psycopg2.connect(**PG); conn.autocommit = True; cur = conn.cursor()

print(f"\n[사전] 운영자 posts board 분포")
cur.execute(f"select board, count(*) from public.posts where user_id='{OP_UUID}' group by board;")
for r in cur.fetchall():
    print(f"  {r[0]:8s}: {r[1]}건")

print(f"\n[이동] board -> 'notice'")
cur.execute(f"update public.posts set board='notice' where user_id='{OP_UUID}' and board <> 'notice';")
print(f"  updated: {cur.rowcount}")

print(f"\n[검증]")
cur.execute(f"select board, count(*) from public.posts where user_id='{OP_UUID}' group by board;")
for r in cur.fetchall():
    print(f"  {r[0]:8s}: {r[1]}건")

cur.close(); conn.close()
print("\n[done] 8개 posts -> notice 이동 완료.")
