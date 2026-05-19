#!/usr/bin/env python3
"""Pokémon TCG API → 인기 Pokemon 카드 N장 가격 갱신.
- 환경변수: POKEMON_TCG_API_KEY, SUPABASE_DB_PASSWORD
- 매일 05:00 KST cron이 호출
- 1회 호출당 page 250장 (최대), 페이지네이션으로 전체
"""
import os, sys, time, json, urllib.request, urllib.parse, psycopg2
from datetime import datetime

API_KEY = os.environ.get("POKEMON_TCG_API_KEY", "").strip()
if not API_KEY:
    print("ERR: POKEMON_TCG_API_KEY missing"); sys.exit(1)

PG = dict(
    host=os.environ.get("SUPABASE_DB_HOST", "aws-1-ap-northeast-2.pooler.supabase.com"),
    port=int(os.environ.get("SUPABASE_DB_PORT", "6543")),
    user=os.environ.get("SUPABASE_DB_USER", "postgres.aqxrmdratnkffvivguqs"),
    password=os.environ.get("SUPABASE_DB_PASSWORD"),
    dbname="postgres", sslmode="require", connect_timeout=30,
)
if not PG["password"]:
    print("ERR: SUPABASE_DB_PASSWORD missing"); sys.exit(1)

TARGET_CARDS = int(os.environ.get("POKEMON_DAILY_TARGET", "2000"))
USD_KRW = 1381.0  # TODO: live FX

def get_usd_krw():
    try:
        req = urllib.request.Request("https://api.exchangerate.host/latest?base=USD&symbols=KRW",
                                      headers={"User-Agent":"cardpick/1.0"})
        d = json.loads(urllib.request.urlopen(req, timeout=10).read())
        return float(d['rates']['KRW'])
    except Exception:
        return USD_KRW

def ptcg_get(path, params=None):
    qs = ('?' + urllib.parse.urlencode(params)) if params else ''
    req = urllib.request.Request(f"https://api.pokemontcg.io/v2{path}{qs}",
                                  headers={"X-Api-Key": API_KEY,
                                           "User-Agent": "Mozilla/5.0 (X11; Linux x86_64) cardpick/1.0",
                                           "Accept": "application/json"})
    return json.loads(urllib.request.urlopen(req, timeout=30).read())

def main():
    fx = get_usd_krw()
    print(f"FX USD/KRW = {fx}")

    conn = psycopg2.connect(**PG); conn.autocommit = True; cur = conn.cursor()
    cur.execute("set statement_timeout = 0")

    # 0) job 시작 로그
    cur.execute("""insert into api_update_logs (source, job_name, status, requested_count, started_at)
                   values ('pokemontcg-api', %s, 'started', %s, now()) returning id""",
                (f"daily-top-{TARGET_CARDS}", TARGET_CARDS))
    job_id = cur.fetchone()[0]

    # 1) 31일+ prune (디스크 관리)
    cur.execute("delete from prices where source='pokemontcg-tcgplayer' and fetched_at < now() - interval '31 days'")
    pruned = cur.rowcount
    print(f"pruned old: {pruned}")

    # 2) 대상 카드 선정 (popularity_rank 우선 + 검색 요청 + 업데이트 요청)
    cur.execute("""
        with priority as (
          select c.slug, c.external_id, c.name, c.popularity_rank,
                 coalesce(c.editor_score, 0) * 100 as editor_boost,
                 coalesce((select count(*) from card_search_logs l
                          where l.matched_slug=c.slug and l.created_at > now()-interval '7 days'), 0) as search_recent,
                 coalesce((select request_count from price_update_requests r
                          where r.card_slug=c.slug), 0) as request_count
          from cards c
          where c.game='pokemon' and c.external_id is not null
        )
        select slug, external_id, name from priority
        order by editor_boost desc, search_recent desc, request_count desc, popularity_rank asc nulls last
        limit %s
    """, (TARGET_CARDS,))
    targets = cur.fetchall()
    print(f"targets: {len(targets)}")

    if not targets:
        cur.execute("update api_update_logs set status='completed', updated_count=0, finished_at=now() where id=%s", (job_id,))
        cur.close(); conn.close(); return

    updated = 0
    failed = 0
    calls = 0
    today = datetime.utcnow().strftime("%Y-%m-%d")

    # 3) 카드별 fetch (page 250장씩 묶어서 가능 — 그런데 individual ID 조회는 1 by 1)
    # 효율: 50장씩 묶어 q=id:a OR id:b OR ... 조회 (API 허용)
    BATCH = 50
    for i in range(0, len(targets), BATCH):
        batch = targets[i:i+BATCH]
        ids = [t[1] for t in batch if t[1]]
        if not ids: continue
        q = " OR ".join([f"id:{eid}" for eid in ids])
        try:
            res = ptcg_get("/cards", {"q": q, "pageSize": str(BATCH), "select": "id,name,tcgplayer,cardmarket"})
            calls += 1
        except Exception as e:
            print(f"  batch {i//BATCH} err: {str(e)[:80]}")
            failed += len(batch); continue

        by_id = {c['id']: c for c in res.get('data', [])}
        for slug, eid, name in batch:
            card = by_id.get(eid)
            if not card:
                failed += 1; continue

            tp = card.get('tcgplayer') or {}
            cm = card.get('cardmarket') or {}
            tp_prices = tp.get('prices') or {}
            cm_prices = cm.get('prices') or {}

            # TCGplayer: variant별로 저장. 기본 variant 우선순위
            for variant_name, p in tp_prices.items():
                if not isinstance(p, dict): continue
                mkt = p.get('market') or p.get('mid')
                if mkt is None: continue
                low = p.get('low'); mid = p.get('mid'); high = p.get('high')
                krw = round(float(mkt) * fx)
                try:
                    cur.execute("""insert into prices
                        (card_slug, source, variant, currency, price_low, price_mid, price_market, price_high, price_krw, exchange_rate, fetched_at)
                        values (%s, 'pokemontcg-tcgplayer', %s, 'USD', %s, %s, %s, %s, %s, %s, now())""",
                        (slug, variant_name, low, mid, mkt, high, krw, fx))
                except Exception:
                    pass

            # Cardmarket: 단일 객체 (variant 구분 없음). source='pokemontcg-cardmarket'
            if cm_prices and cm_prices.get('averageSellPrice') is not None:
                mkt = cm_prices.get('trendPrice') or cm_prices.get('averageSellPrice')
                low = cm_prices.get('lowPrice'); high = None
                krw = round(float(mkt) * fx)  # EUR 환율 ≠ USD 실제로 다름. 단순 변환만.
                try:
                    cur.execute("""insert into prices
                        (card_slug, source, variant, currency, price_low, price_mid, price_market, price_high, price_krw, exchange_rate, fetched_at)
                        values (%s, 'pokemontcg-cardmarket', 'normal', 'EUR', %s, %s, %s, %s, %s, %s, now())""",
                        (slug, low, cm_prices.get('averageSellPrice'), mkt, high, krw, fx))
                except Exception:
                    pass

                # 외부 메트릭 (avg7, avg30)
                try:
                    cur.execute("""insert into price_metrics_external
                        (card_slug, source, ext_avg_24h, ext_avg_7d, ext_avg_30d, ext_currency, ext_updated_at, updated_at)
                        values (%s, 'pokemontcg-cardmarket', %s, %s, %s, 'EUR', now(), now())
                        on conflict (card_slug) do update set
                          source=excluded.source, ext_avg_24h=excluded.ext_avg_24h,
                          ext_avg_7d=excluded.ext_avg_7d, ext_avg_30d=excluded.ext_avg_30d,
                          ext_currency=excluded.ext_currency, ext_updated_at=excluded.ext_updated_at,
                          updated_at=now()""",
                        (slug, cm_prices.get('avg1'), cm_prices.get('avg7'), cm_prices.get('avg30')))
                except Exception:
                    pass

            updated += 1

        # 진행 보고
        if (i // BATCH) % 5 == 0:
            print(f"  progress: {updated}/{len(targets)} ({calls} API calls)")
        time.sleep(0.3)  # rate limit safety

    # 4) MV refresh
    cur.execute("refresh materialized view card_price_summary")
    cur.execute("refresh materialized view card_price_summary_best")
    print("MV refreshed")

    # 5) 업데이트 요청 처리됨 마킹
    cur.execute("""update price_update_requests set status='done', resolved_at=now()
                   where card_slug in (select slug from cards where game='pokemon')
                     and status='pending' and last_requested_at > now() - interval '24 hours'""")
    print(f"requests resolved: {cur.rowcount}")

    # 6) job 종료 로그
    cur.execute("""update api_update_logs set status='completed',
                   updated_count=%s, failed_count=%s, api_calls_used=%s, finished_at=now()
                   where id=%s""", (updated, failed, calls, job_id))

    cur.execute("select count(*) from prices"); print('prices total:', cur.fetchone()[0])
    cur.execute("select pg_size_pretty(pg_database_size('postgres'))"); print('DB:', cur.fetchone()[0])

    print(f"\nDONE  updated={updated}  failed={failed}  calls={calls}")
    cur.close(); conn.close()

if __name__ == "__main__":
    main()
