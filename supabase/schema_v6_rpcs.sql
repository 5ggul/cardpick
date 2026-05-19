-- v6 RPCs (Pokemon MVP)

-- log_price_update_request: anon이 호출 가능. card_slug 있으면 upsert + count++, 없으면 query만 저장
create or replace function public.log_price_update_request(
  p_query text,
  p_card_slug text default null
) returns void
language plpgsql
security definer
as $$
begin
  if p_card_slug is not null and exists (select 1 from cards where slug = p_card_slug) then
    insert into price_update_requests (card_slug, query, request_count, last_requested_at, status)
    values (p_card_slug, p_query, 1, now(), 'pending')
    on conflict (card_slug) do update set
      request_count = price_update_requests.request_count + 1,
      last_requested_at = now(),
      status = case when price_update_requests.status='done' then 'pending' else price_update_requests.status end;
  else
    insert into price_update_requests (card_slug, query, request_count, last_requested_at, status)
    values (null, p_query, 1, now(), 'pending');
  end if;
end;
$$;
grant execute on function public.log_price_update_request(text, text) to anon, authenticated;

-- hot_cards 페이지용 fetch (date 기본 = today, 카테고리별 묶음)
create or replace function public.get_hot_cards(p_date date default current_date)
returns table (
  category text, rank int, card_slug text, name text, set_name text, rarity_class text,
  hot_score numeric, reason text, latest_krw numeric, change_7d_pct numeric
)
language sql
security definer
as $$
  select h.category, h.rank, h.card_slug, c.name, c.set_name, c.rarity_class,
         h.hot_score, h.reason, b.latest_krw, b.change_7d_pct
  from hot_cards h
  join cards c on c.slug = h.card_slug
  left join card_price_summary_best b on b.card_slug = h.card_slug
  where h.date = coalesce(p_date, current_date) and h.game='pokemon'
  order by h.category, h.rank;
$$;
grant execute on function public.get_hot_cards(date) to anon, authenticated;
