-- Materialized View: card_price_summary
-- 가격 수집 cron 후 refresh_card_price_summary()로 갱신

drop materialized view if exists card_price_summary_best cascade;
drop materialized view if exists card_price_summary cascade;

create index if not exists idx_prices_slug_variant_date on prices (card_slug, variant, fetched_at) where source = 'tcgplayer';

create materialized view card_price_summary as
with daily as (
  select distinct on (p.card_slug, p.variant, p.fetched_at::date)
    p.card_slug, p.variant, p.fetched_at::date as day, p.price_krw, p.price_market as price_usd, p.fetched_at
  from prices p
  where p.source = 'tcgplayer' and p.price_krw is not null and p.price_krw > 0
  order by p.card_slug, p.variant, p.fetched_at::date, p.fetched_at desc
),
latest as (
  select distinct on (card_slug, variant)
    card_slug, variant, day as latest_day, fetched_at as last_fetched_at,
    price_krw as latest_krw, price_usd as latest_usd
  from daily order by card_slug, variant, day desc
),
prev_1 as (
  -- 어제 (1일 전) 가격 — latest_day - 1
  select distinct on (d.card_slug, d.variant)
    d.card_slug, d.variant, d.price_krw as base_krw
  from daily d
  join latest l on l.card_slug=d.card_slug and l.variant=d.variant
  where d.day < l.latest_day and d.day >= l.latest_day - 2
  order by d.card_slug, d.variant, d.day desc
),
base_7 as (
  select distinct on (card_slug, variant) card_slug, variant, price_krw as base_krw
  from daily where day > current_date - 7 order by card_slug, variant, day asc
),
base_14 as (
  select distinct on (card_slug, variant) card_slug, variant, price_krw as base_krw
  from daily where day > current_date - 14 order by card_slug, variant, day asc
),
base_30 as (
  select distinct on (card_slug, variant) card_slug, variant, price_krw as base_krw
  from daily where day > current_date - 30 order by card_slug, variant, day asc
),
stats as (
  select d.card_slug, d.variant,
    percentile_disc(0.5) within group (order by d.price_krw) filter (where d.day > current_date - 7)  as median_7d,
    percentile_disc(0.5) within group (order by d.price_krw) filter (where d.day > current_date - 14) as median_14d,
    percentile_disc(0.5) within group (order by d.price_krw) filter (where d.day > current_date - 30) as median_30d,
    avg(d.price_krw) filter (where d.day > current_date - 7)  as avg_7d,
    avg(d.price_krw) filter (where d.day > current_date - 14) as avg_14d,
    avg(d.price_krw) filter (where d.day > current_date - 30) as avg_30d,
    count(*) filter (where d.day > current_date - 7)  as samples_7d,
    count(*) filter (where d.day > current_date - 14) as samples_14d,
    count(*) filter (where d.day > current_date - 30) as samples_30d
  from daily d group by d.card_slug, d.variant
)
select
  l.card_slug, l.variant, l.last_fetched_at,
  l.latest_krw, l.latest_usd,
  s.median_7d::numeric  as median_7d,
  s.median_14d::numeric as median_14d,
  s.median_30d::numeric as median_30d,
  round(s.avg_7d)::numeric  as avg_7d,
  round(s.avg_14d)::numeric as avg_14d,
  round(s.avg_30d)::numeric as avg_30d,
  s.samples_7d, s.samples_14d, s.samples_30d,
  case when p1.base_krw  > 0 then round(((l.latest_krw - p1.base_krw)::numeric  / p1.base_krw)  * 100, 2) end as change_1d_pct,
  case when b7.base_krw  > 0 then round(((l.latest_krw - b7.base_krw)::numeric  / b7.base_krw)  * 100, 2) end as change_7d_pct,
  case when b14.base_krw > 0 then round(((l.latest_krw - b14.base_krw)::numeric / b14.base_krw) * 100, 2) end as change_14d_pct,
  case when b30.base_krw > 0 then round(((l.latest_krw - b30.base_krw)::numeric / b30.base_krw) * 100, 2) end as change_30d_pct
from latest l
left join stats   s   on s.card_slug=l.card_slug   and s.variant=l.variant
left join prev_1  p1  on p1.card_slug=l.card_slug  and p1.variant=l.variant
left join base_7  b7  on b7.card_slug=l.card_slug  and b7.variant=l.variant
left join base_14 b14 on b14.card_slug=l.card_slug and b14.variant=l.variant
left join base_30 b30 on b30.card_slug=l.card_slug and b30.variant=l.variant;

create unique index card_price_summary_pk on card_price_summary (card_slug, variant);
create index card_price_summary_slug on card_price_summary (card_slug);
grant select on card_price_summary to anon, authenticated;

create materialized view card_price_summary_best as
with pri as (
  select s.*,
    case s.variant
      when 'normal' then 1 when 'holofoil' then 2 when 'reverseHolofoil' then 3
      when 'unlimitedHolofoil' then 4 when '1stEditionHolofoil' then 5 when '1stEditionNormal' then 6
      else 9 end as v_rank
  from card_price_summary s
)
select distinct on (card_slug)
  card_slug, variant, last_fetched_at,
  latest_krw, latest_usd,
  median_7d, median_14d, median_30d,
  avg_7d, avg_14d, avg_30d,
  samples_7d, samples_14d, samples_30d,
  change_1d_pct, change_7d_pct, change_14d_pct, change_30d_pct
from pri order by card_slug, v_rank, samples_30d desc nulls last;

create unique index card_price_summary_best_pk on card_price_summary_best (card_slug);
grant select on card_price_summary_best to anon, authenticated;

create or replace function refresh_card_price_summary() returns void as $$
begin
  refresh materialized view concurrently card_price_summary;
  refresh materialized view concurrently card_price_summary_best;
end;
$$ language plpgsql security definer;
grant execute on function refresh_card_price_summary() to anon, authenticated;
