-- 카드픽 — v3 스키마 (카드 카탈로그 + 가격)

-- ============================================================
-- 검색 인덱스 확장
-- ============================================================
create extension if not exists pg_trgm;

-- ============================================================
-- cards — 풀 카탈로그
-- ============================================================
create table if not exists public.cards (
  slug text primary key,
  external_id text unique,           -- pokemontcg.io id 또는 apitcg id
  game text not null check (game in ('pokemon','onepiece')),
  name text not null,
  name_en text,
  name_ja text,
  set_name text,
  set_code text,
  set_id text,
  number text,
  rarity text,
  rarity_class text,                  -- SAR/SEC/UR/AR/PARALLEL 분류
  type text,
  artist text,
  released_at date,
  popularity_rank int default 999999,
  is_indexable boolean default false, -- §2 게이트
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);
create index if not exists cards_game_idx on public.cards(game);
create index if not exists cards_name_trgm_idx on public.cards using gin (name gin_trgm_ops);
create index if not exists cards_name_en_trgm_idx on public.cards using gin (name_en gin_trgm_ops);
create index if not exists cards_set_idx on public.cards(set_code, number);
create index if not exists cards_popularity_idx on public.cards(popularity_rank);
-- public read (검색 가능)
alter table public.cards enable row level security;
drop policy if exists "cards_select_all" on public.cards;
create policy "cards_select_all" on public.cards for select using (true);

-- updated_at 트리거
drop trigger if exists cards_set_updated_at on public.cards;
create trigger cards_set_updated_at before update on public.cards
  for each row execute function public.tg_set_updated_at();

-- ============================================================
-- prices — 시세 (시점별 스냅샷 + 최신)
-- ============================================================
create table if not exists public.prices (
  id bigserial primary key,
  card_slug text not null references public.cards(slug) on delete cascade,
  source text not null,               -- tcgplayer / cardmarket / ebay
  variant text,                       -- normal / holofoil / 1stEditionHolofoil 등
  currency text not null,             -- USD / EUR
  price_low numeric,
  price_mid numeric,
  price_market numeric,
  price_high numeric,
  price_krw numeric,                  -- KRW 환산값 (저장 시점 환율)
  exchange_rate numeric,
  fetched_at timestamptz default now()
);
create index if not exists prices_card_fetched_idx on public.prices(card_slug, fetched_at desc);
create index if not exists prices_card_source_idx on public.prices(card_slug, source, variant);
alter table public.prices enable row level security;
drop policy if exists "prices_select_all" on public.prices;
create policy "prices_select_all" on public.prices for select using (true);

-- ============================================================
-- price_latest — 최신 가격 빠른 조회용 view
-- ============================================================
create or replace view public.price_latest as
  select distinct on (card_slug, source, variant)
    card_slug, source, variant, currency,
    price_low, price_mid, price_market, price_high,
    price_krw, exchange_rate, fetched_at
  from public.prices
  order by card_slug, source, variant, fetched_at desc;

-- ============================================================
-- exchange_rates — 환율 캐시
-- ============================================================
create table if not exists public.exchange_rates (
  base text not null,
  target text not null,
  rate numeric not null,
  fetched_at timestamptz default now(),
  primary key (base, target, fetched_at)
);
alter table public.exchange_rates enable row level security;
drop policy if exists "rates_select_all" on public.exchange_rates;
create policy "rates_select_all" on public.exchange_rates for select using (true);
