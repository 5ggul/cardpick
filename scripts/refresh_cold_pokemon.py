#!/usr/bin/env python3
"""Pokémon TCG API → 신규 카드 발견 + Cold rotation 가격 갱신.

목적: 사용자 요청 "지금 가격이나 데이터 없는 카드들도 최대한 많이 DB 모아서 가격 넣어
       놔야 해. 갱신텀 좀 늦더라도."

두 단계로 동작:
  Phase A — Discover: Pokemon TCG API 전 sets 순회. cards 테이블에 external_id 가
           없는 카드 발견 시 cards INSERT + 첫 가격 prices INSERT. 신규 카드는
           is_indexable=false 로 들어가 노출되지 않음 (게이트 §6.2 통과 후 활성화).
  Phase B — Cold rotation: cards.game='pokemon' 중 (prices 한 번도 없는 카드) +
           (prices 14일+ stale) 우선으로 LRU 1,500장 갱신. 기존 핫 카드 2,000장 일일
           갱신과 별개로 동작 — 한 사이클이 약 1주일 걸리되 모든 카드를 회전.

cron 권장: 매일 06:00 KST (= 21:00 UTC) — workflow yml 별도 job
환경변수: POKEMON_TCG_API_KEY, SUPABASE_DB_PASSWORD
"""
import os, sys, time, json, re, urllib.request, urllib.parse, psycopg2
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

COLD_TARGET = int(os.environ.get("COLD_DAILY_TARGET", "1500"))
STALE_DAYS  = int(os.environ.get("COLD_STALE_DAYS", "14"))
USD_KRW_DEFAULT = 1381.0

# ---------------------------------------------------------------- HTTP utils

def get_usd_krw():
    try:
        req = urllib.request.Request(
            "https://api.exchangerate.host/latest?base=USD&symbols=KRW",
            headers={"User-Agent": "cardpick/1.0"}
        )
        d = json.loads(urllib.request.urlopen(req, timeout=10).read())
        return float(d['rates']['KRW'])
    except Exception:
        return USD_KRW_DEFAULT

def ptcg_get(path, params=None):
    qs = ('?' + urllib.parse.urlencode(params)) if params else ''
    req = urllib.request.Request(
        f"https://api.pokemontcg.io/v2{path}{qs}",
        headers={
            "X-Api-Key": API_KEY,
            "User-Agent": "Mozilla/5.0 (X11; Linux x86_64) cardpick/1.0",
            "Accept": "application/json",
        }
    )
    return json.loads(urllib.request.urlopen(req, timeout=30).read())

# ---------------------------------------------------------------- slug utils

# 기존 최신 카드 slug 규칙과 호환 (예: "Slowpoke & Psyduck GX" + "239/236" → "slowpoke-psyduck-gx-239236")
def make_slug(name, number):
    s = (name or "").lower().replace("'", "").replace("&", "")
    s = re.sub(r"[^a-z0-9]+", "-", s).strip("-") or "card"
    n = (str(number or "").replace("/", "")) or "x"
    return f"{s}-{n}"

def safe_text(v, lim=400):
    if v is None: return None
    s = str(v).strip()
    return s[:lim] if s else None

# ---------------------------------------------------------------- price persist helpers

def insert_prices_for_card(cur, slug, card_api, fx):
    """카드 API response 한 건 → prices + price_metrics_external INSERT.
    이미 같은 시각에 동일 row 있어도 try/except로 그냥 skip.
    """
    tp = card_api.get('tcgplayer') or {}
    cm = card_api.get('cardmarket') or {}
    tp_prices = tp.get('prices') or {}
    cm_prices = cm.get('prices') or {}

    inserted = 0
    for variant_name, p in tp_prices.items():
        if not isinstance(p, dict): continue
        mkt = p.get('market') or p.get('mid')
        if mkt is None: continue
        low, mid, high = p.get('low'), p.get('mid'), p.get('high')
        try:
            krw = round(float(mkt) * fx)
        except (TypeError, ValueError):
            continue
        try:
            cur.execute("""insert into prices
                (card_slug, source, variant, currency,
                 price_low, price_mid, price_market, price_high,
                 price_krw, exchange_rate, fetched_at)
                values (%s, 'pokemontcg-tcgplayer', %s, 'USD',
                        %s, %s, %s, %s, %s, %s, now())""",
                (slug, variant_name, low, mid, mkt, high, krw, fx))
            inserted += 1
        except Exception:
            pass

    if cm_prices and cm_prices.get('averageSellPrice') is not None:
        mkt = cm_prices.get('trendPrice') or cm_prices.get('averageSellPrice')
        low = cm_prices.get('lowPrice')
        try:
            krw = round(float(mkt) * fx)
            cur.execute("""insert into prices
                (card_slug, source, variant, currency,
                 price_low, price_mid, price_market, price_high,
                 price_krw, exchange_rate, fetched_at)
                values (%s, 'pokemontcg-cardmarket', 'normal', 'EUR',
                        %s, %s, %s, %s, %s, %s, now())""",
                (slug, low, cm_prices.get('averageSellPrice'), mkt, None, krw, fx))
            inserted += 1
        except Exception:
            pass
        try:
            cur.execute("""insert into price_metrics_external
                (card_slug, source, ext_avg_24h, ext_avg_7d, ext_avg_30d,
                 ext_currency, ext_updated_at, updated_at)
                values (%s, 'pokemontcg-cardmarket', %s, %s, %s, 'EUR', now(), now())
                on conflict (card_slug) do update set
                  source='pokemontcg-cardmarket',
                  ext_avg_24h=excluded.ext_avg_24h,
                  ext_avg_7d=excluded.ext_avg_7d,
                  ext_avg_30d=excluded.ext_avg_30d,
                  ext_updated_at=now(), updated_at=now()""",
                (slug, cm_prices.get('avg1'), cm_prices.get('avg7'), cm_prices.get('avg30')))
        except Exception:
            pass
    return inserted

# ---------------------------------------------------------------- Phase A: discover new cards

def discover_new_cards(cur, fx):
    print("\n=== Phase A: discover new cards ===")
    # 기존 external_id 인덱스
    cur.execute("select external_id from cards where game='pokemon' and external_id is not null")
    have = set(r[0] for r in cur.fetchall())
    print(f"  known external_id: {len(have):,}")

    # sets 전부 fetch
    try:
        sets = ptcg_get('/sets', {'pageSize': '250'}).get('data', [])
    except Exception as e:
        print(f"  ERR fetch /sets: {e}"); return 0, 0
    print(f"  API sets: {len(sets)}")

    inserted_cards = 0
    inserted_prices = 0
    api_calls = 0
    api_errors = 0

    INS_CARD = """insert into cards
        (slug, external_id, game, name, name_en, set_name, set_code, set_id, number,
         rarity, rarity_class, type, artist, released_at, is_indexable,
         created_at, updated_at)
        values (%s, %s, 'pokemon', %s, %s, %s, %s, %s, %s,
                %s, %s, %s, %s, %s, false, now(), now())
        on conflict (slug) do nothing"""

    for s in sets:
        set_id = s.get('id')
        set_name = s.get('name') or ''
        set_code = (s.get('ptcgoCode') or s.get('id') or '').upper()
        try:
            d = ptcg_get('/cards', {
                'q': f'set.id:{set_id}',
                'pageSize': '250',
                'select': 'id,name,number,rarity,types,artist,releaseDate,tcgplayer,cardmarket'
            })
            api_calls += 1
        except Exception as e:
            api_errors += 1
            print(f"  ERR set {set_id}: {str(e)[:60]}")
            time.sleep(1); continue

        new_in_set = 0
        for c in d.get('data', []):
            eid = c.get('id')
            if not eid or eid in have: continue

            name = c.get('name') or 'Unknown'
            number = c.get('number') or ''
            slug = make_slug(name, number)
            rarity_raw = c.get('rarity') or ''
            types = c.get('types') or []
            type_str = types[0] if types else ''
            artist = safe_text(c.get('artist'))
            release = c.get('releaseDate')  # YYYY/MM/DD or null
            try:
                released_at = datetime.strptime(release, '%Y/%m/%d').date() if release else None
            except Exception:
                released_at = None

            try:
                cur.execute(INS_CARD, (
                    slug, eid, name, name,
                    set_name, set_code, set_id, number,
                    rarity_raw, rarity_raw, type_str, artist, released_at
                ))
                if cur.rowcount > 0:
                    inserted_cards += 1
                    new_in_set += 1
                    have.add(eid)
                    # 첫 가격 동시 적재
                    inserted_prices += insert_prices_for_card(cur, slug, c, fx)
            except Exception as e:
                # slug 충돌·NOT NULL 위반 등 → 다음으로
                pass

        if new_in_set:
            print(f"  + {set_id:<15} {set_name[:34]:34s} new={new_in_set}")
        time.sleep(0.1)

    print(f"\n  Phase A done: new_cards={inserted_cards}  new_price_rows={inserted_prices}  calls={api_calls}  errors={api_errors}")
    return inserted_cards, inserted_prices

# ---------------------------------------------------------------- Phase B: cold rotation

def cold_rotation(cur, fx):
    print("\n=== Phase B: cold rotation ===")
    # prices 한 번도 없는 카드 우선, 그 다음 STALE_DAYS+ 오래된 카드
    cur.execute(f"""
        with last_p as (
          select card_slug, max(fetched_at) as latest
          from prices
          where source='pokemontcg-tcgplayer'
          group by card_slug
        )
        select c.slug, c.external_id, c.name
        from cards c
        left join last_p p on p.card_slug = c.slug
        where c.game='pokemon' and c.external_id is not null
          and (p.latest is null or p.latest < now() - interval '{STALE_DAYS} days')
        order by (p.latest is null) desc, p.latest asc nulls first, c.popularity_rank asc nulls last
        limit %s
    """, (COLD_TARGET,))
    targets = cur.fetchall()
    print(f"  targets (stale > {STALE_DAYS}d or never priced): {len(targets):,}")
    if not targets:
        print("  nothing to do"); return 0, 0

    # job 로그
    cur.execute("""insert into api_update_logs
        (source, job_name, status, requested_count, started_at)
        values ('pokemontcg-api', %s, 'started', %s, now()) returning id""",
        (f"cold-rotation-{COLD_TARGET}", len(targets)))
    job_id = cur.fetchone()[0]

    updated = 0
    failed = 0
    calls = 0
    BATCH = 50
    for i in range(0, len(targets), BATCH):
        batch = targets[i:i+BATCH]
        ids = [t[1] for t in batch if t[1]]
        if not ids: continue
        q = " OR ".join([f"id:{eid}" for eid in ids])
        try:
            res = ptcg_get('/cards', {
                'q': q,
                'pageSize': str(BATCH),
                'select': 'id,name,tcgplayer,cardmarket'
            })
            calls += 1
        except Exception as e:
            print(f"  batch {i//BATCH} err: {str(e)[:80]}")
            failed += len(batch); time.sleep(1); continue

        by_id = {c['id']: c for c in res.get('data', [])}
        for slug, eid, name in batch:
            c = by_id.get(eid)
            if not c:
                failed += 1; continue
            insert_prices_for_card(cur, slug, c, fx)
            updated += 1

        if (i // BATCH) % 5 == 0:
            print(f"  progress: {updated}/{len(targets)}  calls={calls}")
        time.sleep(0.3)

    cur.execute("""update api_update_logs set status='completed',
        updated_count=%s, failed_count=%s, api_calls_used=%s, finished_at=now()
        where id=%s""", (updated, failed, calls, job_id))

    print(f"\n  Phase B done: updated={updated}  failed={failed}  calls={calls}")
    return updated, failed

# ---------------------------------------------------------------- main

def main():
    fx = get_usd_krw()
    print(f"FX USD/KRW = {fx}")

    conn = psycopg2.connect(**PG); conn.autocommit = True; cur = conn.cursor()
    cur.execute("set statement_timeout = 0")

    new_cards, new_prices = discover_new_cards(cur, fx)
    cold_updated, cold_failed = cold_rotation(cur, fx)

    # MV refresh (한 번만)
    print("\nMV refresh...")
    try:
        cur.execute("select refresh_card_price_summary()")
    except Exception:
        cur.execute("refresh materialized view card_price_summary")
        cur.execute("refresh materialized view card_price_summary_best")
    print("MV refreshed")

    # 최종 통계
    cur.execute("select count(*) from cards where game='pokemon'")
    total_cards = cur.fetchone()[0]
    cur.execute("select count(*) from card_price_summary_best where latest_krw > 0")
    priced = cur.fetchone()[0]
    cur.execute("select pg_size_pretty(pg_database_size('postgres'))")
    db_size = cur.fetchone()[0]

    print(f"\n=== DONE ===")
    print(f"  new_cards    : {new_cards}")
    print(f"  new_prices   : {new_prices}")
    print(f"  cold_updated : {cold_updated}")
    print(f"  cold_failed  : {cold_failed}")
    print(f"  total_cards  : {total_cards:,}")
    print(f"  priced cards : {priced:,}  ({priced*100//max(total_cards,1)}%)")
    print(f"  DB size      : {db_size}")

    cur.close(); conn.close()

if __name__ == "__main__":
    main()
