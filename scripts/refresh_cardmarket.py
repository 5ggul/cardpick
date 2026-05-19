#!/usr/bin/env python3
"""Pokemon TCG API → Cardmarket 평균가 전체 카드 적용 (cron용).
- 172 sets 전체 fetch
- 이름 normalization v2 (variant suffix · ball pattern · accent 처리)
- price_metrics_external upsert
- MV refresh

환경변수:
  POKEMON_TCG_API_KEY
  SUPABASE_DB_PASSWORD
"""
import os, sys, time, json, urllib.request, urllib.parse, psycopg2, re

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

def ptcg_get(path, params=None):
    qs = ('?' + urllib.parse.urlencode(params)) if params else ''
    req = urllib.request.Request(
        f"https://api.pokemontcg.io/v2{path}{qs}",
        headers={"X-Api-Key": API_KEY,
                 "User-Agent": "Mozilla/5.0 cardpick/1.0",
                 "Accept": "application/json"}
    )
    return json.loads(urllib.request.urlopen(req, timeout=30).read())

def norm_num(n):
    if not n: return '0'
    s = str(n).split('/')[0].strip().lstrip('0') or '0'
    return s

def norm_name(s):
    if not s: return ''
    t = s.lower().strip()
    # 'Name - 123/456' → 'name'
    t = re.sub(r'\s*-\s*\d+\s*[/]\s*\d+\s*$', '', t)
    t = re.sub(r'\s*-\s*\d+\s*$', '', t)
    # accent → ASCII
    for src, dst in [('é','e'),('è','e'),('ô','o'),('â','a'),('í','i'),('•',''),('★','')]:
        t = t.replace(src, dst)
    t = re.sub(r'[\.\*]', '', t)
    t = re.sub(r'\s+', ' ', t).strip()
    return t

def main():
    conn = psycopg2.connect(**PG); conn.autocommit = True; cur = conn.cursor()
    cur.execute("set statement_timeout = 0")

    # 1) cards 인덱스
    cur.execute("select slug, name, number, set_code from cards where game='pokemon'")
    all_cards = cur.fetchall()
    name_num2slug = {}
    for slug, name, number, set_code in all_cards:
        key = (norm_name(name), norm_num(number))
        name_num2slug.setdefault(key, []).append((slug, set_code))
    print(f"pokemon cards: {len(all_cards):,}")
    print(f"normalized (name,num) keys: {len(name_num2slug):,}")

    # 2) Pokemon TCG API /sets
    api_sets = ptcg_get('/sets', {'pageSize': '250'}).get('data', [])
    print(f"API sets: {len(api_sets)}")

    metrics_inserted = 0
    matched_slugs = set()
    calls = 0
    api_errors = 0

    # 최적화: sleep 0.1s + batch insert (set 단위로 한 번에 commit)
    UPSERT_SQL = """insert into price_metrics_external
        (card_slug, source, ext_avg_24h, ext_avg_7d, ext_avg_30d, ext_currency, ext_updated_at, updated_at)
        values (%s, 'pokemontcg-cardmarket', %s, %s, %s, 'EUR', now(), now())
        on conflict (card_slug) do update set
          source='pokemontcg-cardmarket',
          ext_avg_24h=excluded.ext_avg_24h,
          ext_avg_7d=excluded.ext_avg_7d,
          ext_avg_30d=excluded.ext_avg_30d,
          ext_updated_at=now(), updated_at=now()"""

    for api_set in api_sets:
        api_set_id = api_set['id']
        api_set_name = api_set.get('name', '')
        try:
            d = ptcg_get('/cards', {
                'q': f'set.id:{api_set_id}',
                'pageSize': '250',
                'select': 'id,name,number,cardmarket'
            })
            calls += 1
        except Exception as e:
            api_errors += 1
            print(f"  ERR {api_set_id}: {str(e)[:60]}")
            time.sleep(1)
            continue

        cards_api = d.get('data', [])
        if not cards_api:
            time.sleep(0.1)
            continue

        # set 단위로 batch upsert (psycopg2 executemany)
        rows = []
        for c in cards_api:
            key = (norm_name(c.get('name')), norm_num(c.get('number')))
            if key not in name_num2slug: continue
            cm = c.get('cardmarket') or {}
            cmp = cm.get('prices') or {}
            avg1, avg7, avg30 = cmp.get('avg1'), cmp.get('avg7'), cmp.get('avg30')
            if avg30 is None and avg7 is None and avg1 is None: continue
            for slug, _sc in name_num2slug[key]:
                rows.append((slug, avg1, avg7, avg30))
                matched_slugs.add(slug)
        if rows:
            try:
                cur.executemany(UPSERT_SQL, rows)
                metrics_inserted += len(rows)
            except Exception as e:
                print(f"  ERR upsert {api_set_id}: {str(e)[:60]}")
        if rows:
            print(f"  {api_set_id:<15} {api_set_name[:30]:30s} matched={len(rows)}")
        time.sleep(0.1)

    print(f"\ntotal upserts: {metrics_inserted}")
    print(f"unique slugs matched: {len(matched_slugs):,}")
    print(f"API calls: {calls}, errors: {api_errors}")

    # MV refresh
    cur.execute('select refresh_card_price_summary()')
    print("MV refreshed")

    # 최종 통계
    cur.execute("select count(distinct card_slug) from price_metrics_external where source='pokemontcg-cardmarket'")
    total_cm = cur.fetchone()[0]
    cur.execute("select count(*) from cards where game='pokemon'")
    total_cards = cur.fetchone()[0]
    print(f"cardmarket coverage: {total_cm:,}/{total_cards:,} ({total_cm*100//total_cards}%)")

    cur.close(); conn.close()

if __name__ == "__main__":
    main()
