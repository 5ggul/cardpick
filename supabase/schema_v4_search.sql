-- v4: 검색 보강 (한국어 alias, 세트 alias, 통합 search_text)
alter table public.cards add column if not exists name_ko text;
alter table public.cards add column if not exists aliases text[] default '{}';
alter table public.cards add column if not exists set_aliases text[] default '{}';
alter table public.cards drop column if exists search_text;
alter table public.cards add column if not exists search_text text;

-- 트리거: search_text 자동 채움
create or replace function public.tg_cards_search_text()
returns trigger language plpgsql as $$
begin
  new.search_text := lower(
    coalesce(new.name,'') || ' ' ||
    coalesce(new.name_en,'') || ' ' ||
    coalesce(new.name_ko,'') || ' ' ||
    coalesce(array_to_string(new.aliases, ' '), '') || ' ' ||
    coalesce(new.rarity_class,'') || ' ' ||
    coalesce(new.rarity,'') || ' ' ||
    coalesce(new.set_name,'') || ' ' ||
    coalesce(new.set_code,'') || ' ' ||
    coalesce(array_to_string(new.set_aliases, ' '), '') || ' ' ||
    coalesce(new.number,'') || ' ' ||
    coalesce(new.type,'')
  );
  return new;
end $$;

drop trigger if exists cards_search_text_trg on public.cards;
create trigger cards_search_text_trg
  before insert or update on public.cards
  for each row execute function public.tg_cards_search_text();

-- 기존 row 전부 갱신 (한 번)
update public.cards set name = name where search_text is null or search_text = '';

-- 인덱스
drop index if exists cards_search_text_trgm_idx;
create index cards_search_text_trgm_idx on public.cards using gin (search_text gin_trgm_ops);
create index if not exists cards_rarity_class_idx on public.cards(rarity_class);
