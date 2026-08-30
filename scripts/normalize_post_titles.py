"""게시글 title 정규화 — em-dash 제거 (2026-08-30)

배경:
- 사용자 명시 룰: 게시글 title 에 em-dash(—, –, ㅡ) 사용 금지.
- §CLAUDE §6-1 사용자 노출 한국어 콘텐츠에서 em-dash 금지 룰과 정합.
- 대체 우선순위 1: 콜론(:).

이 스크립트가 하는 일:
1. 기존 posts.title 에 있는 em-dash 를 콜론 + 공백으로 replace (백필)
2. Postgres 트리거 신설: posts INSERT/UPDATE title 시 자동 정규화
3. 검증 SELECT

실행 방법:
    set SUPABASE_DB_PASSWORD=<비밀번호>
    python scripts/normalize_post_titles.py

또는 GitHub Actions workflow_dispatch. Idempotent (재실행 안전).
"""
import os
import sys

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

print(f"[connect] {PG['user']}@{PG['host']}:{PG['port']}")
conn = psycopg2.connect(**PG); conn.autocommit = True; cur = conn.cursor()

# 사전 검사
print("\n[사전] em-dash 포함 title 카운트")
cur.execute("select count(*) from public.posts where title ~ '[—–ㅡ]';")
before = cur.fetchone()[0]
print(f"  대상: {before}건")

# 1. 백필 (em-dash 를 콜론 + 공백으로)
print("\n[1/3] 기존 title 정규화")
cur.execute(r"""
update public.posts
set title = regexp_replace(title, '\s*[—–ㅡ]\s*', ': ', 'g')
where title ~ '[—–ㅡ]';
""")
print(f"  updated: {cur.rowcount}")

# 2. 트리거 함수 신설 (title INSERT/UPDATE 시 자동 정규화)
print("\n[2/3] 트리거 함수 신설")
cur.execute(r"""
create or replace function public.normalize_post_title()
returns trigger language plpgsql as $$
begin
  if new.title is not null then
    new.title := regexp_replace(new.title, '\s*[—–ㅡ]\s*', ': ', 'g');
  end if;
  return new;
end $$;
""")
cur.execute("drop trigger if exists tg_normalize_post_title on public.posts;")
cur.execute("""
create trigger tg_normalize_post_title
  before insert or update of title on public.posts
  for each row execute function public.normalize_post_title();
""")
print("  ok")

# 3. 검증
print("\n[3/3] 검증")
cur.execute("select count(*) from public.posts where title ~ '[—–ㅡ]';")
after = cur.fetchone()[0]
print(f"  em-dash 잔존: {after}건 (0이면 완전 정리)")

cur.execute("select title from public.posts order by created_at desc limit 8;")
print("\n[최근 8건 title 샘플]")
for row in cur.fetchall():
    print(f"  {row[0]}")

cur.close(); conn.close()
print("\n[done] title 정규화 완료. 이후 INSERT/UPDATE 시 트리거가 자동 처리.")
