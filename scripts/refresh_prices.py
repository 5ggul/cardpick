#!/usr/bin/env python3
"""주기적 가격 갱신 — GitHub Actions cron이 호출"""
import os, psycopg2, urllib.request, json, time, sys

PG = dict(
    host=os.environ.get("SUPABASE_DB_HOST", "aws-1-ap-northeast-2.pooler.supabase.com"),
    port=6543,
    user=os.environ.get("SUPABASE_DB_USER", "postgres.adhjwyiwajgsaryxkomw"),
    password=os.environ.get("SUPABASE_DB_PASSWORD"),
    dbname="postgres", sslmode="require"
)
if not PG["password"]:
    print("ERR: SUPABASE_DB_PASSWORD missing")
    sys.exit(1)

def get_usd_krw():
    try:
        url = "https://api.exchangerate.host/latest?base=USD&symbols=KRW"
        d = json.loads(urllib.request.urlopen(url, timeout=10).read())
        return float(d['rates']['KRW'])
    except Exception:
        return 1381.0

USD_KRW = get_usd_krw()
print(f"USD/KRW = {USD_KRW}")

def fetch_pokemon_card(external_id):
    url = f"https://api.pokemontcg.io/v2/cards/{external_id}"
    req = urllib.request.Request(url, headers={"User-Agent": "cardpick/1.0"})
    try:
        return json.loads(urllib.request.urlopen(req, timeout=15).read()).get("data")
    except Exception:
        return None

conn = psycopg2.connect(**PG)
conn.autocommit = False
cur = conn.cursor()

cur.execute(
    "insert into exchange_rates (base, target, rate) values ('USD','KRW',%s)",
    (USD_KRW,)
)
conn.commit()

# 인기 카드 우선 갱신 (popularity_rank 낮은 순) — top 500
cur.execute("""
    select slug, external_id, game
    from cards
    where external_id is not null
    order by popularity_rank asc nulls last
    limit 500
""")
rows = cur.fetchall()
print(f"갱신 대상: {len(rows)}장")

updated = 0
for i, (slug, eid, game) in enumerate(rows):
    if game != 'pokemon':
        continue  # 원피스는 별도 cron
    card = fetch_pokemon_card(eid)
    if not card:
        continue
    tp = card.get("tcgplayer") or {}
    prices = tp.get("prices") or {}
    for variant, p in prices.items():
        low = p.get("low"); mid = p.get("mid"); mkt = p.get("market"); high = p.get("high")
        ref = mkt or mid or low
        krw = round(ref * USD_KRW) if ref else None
        try:
            cur.execute("""
                insert into prices (card_slug, source, variant, currency, price_low, price_mid, price_market, price_high, price_krw, exchange_rate)
                values (%s,'tcgplayer',%s,'USD',%s,%s,%s,%s,%s,%s)
            """, (slug, variant, low, mid, mkt, high, krw, USD_KRW))
            updated += 1
        except Exception:
            conn.rollback()
            continue
    if (i + 1) % 50 == 0:
        conn.commit()
        print(f"  [{i+1}/{len(rows)}] 진행, 누적 가격 {updated}건")
    time.sleep(0.6)  # rate limit (30/min 안전)

conn.commit()

# 90일 이상 된 가격 데이터 삭제 (DB 용량 관리)
cur.execute("delete from prices where fetched_at < now() - interval '90 days'")
deleted = cur.rowcount
conn.commit()
print(f"\nDONE — 가격 {updated}건 갱신, 오래된 {deleted}건 삭제")
cur.close(); conn.close()
