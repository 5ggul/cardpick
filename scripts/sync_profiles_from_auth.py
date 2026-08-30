"""프로필 sync — auth.users.raw_user_meta_data → profiles (2026-08-30)

배경:
- handle_new_user() 트리거가 최초 로그인만 avatar_url 저장 → 이후 Google
  프로필 사진 바꿔도 profiles.avatar_url stale.
- auth.js 는 이번 커밋으로 SIGNED_IN 마다 자동 sync 추가되나, 기존
  로그인 사용자 (재로그인 안 한 유저) 는 여전히 stale.

이 스크립트: 전 유저 avatar_url + display_name 을 auth.users 최신
metadata 로 즉시 반영 (nickname 은 절대 건드리지 않음).

실행 방법:
    set SUPABASE_DB_PASSWORD=<비밀번호>
    python scripts/sync_profiles_from_auth.py

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

# 사전 카운트
cur.execute("select count(*) from public.profiles;")
total = cur.fetchone()[0]
print(f"\n[사전] 전체 profiles: {total}")

# stale 인 유저 조회 (auth 최신 avatar_url != profiles.avatar_url)
print("\n[sync] avatar_url + display_name 갱신 (nickname 유지)")
cur.execute("""
with fresh as (
  select
    u.id,
    coalesce(u.raw_user_meta_data->>'avatar_url', u.raw_user_meta_data->>'picture') as avatar_url,
    coalesce(u.raw_user_meta_data->>'name', u.raw_user_meta_data->>'full_name') as display_name
  from auth.users u
)
update public.profiles p set
  avatar_url = coalesce(f.avatar_url, p.avatar_url),
  display_name = coalesce(f.display_name, p.display_name)
from fresh f
where p.id = f.id
  and (
    (f.avatar_url is not null and f.avatar_url is distinct from p.avatar_url)
    or (f.display_name is not null and f.display_name is distinct from p.display_name)
  );
""")
updated = cur.rowcount
print(f"  updated rows: {updated}")

# 트리거 개선: handle_new_user 를 upsert 형태로 (재로그인 시 metadata 갱신)
# 기존 트리거는 auth.users insert on 만 fire. Supabase는 로그인마다 raw_user_meta_data 를 update
# 하므로 update trigger 추가로 근본 해결.
print("\n[트리거] handle_user_meta_update 신설 (auth.users UPDATE 시 profiles sync)")
cur.execute("""
create or replace function public.handle_user_meta_update()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  new_avatar text;
  new_name text;
begin
  new_avatar := coalesce(new.raw_user_meta_data->>'avatar_url', new.raw_user_meta_data->>'picture');
  new_name := coalesce(new.raw_user_meta_data->>'name', new.raw_user_meta_data->>'full_name');
  update public.profiles set
    avatar_url = coalesce(new_avatar, avatar_url),
    display_name = coalesce(new_name, display_name)
  where id = new.id
    and (
      (new_avatar is not null and new_avatar is distinct from avatar_url)
      or (new_name is not null and new_name is distinct from display_name)
    );
  return new;
end $$;
""")
cur.execute("drop trigger if exists on_auth_user_meta_update on auth.users;")
cur.execute("""
create trigger on_auth_user_meta_update
  after update of raw_user_meta_data on auth.users
  for each row execute function public.handle_user_meta_update();
""")
print("  ok")

# 검증
print("\n[검증] 최근 5명 profiles.avatar_url")
cur.execute("""
select p.id, p.nickname, p.display_name, substring(p.avatar_url from 1 for 60) as avatar
from public.profiles p
order by p.created_at desc limit 5;
""")
for r in cur.fetchall():
    print(f"  {str(r[0])[:14]}...  nick={r[1] or '-':10s}  name={r[2] or '-':16s}  {r[3] or '-'}")

cur.close(); conn.close()
print("\n[done] 프로필 sync 완료. 이후 auth.users metadata 변경 시 트리거로 자동 sync.")
