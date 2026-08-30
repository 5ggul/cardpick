"""게시판 comments_count 트리거 재적용 + 백필 (2026-08-28)

배경:
- posts.comments_count 캐시 컬럼이 라이브에서 0으로 표시되는 버그.
- schema_v2.sql:125-137 에 트리거 정의는 있으나 프로덕션 미적용/드랍 상태.
- 실측: 최근 3개 게시글 comments_count=0 인데 실 comments 테이블에는 각 1건.

이 스크립트가 하는 일:
1. tg_posts_comments_count() 함수 create or replace
2. tg_comments_count 트리거 재생성 (comments INSERT/DELETE)
3. 전체 posts 백필 (실 comments 카운트로 재설정)
4. 검증 SELECT

실행 방법:
    set SUPABASE_DB_PASSWORD=<비밀번호>
    python scripts/apply_board_comments_trigger.py

또는 GitHub Actions workflow_dispatch 로 트리거해도 됨(secret 이미 설정됨).
"""
import os
import sys

try:
    import psycopg2
except ImportError:
    print("ERR: psycopg2 필요. pip install psycopg2-binary", file=sys.stderr)
    sys.exit(1)

PG = dict(
    host=os.environ.get("SUPABASE_DB_HOST", "aws-1-ap-northeast-2.pooler.supabase.com"),
    port=int(os.environ.get("SUPABASE_DB_PORT", "6543")),
    user=os.environ.get("SUPABASE_DB_USER", "postgres.aqxrmdratnkffvivguqs"),
    password=os.environ.get("SUPABASE_DB_PASSWORD"),
    dbname="postgres",
    sslmode="require",
    connect_timeout=30,
)
if not PG["password"]:
    print("ERR: SUPABASE_DB_PASSWORD 환경변수 없음", file=sys.stderr)
    sys.exit(1)

print(f"[connect] {PG['user']}@{PG['host']}:{PG['port']}")
conn = psycopg2.connect(**PG)
conn.autocommit = True
cur = conn.cursor()

print("[1/3] 트리거 함수 재정의")
cur.execute("""
create or replace function public.tg_posts_comments_count()
returns trigger language plpgsql as $$
begin
  if TG_OP = 'INSERT' then
    update public.posts set comments_count = comments_count + 1 where id = new.post_id;
  elsif TG_OP = 'DELETE' then
    update public.posts set comments_count = greatest(comments_count - 1, 0) where id = old.post_id;
  end if;
  return null;
end;
$$;
""")
print("  ok")

print("[2/3] 트리거 재생성")
cur.execute("drop trigger if exists tg_comments_count on public.comments;")
cur.execute("""
create trigger tg_comments_count
  after insert or delete on public.comments
  for each row execute function public.tg_posts_comments_count();
""")
print("  ok")

print("[3/3] 전체 posts 백필")
cur.execute("""
update public.posts p set comments_count = coalesce((
  select count(*)::int from public.comments where post_id = p.id
), 0);
""")
print(f"  updated rows: {cur.rowcount}")

# 검증
print("\n[검증] 최근 5개 posts cached vs actual")
cur.execute("""
select p.id, p.title, p.comments_count as cached,
       (select count(*)::int from public.comments where post_id = p.id) as actual
from public.posts p
order by p.created_at desc
limit 5;
""")
print(f"  {'post_id':<40}{'cached':<8}{'actual':<8}title")
mismatch = 0
for row in cur.fetchall():
    pid, title, cached, actual = row
    if cached != actual:
        mismatch += 1
    print(f"  {str(pid)[:38]:<40}{cached:<8}{actual:<8}{(title or '')[:40]}")
print(f"\n  mismatch: {mismatch}/5 (0이면 정합 완료)")

cur.close()
conn.close()
print("\n[done] 트리거 재적용 완료. 이후 댓글 INSERT/DELETE 시 자동 카운트.")
# rerun 2026-08-30 (comments_count 재백필 + trigger 확인)
