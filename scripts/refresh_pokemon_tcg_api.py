#!/usr/bin/env python3
"""Pokémon TCG API → 인기 카드 일일 가격 갱신.

★ 2026-05-20 재구조화: 옛 external_id (TCGCSV 숫자 ID)가 Pokemon TCG API와 매칭 안 됨.
   refresh_cardmarket.py와 동일한 패턴(set 단위 fetch + name+number 매칭)으로 전환.

- 환경변수: POKEMON_TCG_API_KEY, SUPABASE_DB_PASSWORD
- 매일 05:00 KST cron이 호출
- 인기 sets 우선 (popularity_rank 상위 카드들이 속한 set)
"""
import os, sys, time, json, urllib.request, urllib.parse, psycopg2, re
from datetime import datetime

# stdout 즉시 flush (GitHub Actions 실시간 로그)
try: sys.stdout.reconfigure(line_buffering=True)
except Exception: pass

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

USD_KRW_DEFAULT = 1381.0

def get_usd_krw():
    try:
        req = urllib.request.Request("https://api.exchangerate.host/latest?base=USD&symbols=KRW",
                                      headers={"User-Agent":"cardpick/1.0"})
        d = json.loads(urllib.request.urlopen(req, timeout=10).read())
        return float(d['rates']['KRW'])
    except Exception:
        return USD_KRW_DEFAULT

def ptcg_get(path, params=None, retries=2):
    """timeout 60s + retry x2."""
    qs = ('?' + urllib.parse.urlencode(params)) if params else ''
    last_err = None
    for attempt in range(retries + 1):
        try:
            req = urllib.request.Request(
                f"https://api.pokemontcg.io/v2{path}{qs}",
                headers={"X-Api-Key": API_KEY,
                         "User-Agent": "Mozilla/5.0 cardpick/1.0",
                         "Accept": "application/json"}
            )
            return json.loads(urllib.request.urlopen(req, timeout=60).read())
        except Exception as e:
            last_err = e
            if attempt < retries:
                time.sleep(2 + attempt * 2)
                continue
            raise last_err

def norm_num(n):
    if not n: return '0'
    s = str(n).split('/')[0].strip().lstrip('0') or '0'
    return s

def norm_name(s):
    if not s: return ''
    t = s.lower().strip()
    t = re.sub(r'\s*-\s*\d+\s*[/]\s*\d+\s*$', '', t)
    t = re.sub(r'\s*-\s*\d+\s*$', '', t)
    for src, dst in [('é','e'),('è','e'),('ô','o'),('â','a'),('í','i'),('•',''),('★','')]:
        t = t.replace(src, dst)
    t = re.sub(r'[\.\*]', '', t)
    t = re.sub(r'\s+', ' ', t).strip()
    return t

def main():
    fx = get_usd_krw()
    print(f"FX USD/KRW = {fx}"); sys.stdout.flush()

    conn = psycopg2.connect(**PG); conn.autocommit = True; cur = conn.cursor()
    cur.execute("set statement_timeout = 0")

    # job 시작 로그
    cur.execute("""insert into api_update_logs (source, job_name, status, started_at)
                   values ('pokemontcg-api', 'daily-tcgplayer-by-set', 'started', now()) returning id""")
    job_id = cur.fetchone()[0]

    # 31일+ prune
    cur.execute("delete from prices where source='tcgplayer' and fetched_at < now() - interval '31 days'")
    print(f"pruned old: {cur.rowcount}"); sys.stdout.flush()

    # 1) cards 인덱스 (name+num → slugs)
    cur.execute("select slug, name, number from cards where game='pokemon'")
    all_cards = cur.fetchall()
    name_num2slugs = {}
    for slug, name, number in all_cards:
        key = (norm_name(name), norm_num(number))
        name_num2slugs.setdefault(key, []).append(slug)
    print(f"pokemon cards in DB: {len(all_cards):,}"); sys.stdout.flush()
    print(f"normalized keys: {len(name_num2slugs):,}"); sys.stdout.flush()

    # 2) Pokemon TCG API /sets 전부 fetch (releaseDate 내림차순 — 인기 우선)
    sets_resp = ptcg_get('/sets', {'pageSize':'250', 'orderBy':'-releaseDate'})
    sets = sets_resp.get('data', [])
    print(f"API sets: {len(sets)}"); sys.stdout.flush()

    INS_PRICE = """insert into prices
        (card_slug, source, variant, currency, price_low, price_mid, price_market, price_high, price_krw, exchange_rate, fetched_at)
        values (%s, 'tcgplayer', %s, 'USD', %s, %s, %s, %s, %s, %s, now())"""

    total_updated = 0
    matched_slugs = set()
    api_calls = 0
    api_errors = 0
    deadline = time.time() + 25 * 60  # 25분 deadline (workflow 30분)

    for si, s in enumerate(sets):
        if time.time() > deadline:
            print(f"[TIMEOUT] deadline at set {si}/{len(sets)} — stopping"); sys.stdout.flush()
            break
        set_id = s.get('id')
        set_name = s.get('name', '')
        try:
            d = ptcg_get('/cards', {
                'q': f'set.id:{set_id}',
                'pageSize': '250',
                'select': 'id,name,number,tcgplayer'
            })
            api_calls += 1
        except Exception as e:
            api_errors += 1
            print(f"  ERR {set_id}: {str(e)[:60]}"); sys.stdout.flush()
            time.sleep(2); continue

        set_updated = 0
        for c in d.get('data', []):
            key = (norm_name(c.get('name')), norm_num(c.get('number')))
            if key not in name_num2slugs: continue
            tp = (c.get('tcgplayer') or {}).get('prices') or {}
            for variant_name, p in tp.items():
                if not isinstance(p, dict): continue
                mkt = p.get('market') or p.get('mid')
                if mkt is None: continue
                low, mid, high = p.get('low'), p.get('mid'), p.get('high')
                try:
                    krw = round(float(mkt) * fx)
                except Exception:
                    continue
                for slug in name_num2slugs[key]:
                    try:
                        cur.execute(INS_PRICE, (slug, variant_name, low, mid, mkt, high, krw, fx))
                        set_updated += 1
                        matched_slugs.add(slug)
                    except Exception:
                        pass

        if si % 5 == 0:
            print(f"  [progress] set {si+1}/{len(sets)} {set_id:<12} matched_so_far={len(matched_slugs)} updated={total_updated+set_updated}"); sys.stdout.flush()
        total_updated += set_updated
        time.sleep(0.1)

    # 3) MV refresh
    print("\nMV refresh..."); sys.stdout.flush()
    try:
        cur.execute("select refresh_card_price_summary()")
    except Exception:
        cur.execute("refresh materialized view card_price_summary")
        cur.execute("refresh materialized view card_price_summary_best")
    print("MV refreshed"); sys.stdout.flush()

    # 4) 통계
    cur.execute("select count(*) from prices where source='tcgplayer' and fetched_at > now() - interval '1 hour'")
    fresh_count = cur.fetchone()[0]
    cur.execute("select count(distinct card_slug) from card_price_summary_best where latest_krw > 0")
    priced_total = cur.fetchone()[0]
    cur.execute("select count(*) from cards where game='pokemon'")
    total_cards = cur.fetchone()[0]

    cur.execute("""update api_update_logs set status='completed',
                   updated_count=%s, failed_count=%s, api_calls_used=%s, finished_at=now()
                   where id=%s""", (total_updated, 0, api_calls, job_id))

    print(f"\n=== DONE ===")
    print(f"  prices inserted (this run): {total_updated}")
    print(f"  unique cards matched      : {len(matched_slugs):,}")
    print(f"  prices fresh (1h)         : {fresh_count:,}")
    print(f"  total priced cards (MV)   : {priced_total:,}/{total_cards:,} ({priced_total*100//max(total_cards,1)}%)")
    print(f"  API calls                 : {api_calls} (errors: {api_errors})")

    cur.close(); conn.close()

if __name__ == "__main__":
    main()
