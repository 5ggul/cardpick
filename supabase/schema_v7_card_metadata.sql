-- Cardpick schema v7: Pokemon card metadata retained from pokemontcg.io.
-- Apply separately before running a metadata backfill. This file does not change RLS.

begin;

alter table public.cards
  add column if not exists hp integer,
  add column if not exists supertype text,
  add column if not exists subtypes text[] not null default '{}';

alter table public.cards
  drop constraint if exists cards_hp_nonnegative;

alter table public.cards
  add constraint cards_hp_nonnegative check (hp is null or hp >= 0);

comment on column public.cards.hp is 'Printed HP from pokemontcg.io. Null for non-Pokemon or unavailable cards.';
comment on column public.cards.supertype is 'pokemontcg.io supertype: Pokémon, Trainer, or Energy.';
comment on column public.cards.subtypes is 'pokemontcg.io subtype list, retained without translation.';

commit;
