#!/usr/bin/env python3
"""Pokémon TCG API → 인기 카드 일일 가격 갱신.

★ 2026-05-20 재구조화: 옛 external_id (TCGCSV 숫자 ID)가 Pokemon TCG API와 매칭 안 됨.
   refresh_cardmarket.py와 동일한 패턴(set 단위 fetch + name+number 매칭)으로 전환.

- 환경변수: POKEMON_TCG_API_KEY, SUPABASE_DB_PASSWORD
- 매일 05:00 KST cron이 호출
- 인기 sets 우선 (popularity_rank 상위 카드들이 속한 set)
"""
import os, sys, time, json, urllib.request, urllib.parse, urllib.error, psycopg2, re
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
RETRYABLE_HTTP_STATUS = {429, 500, 502, 503, 504}
_ACTIVE_JOB = None

def get_usd_krw():
    try:
        req = urllib.request.Request("https://api.exchangerate.host/latest?base=USD&symbols=KRW",
                                      headers={"User-Agent":"cardpick/1.0"})
        d = json.loads(urllib.request.urlopen(req, timeout=10).read())
        return float(d['rates']['KRW'])
    except Exception:
        return USD_KRW_DEFAULT

def ptcg_get(path, params=None, retries=2, base_delay=2):
    """Pokemon TCG API 호출. 일시 오류만 지수 백오프로 재시도한다."""
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
        except urllib.error.HTTPError as e:
            if e.code not in RETRYABLE_HTTP_STATUS:
                raise
            last_err = e
            if attempt < retries:
                retry_after = e.headers.get('Retry-After') if e.headers else None
                try:
                    delay = max(float(retry_after), 1) if retry_after else min(base_delay * (2 ** attempt), 90)
                except (TypeError, ValueError):
                    delay = min(base_delay * (2 ** attempt), 90)
                print(f"  API HTTP {e.code}; retry {attempt + 1}/{retries} in {delay:.0f}s")
                sys.stdout.flush()
                time.sleep(delay)
                continue
            raise last_err
        except Exception as e:
            last_err = e
            if attempt < retries:
                delay = min(base_delay * (2 ** attempt), 90)
                print(f"  API transient error; retry {attempt + 1}/{retries} in {delay:.0f}s: {type(e).__name__}")
                sys.stdout.flush()
                time.sleep(delay)
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
    global _ACTIVE_JOB
    fx = get_usd_krw()
    print(f"FX USD/KRW = {fx}"); sys.stdout.flush()

    conn = psycopg2.connect(**PG); conn.autocommit = True; cur = conn.cursor()
    cur.execute("set statement_timeout = 0")

    # job 시작 로그
    cur.execute("""insert into api_update_logs (source, job_name, status, started_at)
                   values ('pokemontcg-api', 'daily-tcgplayer-by-set', 'started', now()) returning id""")
    job_id = cur.fetchone()[0]
    _ACTIVE_JOB = (conn, cur, job_id)

    # API가 살아 있는지 확인한 뒤에만 기존 가격을 정리한다.
    # 시작점인 /sets가 실패하면 기존 데이터는 그대로 유지하고 workflow 재시도에 맡긴다.
    sets_resp = ptcg_get(
        '/sets',
        {'pageSize':'250', 'orderBy':'-releaseDate'},
        retries=5,
        base_delay=5,
    )
    sets = sets_resp.get('data', [])
    if not sets:
        raise RuntimeError('Pokemon TCG API returned no sets')
    print(f"API sets: {len(sets)}"); sys.stdout.flush()

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

    INS_PRICE = """insert into prices
        (card_slug, source, variant, currency, price_low, price_mid, price_market, price_high, price_krw, exchange_rate, fetched_at)
        values (%s, 'tcgplayer', %s, 'USD', %s, %s, %s, %s, %s, %s, now())"""

    total_updated = 0
    matched_slugs = set()
    api_calls = 0
    api_errors = 0
    # deadline (분). workflow timeout-minutes 는 120 이므로 여유 있음.
    # 2026-08-05: prices 인덱스 3종 추가로 IO 대기가 줄어 25 -> 35분 (env 로 조절 가능)
    _dl_min = int(os.environ.get("POKEMON_DEADLINE_MIN", "35"))
    deadline = time.time() + _dl_min * 60

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

    if api_calls == 0 or total_updated == 0:
        raise RuntimeError(
            f'Pokemon price refresh produced no usable data '
            f'(api_calls={api_calls}, api_errors={api_errors}, updated={total_updated})'
        )

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
                   where id=%s""", (total_updated, api_errors, api_calls, job_id))
    _ACTIVE_JOB = None

    print(f"\n=== DONE ===")
    print(f"  prices inserted (this run): {total_updated}")
    print(f"  unique cards matched      : {len(matched_slugs):,}")
    print(f"  prices fresh (1h)         : {fresh_count:,}")
    print(f"  total priced cards (MV)   : {priced_total:,}/{total_cards:,} ({priced_total*100//max(total_cards,1)}%)")
    print(f"  API calls                 : {api_calls} (errors: {api_errors})")

    cur.close(); conn.close()

def mark_active_job_failed(exc):
    """Unhandled failure가 나도 started 로그를 남겨 두지 않는다."""
    global _ACTIVE_JOB
    if not _ACTIVE_JOB:
        return
    conn, cur, job_id = _ACTIVE_JOB
    try:
        cur.execute("""update api_update_logs set status='failed',
                       failed_count=greatest(coalesce(failed_count, 0), 1), finished_at=now()
                       where id=%s""", (job_id,))
        print(f"job marked failed: {type(exc).__name__}: {str(exc)[:160]}")
        sys.stdout.flush()
    except Exception as log_exc:
        print(f"failed to finalize job log: {type(log_exc).__name__}")
        sys.stdout.flush()
    finally:
        _ACTIVE_JOB = None
        try: cur.close()
        except Exception: pass
        try: conn.close()
        except Exception: pass

if __name__ == "__main__":
    try:
        main()
    except Exception as exc:
        mark_active_job_failed(exc)
        raise
