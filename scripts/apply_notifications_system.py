"""CardPick 알림 인프라 v5.

- 웹 알림: 댓글 / 답글 / 가격 알림
- 앱 푸시 연결: 로그인 사용자 ↔ FCM device token
- comments.parent_comment_id로 답글 지원
- 알림별 push 발송 상태 저장

Idempotent. GitHub Actions workflow_dispatch 또는 push 시 실행된다.
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

print("\n[1/7] notifications 확장")
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
alter table public.notifications add column if not exists card_slug text;
alter table public.notifications add column if not exists metadata jsonb not null default '{}'::jsonb;
alter table public.notifications add column if not exists push_sent_at timestamptz;
alter table public.notifications add column if not exists push_attempted_at timestamptz;
alter table public.notifications add column if not exists push_attempts integer not null default 0;
alter table public.notifications add column if not exists push_error text;
""")
print("  ok")

print("\n[2/7] comments 답글 컬럼")
cur.execute("""
alter table public.comments
  add column if not exists parent_comment_id uuid references public.comments(id) on delete set null;
create index if not exists idx_comments_parent on public.comments(parent_comment_id)
  where parent_comment_id is not null;
""")
print("  ok")

print("\n[3/7] push_devices")
cur.execute("""
create table if not exists public.push_devices (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  token text not null unique,
  platform text not null default 'android' check (platform in ('android','ios','web')),
  app_version text,
  enabled boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now()
);
create index if not exists idx_push_devices_user_enabled
  on public.push_devices(user_id, enabled);
alter table public.push_devices enable row level security;

drop policy if exists push_devices_select_own on public.push_devices;
create policy push_devices_select_own on public.push_devices
  for select using (auth.uid() = user_id);
drop policy if exists push_devices_insert_own on public.push_devices;
create policy push_devices_insert_own on public.push_devices
  for insert with check (auth.uid() = user_id);
drop policy if exists push_devices_update_own on public.push_devices;
create policy push_devices_update_own on public.push_devices
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
drop policy if exists push_devices_delete_own on public.push_devices;
create policy push_devices_delete_own on public.push_devices
  for delete using (auth.uid() = user_id);
grant select, insert, update, delete on public.push_devices to authenticated;
""")
print("  ok")

print("\n[4/7] 앱 기기 등록 RPC")
cur.execute("""
create or replace function public.register_push_device(
  p_token text,
  p_platform text default 'android',
  p_app_version text default null
) returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    raise exception 'authentication required';
  end if;
  if p_token is null or length(trim(p_token)) < 20 then
    raise exception 'invalid push token';
  end if;
  insert into public.push_devices(user_id, token, platform, app_version, enabled, updated_at, last_seen_at)
  values (auth.uid(), trim(p_token), coalesce(nullif(p_platform,''),'android'), p_app_version, true, now(), now())
  on conflict (token) do update
    set user_id = excluded.user_id,
        platform = excluded.platform,
        app_version = excluded.app_version,
        enabled = true,
        updated_at = now(),
        last_seen_at = now();
end;
$$;

create or replace function public.unregister_push_device(p_token text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    raise exception 'authentication required';
  end if;
  update public.push_devices
     set enabled=false, updated_at=now()
   where user_id=auth.uid() and token=p_token;
end;
$$;

grant execute on function public.register_push_device(text,text,text) to authenticated;
grant execute on function public.unregister_push_device(text) to authenticated;
""")
print("  ok")

print("\n[5/7] 알림 RLS + 인덱스")
cur.execute("""
create index if not exists idx_notifications_user_created
  on public.notifications (user_id, created_at desc);
create index if not exists idx_notifications_user_unread
  on public.notifications (user_id, read_at)
  where read_at is null;
create index if not exists idx_notifications_push_pending
  on public.notifications (created_at)
  where push_sent_at is null;
alter table public.notifications enable row level security;
drop policy if exists notifications_select_own on public.notifications;
create policy notifications_select_own on public.notifications
  for select using (auth.uid() = user_id);
drop policy if exists notifications_update_own on public.notifications;
create policy notifications_update_own on public.notifications
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
""")
print("  ok")

print("\n[6/7] 댓글/답글 알림 트리거")
cur.execute("""
create or replace function public.tg_comments_notify()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_post_owner uuid;
  v_parent_owner uuid;
begin
  select user_id into v_post_owner from public.posts where id = new.post_id;

  if new.parent_comment_id is not null then
    select user_id into v_parent_owner
      from public.comments
     where id = new.parent_comment_id
       and post_id = new.post_id;
  end if;

  -- 답글 대상 작성자에게 우선 알림
  if v_parent_owner is not null and v_parent_owner <> new.user_id then
    insert into public.notifications(user_id, type, actor_id, post_id, comment_id, metadata)
    values (
      v_parent_owner,
      'reply',
      new.user_id,
      new.post_id,
      new.id,
      jsonb_build_object('parent_comment_id', new.parent_comment_id)
    );
  end if;

  -- 원글 작성자에게 댓글 알림. 같은 사람이 답글 알림도 받는 경우 중복 방지.
  if v_post_owner is not null
     and v_post_owner <> new.user_id
     and (v_parent_owner is null or v_post_owner <> v_parent_owner) then
    insert into public.notifications(user_id, type, actor_id, post_id, comment_id)
    values (v_post_owner, 'comment', new.user_id, new.post_id, new.id);
  end if;

  return null;
end;
$$;
drop trigger if exists tg_comments_notify on public.comments;
create trigger tg_comments_notify
  after insert on public.comments
  for each row execute function public.tg_comments_notify();
""")
print("  ok")

print("\n[7/7] PostgREST schema cache reload")
cur.execute("notify pgrst, 'reload schema';")
print("  ok")

print("\n[검증]")
cur.execute("select count(*) from public.notifications;")
print(f"  notifications rows: {cur.fetchone()[0]}")
cur.execute("select count(*) from public.push_devices;")
print(f"  push devices: {cur.fetchone()[0]}")
cur.execute("select tgname from pg_trigger where tgname='tg_comments_notify';")
print(f"  trigger: {cur.fetchone()[0] if cur.rowcount else 'missing'}")

cur.close()
conn.close()
print("\n[done] CardPick v5 notification DB ready")
