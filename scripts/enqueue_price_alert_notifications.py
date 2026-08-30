#!/usr/bin/env python3
"""활성 price_alerts를 평가해 CardPick notifications에 가격 알림을 적재한다.

실제 푸시 발송은 send_push_notifications.py가 담당한다.
같은 사용자/카드/날짜는 한 번만 적재한다.
"""
import json
import os
import sys
from datetime import datetime

import psycopg2

PG = dict(
    host=os.environ.get("SUPABASE_DB_HOST", "aws-1-ap-northeast-2.pooler.supabase.com"),
    port=int(os.environ.get("SUPABASE_DB_PORT", "6543")),
    user=os.environ.get("SUPABASE_DB_USER", "postgres.aqxrmdratnkffvivguqs"),
    password=os.environ.get("SUPABASE_DB_PASSWORD"),
    dbname="postgres",
    sslmode="require",
    connect_timeout=30,
)
if not PG["password"]:
    print("ERR: SUPABASE_DB_PASSWORD missing")
    sys.exit(1)


def main():
    print(f"=== enqueue price alerts {datetime.utcnow().isoformat()}Z ===")
    conn = psycopg2.connect(**PG)
    conn.autocommit = True
    cur = conn.cursor()

    cur.execute("""
      with subs as (
        select pa.user_id, pa.card_slug, pa.card_name,
               greatest(coalesce(pa.threshold_pct, 5), 0.1) as threshold_pct,
               coalesce(pa.direction, 'both') as direction
          from public.price_alerts pa
          join public.profiles pr on pr.id = pa.user_id
         where pa.active = true
      ),
      today_price as (
        select t.card_slug, t.display_krw, t.trust_level
          from public.card_price_trust t
         where t.display_krw is not null and t.display_krw > 0
      ),
      yesterday_price as (
        select p.card_slug, avg(p.price_krw) as yest_krw
          from public.prices p
         where p.fetched_at::date = (current_date - interval '1 day')::date
           and p.price_krw > 0
           and p.source in ('tcgplayer','pokemontcg-tcgplayer')
         group by p.card_slug
      ),
      candidates as (
        select s.user_id, s.card_slug, s.card_name, s.threshold_pct, s.direction,
               tp.display_krw as today_krw, tp.trust_level, yp.yest_krw,
               ((tp.display_krw - yp.yest_krw) / nullif(yp.yest_krw,0) * 100) as change_pct
          from subs s
          join today_price tp on tp.card_slug = s.card_slug
          join yesterday_price yp on yp.card_slug = s.card_slug
      )
      select user_id, card_slug, card_name, today_krw, yest_krw,
             change_pct, trust_level, threshold_pct, direction
        from candidates c
       where abs(c.change_pct) >= c.threshold_pct
         and (
           c.direction = 'both'
           or (c.direction = 'above' and c.change_pct > 0)
           or (c.direction = 'below' and c.change_pct < 0)
         )
         and not exists (
           select 1
             from public.notifications n
            where n.user_id = c.user_id
              and n.type = 'price_alert'
              and n.card_slug = c.card_slug
              and n.created_at::date = current_date
         )
       order by abs(c.change_pct) desc
       limit 500
    """)
    rows = cur.fetchall()
    print(f"price triggers: {len(rows)}")

    inserted = 0
    for row in rows:
        uid, slug, name, now_krw, prev_krw, change, trust, threshold, direction = row
        metadata = {
            "card_name": name or slug,
            "price_before": float(prev_krw or 0),
            "price_after": float(now_krw or 0),
            "change_pct": float(change or 0),
            "trust_level": trust,
            "threshold_pct": float(threshold or 0),
            "direction": direction,
        }
        cur.execute("""
          insert into public.notifications(user_id, type, card_slug, metadata)
          values (%s, 'price_alert', %s, %s::jsonb)
        """, (uid, slug, json.dumps(metadata, ensure_ascii=False)))
        inserted += 1

    cur.close()
    conn.close()
    print(f"enqueued: {inserted}")


if __name__ == '__main__':
    main()
