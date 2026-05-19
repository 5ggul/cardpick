#!/usr/bin/env python3
"""오늘의 핫카드 계산 (Pokemon MVP)
점수 = 7일 변화율(35) + 검색량 증가(30) + 업데이트 요청(15) + 신규 세트(10) + 운영자(10)"""
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

# 시작 로그
cur.execute("""insert into api_update_logs (source, job_name, status, started_at)
               values ('hot_cards','daily','started', now()) returning id""")
job_id = cur.fetchone()[0]

today = date.today()

# 1) 오늘 hot_cards 초기화
cur.execute("delete from hot_cards where date = %s", (today,))

# 2) 후보 카드 점수 계산 (Pokemon만)
cur.execute("""
with priced as (
  select c.slug, c.game, c.name, c.set_name, b.change_7d_pct, b.change_14d_pct, b.change_30d_pct, b.latest_krw, b.samples_7d
  from cards c join card_price_summary_best b on b.card_slug = c.slug
  where c.game = 'pokemon'
    and b.latest_krw >= 3000
    and lower(coalesce(c.rarity_class, '')) not in ('common','uncommon')
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
    -- 가격 변동 점수 (35점 만점): |7d change| 기반
    least(35, abs(coalesce(p.change_7d_pct, 0)) * 2.0) as price_change_score,
    -- 검색 점수 (30점)
    least(30, coalesce(s.cnt, 0) * 0.5) as search_score,
    -- 업데이트 요청 (15점)
    least(15, coalesce(r.request_count, 0) * 1.5) as request_score,
    -- 신규 세트 (10점) — 30일 이내 새 카드
    case when exists (select 1 from cards c2 where c2.slug=p.slug and c2.created_at > now() - interval '30 days') then 10 else 0 end as new_release_score,
    -- 운영자 (10점)
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

# 3) 카테고리별 TOP 10 저장
# (a) 'top' — Pokemon TOP 10 (hot_score 기준)
top10 = candidates[:10]
for rank, c in enumerate(top10, 1):
    cur.execute("""insert into hot_cards (date, card_slug, game, category, rank, hot_score,
                     price_change_score, search_score, request_score, new_release_score, editor_score, reason)
                   values (%s, %s, 'pokemon', 'top', %s, %s, %s, %s, %s, %s, %s, %s)
                   on conflict (date, game, category, rank) do update set
                     card_slug=excluded.card_slug, hot_score=excluded.hot_score, reason=excluded.reason""",
                (today, c[0], rank, c[3], c[4], c[5], c[6], c[7], c[8],
                 f"7d {float(c[9] or 0):+.1f}% · score {float(c[3]):.1f}"))

# (b) 'rising_7d' — 7일 급등 TOP 10 (Cardmarket avg7 vs avg30, 품질 게이트 적용)
# 최소 ₩3,000 + Common/Uncommon 제외 + 표본 ≥ 2
cur.execute("""
    select m.card_slug, m.change_7d_vs_30d_pct, m.name
    from card_movement_cardmarket m
    join cards c on c.slug = m.card_slug
    join card_price_summary_best b on b.card_slug = m.card_slug
    where m.change_7d_vs_30d_pct > 5
      and b.latest_krw >= 3000
      and lower(coalesce(c.rarity_class, '')) not in ('common','uncommon')
      and coalesce(b.samples_7d, 0) >= 2
    order by m.change_7d_vs_30d_pct desc limit 10
""")
for rank, r in enumerate(cur.fetchall(), 1):
    cur.execute("""insert into hot_cards (date, card_slug, game, category, rank, hot_score, reason)
                   values (%s, %s, 'pokemon', 'rising_7d', %s, %s, %s)
                   on conflict (date, game, category, rank) do update set
                     card_slug=excluded.card_slug, hot_score=excluded.hot_score, reason=excluded.reason""",
                (today, r[0], rank, float(r[1] or 0), f"7d {float(r[1] or 0):+.1f}% (Cardmarket)"))

# (c) 'rising_30d' — 30일 관심 TOP 10 (품질 게이트 + change_30d_pct null 제외)
cur.execute("""
    select c.slug, b.change_30d_pct from cards c
    join card_price_summary_best b on b.card_slug=c.slug
    where c.game='pokemon'
      and b.change_30d_pct is not null
      and b.latest_krw >= 3000
      and lower(coalesce(c.rarity_class, '')) not in ('common','uncommon')
    order by abs(b.change_30d_pct) desc limit 10
""")
for rank, r in enumerate(cur.fetchall(), 1):
    cur.execute("""insert into hot_cards (date, card_slug, game, category, rank, hot_score, reason)
                   values (%s, %s, 'pokemon', 'rising_30d', %s, %s, %s)
                   on conflict (date, game, category, rank) do update set
                     card_slug=excluded.card_slug, hot_score=excluded.hot_score, reason=excluded.reason""",
                (today, r[0], rank, float(r[1] or 0), f"30d {float(r[1] or 0):+.1f}%"))

# (d) 'search_surge' — 최근 검색량 급증
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
                (today, r[0], rank, r[1], f"검색 {r[1]}회"))

# (e) 'requested' — 업데이트 요청 많은 카드
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
                (today, r[0], rank, r[1], f"요청 {r[1]}회"))

cur.execute("update api_update_logs set status='completed', updated_count=(select count(*) from hot_cards where date=%s), finished_at=now() where id=%s",
            (today, job_id))

cur.execute("select category, count(*) from hot_cards where date=%s group by category", (today,))
for r in cur.fetchall(): print(f"  {r[0]:<15} {r[1]}")

cur.close(); conn.close()
print("DONE")
