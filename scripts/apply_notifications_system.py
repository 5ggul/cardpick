"""알림 시스템 DB 인프라 도입 (2026-08-29)

배경:
- 게시판 댓글 알림 부재 (사용자 지적: "원본 글 작성자한테도 알람 가?" = 아니오).
- 커뮤니티 활성화 핵심: 내 글에 댓글 달렸을 때 알림 → 재방문 유도.

이 스크립트가 하는 일:
1. public.notifications 테이블 생성 (user_id, type, actor_id, post_id, comment_id, read_at, created_at)
2. comments INSERT 트리거: 원본 글 작성자에게 notification row 삽입
   (본인이 자기 글에 댓글 = skip, 이미 삭제된 글 = skip)
3. RLS: 본인 알림만 select/update 가능
4. 인덱스: user_id + read_at DESC (미읽음 조회 최적화)

실행 방법:
    set SUPABASE_DB_PASSWORD=<비밀번호>
    python scripts/apply_notifications_system.py

또는 GitHub Actions workflow_dispatch (secret 이미 설정됨).
Idempotent: 재실행 안전 (IF NOT EXISTS / CREATE OR REPLACE).
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

print("\n[1/5] notifications 테이블")
cur.execute("""
create table if not exists public.notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  type text not null default 'comment',
  actor_id uuid references public.profiles(id) on delete set null,
  post_id uuid references public.posts(id) on delete cascade,
  comment_id uuid references public.comments(id) on delete cascade,
  read_at timestamptz,
  created_at timestamptz not null default now()
);
""")
print("  ok")

print("\n[2/5] 인덱스 (미읽음 조회 + 정렬)")
cur.execute("""
create index if not exists idx_notifications_user_created
  on public.notifications (user_id, created_at desc);
""")
cur.execute("""
create index if not exists idx_notifications_user_unread
  on public.notifications (user_id, read_at)
  where read_at is null;
""")
print("  ok")

print("\n[3/5] RLS 활성화 + 정책")
cur.execute("alter table public.notifications enable row level security;")
cur.execute("drop policy if exists notifications_select_own on public.notifications;")
cur.execute("""
create policy notifications_select_own on public.notifications
  for select using (auth.uid() = user_id);
""")
cur.execute("drop policy if exists notifications_update_own on public.notifications;")
cur.execute("""
create policy notifications_update_own on public.notifications
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
""")
# INSERT 은 트리거(security definer)로만. 유저 직접 INSERT 차단 (정책 없음 = deny).
print("  ok")

print("\n[4/5] 댓글 INSERT 트리거 (원본 글 작성자에게 notification)")
cur.execute("""
create or replace function public.tg_comments_notify()
returns trigger language plpgsql security definer as $$
declare
  v_post_owner uuid;
begin
  -- 원본 글 작성자 조회
  select user_id into v_post_owner from public.posts where id = new.post_id;
  -- 본인이 자기 글에 댓글 = skip, 글 삭제됨 = skip
  if v_post_owner is null then return null; end if;
  if v_post_owner = new.user_id then return null; end if;
  -- notification 삽입
  insert into public.notifications (user_id, type, actor_id, post_id, comment_id)
  values (v_post_owner, 'comment', new.user_id, new.post_id, new.id);
  return null;
end;
$$;
""")
cur.execute("drop trigger if exists tg_comments_notify on public.comments;")
cur.execute("""
create trigger tg_comments_notify
  after insert on public.comments
  for each row execute function public.tg_comments_notify();
""")
print("  ok")

print("\n[5/5] PostgREST schema cache 재로드")
cur.execute("notify pgrst, 'reload schema';")
print("  ok")

# 검증
print("\n[검증]")
cur.execute("select count(*) from public.notifications;")
print(f"  notifications rows: {cur.fetchone()[0]}")
cur.execute("select tgname from pg_trigger where tgname = 'tg_comments_notify';")
r = cur.fetchone()
print(f"  트리거 존재: {r[0] if r else '없음'}")
cur.execute("""
select count(*) from pg_indexes
where schemaname='public' and tablename='notifications';
""")
print(f"  인덱스 개수: {cur.fetchone()[0]}")

cur.close()
conn.close()
print("\n[done] 알림 시스템 인프라 준비 완료. 이제 신규 댓글이 원본 글 작성자에게 notification 자동 발생.")
