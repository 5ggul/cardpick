#!/usr/bin/env python3
"""?ㅻ뒛???レ뭅??怨꾩궛 (Pokemon MVP)
?먯닔 = 7??蹂?붿쑉(35) + 寃?됰웾 利앷?(30) + ?낅뜲?댄듃 ?붿껌(15) + ?좉퇋 ?명듃(10) + ?댁쁺??10)"""
import os, sys, psycopg2
from datetime import date

PG = dict(
    host=os.environ.get("SUPABASE_DB_HOST", "aws-1-ap-northeast-2.pooler.supabase.com"),
    port=int(os.environ.get("SUPABASE_DB_PORT", "6543")),
    user=os.environ.get("SUPABASE_DB_USER", "postgres.aqxrmdratnkffvivguqs"),
    password=os.environ.get("SUPABASE_DB_PASSWORD"),
    dbname="postgres", sslmode="require", connect_timeout=30,
)
if not PG["password"]:
    print("ERR: SUPABASE_DB_PASSWORD"); sys.exit(1)

conn = psycopg2.connect(**PG); conn.autocommit = True; cur = conn.cursor()
cur.execute("set statement_timeout = 0")

# ?쒖옉 濡쒓렇
cur.execute("""insert into api_update_logs (source, job_name, status, started_at)
               values ('hot_cards','daily','started', now()) returning id""")
job_id = cur.fetchone()[0]

today = date.today()

# 1) ?ㅻ뒛 hot_cards 珥덇린??
cur.execute("delete from hot_cards where date = %s", (today,))

# 2) ?꾨낫 移대뱶 ?먯닔 怨꾩궛 (Pokemon留?
# ??Trust Gate v1: trust_level=NONE 移대뱶 ?쒖쇅 (??52 ?ш퀬 ?덈갑 ???좊ː??NONE 移대뱶媛 hot 紐⑸줉???쇰㈃ ????
# card_price_trust MV媛 ?놁쑝硫?fallback (null ???듦낵) ??MV 泥?cron ???덉쟾留?
# Fix A+B+E (2026-05-24): 표본 부족 카드 / 신규 14일 이내 / Cardmarket 부호 충돌 제외
#   A: distinct_7d >= 5 AND distinct_30d >= 10 — 거짓 급등 (samples_7d=1~2) 차단
#   B: created_at >= 14 days ago — 발매 직후 첫 가격 outlier로 인한 +300%+ 차단
#   E: Cardmarket avg7 vs avg30 부호와 TCGplayer 7d 부호가 반대면 노이즈로 간주, hot 제외
cur.execute("""
with priced as (
  select c.slug, c.game, c.name, c.set_name, b.change_7d_pct, b.change_14d_pct, b.change_30d_pct, b.latest_krw, b.samples_7d
  from cards c
  join card_price_summary_best b on b.card_slug = c.slug
  left join card_price_trust t on t.card_slug = c.slug
  left join card_movement_cardmarket m on m.card_slug = c.slug
  where c.game = 'pokemon'
    and coalesce(t.display_krw, b.latest_krw) >= 3000
    and lower(coalesce(c.rarity_class, '')) not in ('common','uncommon')
    and (t.trust_level is not null and t.trust_level != 'NONE' and t.display_krw is not null)
    -- Fix A: 표본 부족 카드 제외 (top 카테고리 한정 — 신뢰 가능 변동률만)
    and coalesce(t.distinct_7d, 0) >= 5
    and coalesce(t.distinct_30d, 0) >= 10
    -- Fix B: 신규 카드 14일 이내 제외 (발매 직후 first-price outlier 차단)
    and c.created_at < now() - interval '14 days'
    -- Fix E: TCGplayer 7d 부호와 Cardmarket 7d-vs-30d 부호가 반대면 제외 (출처간 모순 = 노이즈)
    --       (Cardmarket 데이터 없으면 통과 — left join이라 null OK)
    and (m.change_7d_vs_30d_pct is null
         or b.change_7d_pct is null
         or sign(m.change_7d_vs_30d_pct) = sign(b.change_7d_pct)
         or sign(m.change_7d_vs_30d_pct) = 0
         or sign(b.change_7d_pct) = 0)
),
search_score as (
  select matched_slug, count(*) as cnt from card_search_logs
  where created_at > now() - interval '7 days' and matched_slug is not null group by matched_slug
),
request_score as (
  select card_slug, request_count from price_update_requests
),
scored as (
  select p.slug, p.game, p.name, p.set_name, p.change_7d_pct, p.change_14d_pct, p.change_30d_pct, p.latest_krw,
    -- 媛寃?蹂???먯닔 (35??留뚯젏): |7d change| 湲곕컲
    least(35, abs(coalesce(p.change_7d_pct, 0)) * 2.0) as price_change_score,
    -- 寃???먯닔 (30??
    least(30, coalesce(s.cnt, 0) * 0.5) as search_score,
    -- ?낅뜲?댄듃 ?붿껌 (15??
    least(15, coalesce(r.request_count, 0) * 1.5) as request_score,
    -- ?좉퇋 ?명듃 (10?? ??30???대궡 ??移대뱶
    case when exists (select 1 from cards c2 where c2.slug=p.slug and c2.created_at > now() - interval '30 days') then 10 else 0 end as new_release_score,
    -- ?댁쁺??(10??
    coalesce((select editor_score from cards c2 where c2.slug=p.slug), 0) * 10 as editor_score
  from priced p
  left join search_score s on s.matched_slug = p.slug
  left join request_score r on r.card_slug = p.slug
),
final as (
  select *,
    (price_change_score + search_score + request_score + new_release_score + editor_score) as hot_score
  from scored
)
select slug, game, name, hot_score, price_change_score, search_score, request_score, new_release_score, editor_score,
       change_7d_pct, change_30d_pct
from final
where hot_score > 0
order by hot_score desc
limit 200
""")
candidates = cur.fetchall()
print(f"candidates: {len(candidates)}")

# 3) 移댄뀒怨좊━蹂?TOP 10 ???
# (a) 'top' ??Pokemon TOP 10 (hot_score 湲곗?)
top10 = candidates[:10]
for rank, c in enumerate(top10, 1):
    cur.execute("""insert into hot_cards (date, card_slug, game, category, rank, hot_score,
                     price_change_score, search_score, request_score, new_release_score, editor_score, reason)
                   values (%s, %s, 'pokemon', 'top', %s, %s, %s, %s, %s, %s, %s, %s)
                   on conflict (date, game, category, rank) do update set
                     card_slug=excluded.card_slug, hot_score=excluded.hot_score, reason=excluded.reason""",
                (today, c[0], rank, c[3], c[4], c[5], c[6], c[7], c[8],
                 f"7d {float(c[9] or 0):+.1f}% 쨌 score {float(c[3]):.1f}"))

# (b) 'rising_7d' ??7??湲됰벑 TOP 10 (Cardmarket avg7 vs avg30)
# movement view ?먯껜媛 7??30???됯퇏 鍮꾧탳??samples 蹂꾨룄 寃利?遺덊븘??
cur.execute("""
    -- Fix B (2026-05-24): 신규 카드 14일 이내 제외 + distinct 표본 게이트
    select m.card_slug, m.change_7d_vs_30d_pct, m.name
    from card_movement_cardmarket m
    join cards c on c.slug = m.card_slug
    join card_price_summary_best b on b.card_slug = m.card_slug
    left join card_price_trust t on t.card_slug = m.card_slug
    where m.change_7d_vs_30d_pct > 5
      and t.display_krw is not null
      and t.display_krw >= 3000
      and lower(coalesce(c.rarity_class, '')) not in ('common','uncommon')
      and (t.trust_level is not null and t.trust_level != 'NONE' and t.display_krw is not null)
      and coalesce(t.distinct_30d, 0) >= 10
      and c.created_at < now() - interval '14 days'
    order by m.change_7d_vs_30d_pct desc limit 10
""")
for rank, r in enumerate(cur.fetchall(), 1):
    cur.execute("""insert into hot_cards (date, card_slug, game, category, rank, hot_score, reason)
                   values (%s, %s, 'pokemon', 'rising_7d', %s, %s, %s)
                   on conflict (date, game, category, rank) do update set
                     card_slug=excluded.card_slug, hot_score=excluded.hot_score, reason=excluded.reason""",
                (today, r[0], rank, float(r[1] or 0), f"7d {float(r[1] or 0):+.1f}% (Cardmarket)"))

# (c) 'rising_30d' ??30??愿??TOP 10 (?덉쭏 寃뚯씠??+ change_30d_pct null ?쒖쇅)
cur.execute("""
    -- Fix B (2026-05-24): 신규 카드 14일 이내 제외 + distinct 표본 게이트
    select c.slug, b.change_30d_pct from cards c
    join card_price_summary_best b on b.card_slug=c.slug
    left join card_price_trust t on t.card_slug = c.slug
    where c.game='pokemon'
      and b.change_30d_pct is not null
      and t.display_krw is not null
      and t.display_krw >= 3000
      and lower(coalesce(c.rarity_class, '')) not in ('common','uncommon')
      and (t.trust_level is not null and t.trust_level != 'NONE' and t.display_krw is not null)
      and coalesce(t.distinct_30d, 0) >= 10
      and c.created_at < now() - interval '14 days'
    order by abs(b.change_30d_pct) desc limit 10
""")
for rank, r in enumerate(cur.fetchall(), 1):
    cur.execute("""insert into hot_cards (date, card_slug, game, category, rank, hot_score, reason)
                   values (%s, %s, 'pokemon', 'rising_30d', %s, %s, %s)
                   on conflict (date, game, category, rank) do update set
                     card_slug=excluded.card_slug, hot_score=excluded.hot_score, reason=excluded.reason""",
                (today, r[0], rank, float(r[1] or 0), f"30d {float(r[1] or 0):+.1f}%"))

# (d) 'search_surge' ??理쒓렐 寃?됰웾 湲됱쬆
cur.execute("""
    select matched_slug, count(*) as cnt from card_search_logs
    where matched_slug is not null and created_at > now() - interval '3 days'
    group by matched_slug order by cnt desc limit 10
""")
for rank, r in enumerate(cur.fetchall(), 1):
    cur.execute("""insert into hot_cards (date, card_slug, game, category, rank, hot_score, reason)
                   values (%s, %s, 'pokemon', 'search_surge', %s, %s, %s)
                   on conflict (date, game, category, rank) do update set
                     card_slug=excluded.card_slug, hot_score=excluded.hot_score, reason=excluded.reason""",
                (today, r[0], rank, r[1], f"search {r[1]}"))

# (d-2) 'falling_7d' ??7???섎씫 TOP 10 (Cardmarket movement, ?뚯닔 蹂??
cur.execute("""
    select m.card_slug, m.change_7d_vs_30d_pct
    from card_movement_cardmarket m
    join cards c on c.slug = m.card_slug
    join card_price_summary_best b on b.card_slug = m.card_slug
    left join card_price_trust t on t.card_slug = m.card_slug
    where m.change_7d_vs_30d_pct < -5
      and t.display_krw is not null
      and t.display_krw >= 3000
      and lower(coalesce(c.rarity_class, '')) not in ('common','uncommon')
      and (t.trust_level is not null and t.trust_level != 'NONE' and t.display_krw is not null)
    order by m.change_7d_vs_30d_pct asc limit 10
""")
for rank, r in enumerate(cur.fetchall(), 1):
    cur.execute("""insert into hot_cards (date, card_slug, game, category, rank, hot_score, reason)
                   values (%s, %s, 'pokemon', 'falling_7d', %s, %s, %s)
                   on conflict (date, game, category, rank) do update set
                     card_slug=excluded.card_slug, hot_score=excluded.hot_score, reason=excluded.reason""",
                (today, r[0], rank, float(r[1] or 0), f"7d {float(r[1] or 0):+.1f}% (Cardmarket)"))

# (d-3) 'high_value' ??怨좉? 移대뱶 TOP 10 (latest_krw ?곸쐞)
cur.execute("""
    select c.slug, b.latest_krw
    from cards c
    join card_price_summary_best b on b.card_slug = c.slug
    left join card_price_trust t on t.card_slug = c.slug
    where c.game='pokemon'
      and coalesce(t.display_krw, b.latest_krw) > 0
      and lower(coalesce(c.rarity_class, '')) not in ('common','uncommon')
      and (t.trust_level is not null and t.trust_level != 'NONE' and t.display_krw is not null)
    order by coalesce(t.display_krw, b.latest_krw) desc limit 10
""")
for rank, r in enumerate(cur.fetchall(), 1):
    cur.execute("""insert into hot_cards (date, card_slug, game, category, rank, hot_score, reason)
                   values (%s, %s, 'pokemon', 'high_value', %s, %s, %s)
                   on conflict (date, game, category, rank) do update set
                     card_slug=excluded.card_slug, hot_score=excluded.hot_score, reason=excluded.reason""",
                (today, r[0], rank, float(r[1] or 0), f"KRW {int(float(r[1])):,}"))

# (d-4) 'fresh' ???좉퇋 媛깆떊 (理쒓렐 7??fetched, krw ?곸쐞 ??媛깆떊 媛?쒗솕)
cur.execute("""
    select c.slug, b.latest_krw
    from cards c
    join card_price_summary_best b on b.card_slug = c.slug
    left join card_price_trust t on t.card_slug = c.slug
    where c.game='pokemon'
      and b.last_fetched_at > now() - interval '7 days'
      and t.display_krw is not null
      and t.display_krw >= 3000
      and lower(coalesce(c.rarity_class, '')) not in ('common','uncommon')
      and (t.trust_level is not null and t.trust_level != 'NONE' and t.display_krw is not null)
    order by b.last_fetched_at desc, coalesce(t.display_krw, b.latest_krw) desc limit 10
""")
for rank, r in enumerate(cur.fetchall(), 1):
    cur.execute("""insert into hot_cards (date, card_slug, game, category, rank, hot_score, reason)
                   values (%s, %s, 'pokemon', 'fresh', %s, %s, %s)
                   on conflict (date, game, category, rank) do update set
                     card_slug=excluded.card_slug, hot_score=excluded.hot_score, reason=excluded.reason""",
                (today, r[0], rank, float(r[1] or 0), "理쒓렐 媛깆떊"))

# (e) 'requested' ???낅뜲?댄듃 ?붿껌 留롮? 移대뱶
cur.execute("""
    select card_slug, request_count from price_update_requests
    where status='pending' and card_slug is not null
    order by request_count desc, last_requested_at desc limit 10
""")
for rank, r in enumerate(cur.fetchall(), 1):
    cur.execute("""insert into hot_cards (date, card_slug, game, category, rank, hot_score, reason)
                   values (%s, %s, 'pokemon', 'requested', %s, %s, %s)
                   on conflict (date, game, category, rank) do update set
                     card_slug=excluded.card_slug, hot_score=excluded.hot_score, reason=excluded.reason""",
                (today, r[0], rank, r[1], f"request {r[1]}"))

cur.execute("update api_update_logs set status='completed', updated_count=(select count(*) from hot_cards where date=%s), finished_at=now() where id=%s",
            (today, job_id))

cur.execute("select category, count(*) from hot_cards where date=%s group by category", (today,))
for r in cur.fetchall(): print(f"  {r[0]:<15} {r[1]}")

cur.close(); conn.close()
print("DONE")
