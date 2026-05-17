-- 카드픽 — Supabase 스키마 (Phase 1: profiles)
-- 실행 방법:
--   1. https://supabase.com/dashboard/project/adhjwyiwajgsaryxkomw/sql/new 접속
--   2. 이 파일 내용 전체 복붙
--   3. 우측 상단 Run 클릭

-- ============================================================
-- profiles 테이블 — Google 로그인 사용자 정보 + 닉네임
-- ============================================================
create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  nickname text unique,
  display_name text,
  avatar_url text,
  bio text,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

-- RLS 활성화
alter table public.profiles enable row level security;

-- 정책 1: 누구나 닉네임·아바타 등 공개 정보 조회 가능
drop policy if exists "profiles_select_all" on public.profiles;
create policy "profiles_select_all" on public.profiles
  for select using (true);

-- 정책 2: 본인만 자기 프로필 INSERT/UPDATE 가능
drop policy if exists "profiles_insert_own" on public.profiles;
create policy "profiles_insert_own" on public.profiles
  for insert with check (auth.uid() = id);

drop policy if exists "profiles_update_own" on public.profiles;
create policy "profiles_update_own" on public.profiles
  for update using (auth.uid() = id);

-- updated_at 자동 갱신 트리거
create or replace function public.tg_set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end $$;

drop trigger if exists profiles_set_updated_at on public.profiles;
create trigger profiles_set_updated_at
  before update on public.profiles
  for each row execute function public.tg_set_updated_at();

-- 닉네임 중복 체크용 인덱스 (이미 unique지만 빠른 조회용)
create index if not exists profiles_nickname_idx on public.profiles(nickname);

-- ============================================================
-- Google 로그인 시 자동으로 profiles row 생성
-- ============================================================
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, display_name, avatar_url)
  values (
    new.id,
    coalesce(new.raw_user_meta_data->>'name', new.raw_user_meta_data->>'full_name', split_part(new.email, '@', 1)),
    new.raw_user_meta_data->>'avatar_url'
  )
  on conflict (id) do nothing;
  return new;
end $$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ============================================================
-- 완료 안내
-- ============================================================
-- 실행 후 확인:
--   select * from public.profiles;
-- 기존 사용자(이미 로그인한 본인) 자동 row 생성:
--   insert into public.profiles (id, display_name, avatar_url)
--   select id, coalesce(raw_user_meta_data->>'name', raw_user_meta_data->>'full_name'), raw_user_meta_data->>'avatar_url'
--   from auth.users
--   on conflict (id) do nothing;
