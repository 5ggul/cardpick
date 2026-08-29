"""게시판 seed 게시글·댓글·좋아요·프로필 일괄 삭제 (2026-08-29)

배경:
- 초기 게시판 활성화 마중물로 시드 스크립트(scripts/seed_board*.py)가 삽입한
  게시글 48건 + 관련 댓글·좋아요·프로필 존재.
- 시드 유저 user_id 패턴: 'a0000001-0000-0000-0000-000000000XXX' (001~039).
- 실 유저 게시글은 별도 UUID (Google OAuth 발급).
- AdSense 심사 및 커뮤니티 자연 성장을 위해 시드 콘텐츠 완전 정리.
- 사용자 명시 승낙 (2026-08-29 "ㅇㅋ ㄱ")

이 스크립트가 하는 일 (FK 순서 준수):
1. post_likes 중 seed 유저 소유 또는 seed 게시글 대상 삭제
2. comments 중 seed 유저 소유 또는 seed 게시글 대상 삭제
3. posts 중 seed 유저 소유 삭제
4. profiles 중 seed 유저 삭제
5. 검증 SELECT (남은 실 유저 posts·comments 카운트)

실행 방법:
    set SUPABASE_DB_PASSWORD=<비밀번호>
    python scripts/purge_board_seed.py

또는 GitHub Actions workflow_dispatch (secret 이미 설정됨).

Idempotent: 시드 삭제 완료 후 재실행해도 0건 삭제 (LIKE 매치 없음).
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

SEED_LIKE = "a0000001-%"

print(f"[connect] {PG['user']}@{PG['host']}:{PG['port']}")
conn = psycopg2.connect(**PG)
conn.autocommit = True
cur = conn.cursor()

# 사전 카운트
print("\n[사전] 삭제 대상 카운트")
cur.execute(f"select count(*) from public.posts where user_id::text like '{SEED_LIKE}';")
seed_posts_before = cur.fetchone()[0]
cur.execute(f"select count(*) from public.comments where user_id::text like '{SEED_LIKE}';")
seed_comments_before = cur.fetchone()[0]
cur.execute(f"select count(*) from public.post_likes where user_id::text like '{SEED_LIKE}';")
seed_likes_before = cur.fetchone()[0]
cur.execute(f"select count(*) from public.profiles where id::text like '{SEED_LIKE}';")
seed_profiles_before = cur.fetchone()[0]
print(f"  seed posts:    {seed_posts_before}")
print(f"  seed comments: {seed_comments_before}")
print(f"  seed likes:    {seed_likes_before}")
print(f"  seed profiles: {seed_profiles_before}")

# 1. post_likes 삭제 (seed 유저 소유 OR seed 게시글 대상)
print("\n[1/4] post_likes 삭제")
cur.execute(f"""
delete from public.post_likes
where user_id::text like '{SEED_LIKE}'
   or post_id in (select id from public.posts where user_id::text like '{SEED_LIKE}');
""")
print(f"  deleted: {cur.rowcount}")

# 2. comments 삭제 (seed 유저 소유 OR seed 게시글 대상)
print("\n[2/4] comments 삭제")
cur.execute(f"""
delete from public.comments
where user_id::text like '{SEED_LIKE}'
   or post_id in (select id from public.posts where user_id::text like '{SEED_LIKE}');
""")
print(f"  deleted: {cur.rowcount}")

# 3. posts 삭제 (seed 유저 소유)
print("\n[3/4] posts 삭제")
cur.execute(f"delete from public.posts where user_id::text like '{SEED_LIKE}';")
print(f"  deleted: {cur.rowcount}")

# 4. profiles 삭제 (seed 유저)
print("\n[4/4] profiles 삭제")
cur.execute(f"delete from public.profiles where id::text like '{SEED_LIKE}';")
print(f"  deleted: {cur.rowcount}")

# 검증
print("\n[검증] 남은 실 유저 콘텐츠")
cur.execute("select count(*) from public.posts;")
posts_after = cur.fetchone()[0]
cur.execute("select count(*) from public.comments;")
comments_after = cur.fetchone()[0]
cur.execute("select count(*) from public.post_likes;")
likes_after = cur.fetchone()[0]
cur.execute("select count(*) from public.profiles;")
profiles_after = cur.fetchone()[0]
print(f"  posts:    {posts_after}")
print(f"  comments: {comments_after}")
print(f"  likes:    {likes_after}")
print(f"  profiles: {profiles_after}")

# 잔여 시드 확인
cur.execute(f"select count(*) from public.posts where user_id::text like '{SEED_LIKE}';")
residual_seed = cur.fetchone()[0]
print(f"\n  잔여 seed posts: {residual_seed} (0이면 완전 정리)")

# 최근 실 유저 posts 목록
print("\n[남은 실 유저 posts 최근 10건]")
cur.execute("""
select left(user_id::text, 14), title, to_char(created_at, 'YYYY-MM-DD')
from public.posts
order by created_at desc
limit 10;
""")
for row in cur.fetchall():
    uid, title, dt = row
    print(f"  {uid}... {dt} {(title or '')[:50]}")

cur.close()
conn.close()
print("\n[done] seed 정리 완료. board 광고는 실 posts 5건 이상 시에만 로드됨.")
