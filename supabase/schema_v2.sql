-- 카드픽 — Supabase 스키마 v2 (Phase 2: 관심 카드 · 알림 · 게시판)

-- ============================================================
-- 1) watchlist — 관심 카드
-- ============================================================
create table if not exists public.watchlist (
  user_id uuid not null references auth.users(id) on delete cascade,
  card_slug text not null,
  card_name text,
  card_set text,
  game text,
  created_at timestamptz default now(),
  primary key (user_id, card_slug)
);
create index if not exists watchlist_user_created_idx on public.watchlist(user_id, created_at desc);
alter table public.watchlist enable row level security;
drop policy if exists "watchlist_select_own" on public.watchlist;
create policy "watchlist_select_own" on public.watchlist for select using (auth.uid() = user_id);
drop policy if exists "watchlist_insert_own" on public.watchlist;
create policy "watchlist_insert_own" on public.watchlist for insert with check (auth.uid() = user_id);
drop policy if exists "watchlist_delete_own" on public.watchlist;
create policy "watchlist_delete_own" on public.watchlist for delete using (auth.uid() = user_id);

-- ============================================================
-- 2) price_alerts — 가격 알림 구독
-- ============================================================
create table if not exists public.price_alerts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  card_slug text not null,
  card_name text,
  threshold_pct numeric default 5.0,
  direction text default 'both' check (direction in ('above','below','both')),
  active boolean default true,
  created_at timestamptz default now(),
  unique (user_id, card_slug)
);
create index if not exists alerts_user_idx on public.price_alerts(user_id);
alter table public.price_alerts enable row level security;
drop policy if exists "alerts_select_own" on public.price_alerts;
create policy "alerts_select_own" on public.price_alerts for select using (auth.uid() = user_id);
drop policy if exists "alerts_insert_own" on public.price_alerts;
create policy "alerts_insert_own" on public.price_alerts for insert with check (auth.uid() = user_id);
drop policy if exists "alerts_update_own" on public.price_alerts;
create policy "alerts_update_own" on public.price_alerts for update using (auth.uid() = user_id);
drop policy if exists "alerts_delete_own" on public.price_alerts;
create policy "alerts_delete_own" on public.price_alerts for delete using (auth.uid() = user_id);

-- ============================================================
-- 3) posts — 게시글
-- ============================================================
create table if not exists public.posts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  board text not null default 'free' check (board in ('free','qna','trade','meta','show')),
  title text not null check (char_length(title) between 1 and 120),
  body text not null check (char_length(body) between 1 and 20000),
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  views int default 0,
  likes int default 0,
  comments_count int default 0
);
create index if not exists posts_board_created_idx on public.posts(board, created_at desc);
create index if not exists posts_user_idx on public.posts(user_id, created_at desc);
alter table public.posts enable row level security;
drop policy if exists "posts_select_all" on public.posts;
create policy "posts_select_all" on public.posts for select using (true);
drop policy if exists "posts_insert_own" on public.posts;
create policy "posts_insert_own" on public.posts for insert with check (auth.uid() = user_id);
drop policy if exists "posts_update_own" on public.posts;
create policy "posts_update_own" on public.posts for update using (auth.uid() = user_id);
drop policy if exists "posts_delete_own" on public.posts;
create policy "posts_delete_own" on public.posts for delete using (auth.uid() = user_id);

-- updated_at 자동 갱신
drop trigger if exists posts_set_updated_at on public.posts;
create trigger posts_set_updated_at
  before update on public.posts
  for each row execute function public.tg_set_updated_at();

-- ============================================================
-- 4) comments
-- ============================================================
create table if not exists public.comments (
  id uuid primary key default gen_random_uuid(),
  post_id uuid not null references public.posts(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  body text not null check (char_length(body) between 1 and 4000),
  created_at timestamptz default now()
);
create index if not exists comments_post_idx on public.comments(post_id, created_at);
create index if not exists comments_user_idx on public.comments(user_id, created_at desc);
alter table public.comments enable row level security;
drop policy if exists "comments_select_all" on public.comments;
create policy "comments_select_all" on public.comments for select using (true);
drop policy if exists "comments_insert_own" on public.comments;
create policy "comments_insert_own" on public.comments for insert with check (auth.uid() = user_id);
drop policy if exists "comments_update_own" on public.comments;
create policy "comments_update_own" on public.comments for update using (auth.uid() = user_id);
drop policy if exists "comments_delete_own" on public.comments;
create policy "comments_delete_own" on public.comments for delete using (auth.uid() = user_id);

-- ============================================================
-- 5) post_likes
-- ============================================================
create table if not exists public.post_likes (
  user_id uuid not null references auth.users(id) on delete cascade,
  post_id uuid not null references public.posts(id) on delete cascade,
  created_at timestamptz default now(),
  primary key (user_id, post_id)
);
create index if not exists likes_post_idx on public.post_likes(post_id);
alter table public.post_likes enable row level security;
drop policy if exists "likes_select_all" on public.post_likes;
create policy "likes_select_all" on public.post_likes for select using (true);
drop policy if exists "likes_insert_own" on public.post_likes;
create policy "likes_insert_own" on public.post_likes for insert with check (auth.uid() = user_id);
drop policy if exists "likes_delete_own" on public.post_likes;
create policy "likes_delete_own" on public.post_likes for delete using (auth.uid() = user_id);

-- ============================================================
-- 6) 카운터 트리거
-- ============================================================
create or replace function public.tg_posts_comments_count()
returns trigger language plpgsql as $$
begin
  if (TG_OP = 'INSERT') then
    update public.posts set comments_count = comments_count + 1 where id = new.post_id;
  elsif (TG_OP = 'DELETE') then
    update public.posts set comments_count = greatest(comments_count - 1, 0) where id = old.post_id;
  end if;
  return null;
end $$;
drop trigger if exists tg_comments_count on public.comments;
create trigger tg_comments_count after insert or delete on public.comments
  for each row execute function public.tg_posts_comments_count();

create or replace function public.tg_posts_likes_count()
returns trigger language plpgsql as $$
begin
  if (TG_OP = 'INSERT') then
    update public.posts set likes = likes + 1 where id = new.post_id;
  elsif (TG_OP = 'DELETE') then
    update public.posts set likes = greatest(likes - 1, 0) where id = old.post_id;
  end if;
  return null;
end $$;
drop trigger if exists tg_likes_count on public.post_likes;
create trigger tg_likes_count after insert or delete on public.post_likes
  for each row execute function public.tg_posts_likes_count();

-- ============================================================
-- 확인
--   select count(*) from public.watchlist;
--   select count(*) from public.posts;
-- ============================================================
