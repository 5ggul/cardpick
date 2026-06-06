#!/usr/bin/env python3
"""[읽기 전용 진단] cold rotation 이름+번호 매칭이 왜 실패하는지 샘플 25장으로 확정.
DB의 stale-priced 카드 vs 그 set의 Pokemon TCG API 카드 (이름/번호) 대조. 쓰기 0.
"""
import os, sys, re, json, time, urllib.request, urllib.parse, psycopg2
sys.stdout.reconfigure(line_buffering=True)

API_KEY = os.environ.get("POKEMON_TCG_API_KEY","").strip()
PG = dict(host=os.environ.get("SUPABASE_DB_HOST","aws-1-ap-northeast-2.pooler.supabase.com"),
          port=int(os.environ.get("SUPABASE_DB_PORT","6543")),
          user=os.environ.get("SUPABASE_DB_USER","postgres.aqxrmdratnkffvivguqs"),
          password=os.environ.get("SUPABASE_DB_PASSWORD"), dbname="postgres",
          sslmode="require", connect_timeout=30)

def ptcg_get(path, params=None):
    qs = ('?'+urllib.parse.urlencode(params)) if params else ''
    req = urllib.request.Request(f"https://api.pokemontcg.io/v2{path}{qs}",
        headers={"X-Api-Key":API_KEY,"User-Agent":"cardpick-diag/1.0","Accept":"application/json"})
    return json.loads(urllib.request.urlopen(req, timeout=60).read())

def norm_name(s):
    if not s: return ''
    t = s.lower().strip()
    t = re.sub(r'\s*-\s*\d+\s*[/]\s*\d+\s*$','',t)
    t = re.sub(r'\s*-\s*\d+\s*$','',t)
    for a,b in [('é','e'),('è','e'),('ô','o'),('â','a'),('í','i'),('•',''),('★','')]: t=t.replace(a,b)
    t = re.sub(r'[\.\*]','',t); t = re.sub(r'\s+',' ',t).strip()
    return t
def norm_num(n):
    if not n: return '0'
    return str(n).split('/')[0].strip().lstrip('0') or '0'

conn = psycopg2.connect(**PG); conn.autocommit=True; cur=conn.cursor()
cur.execute("""
  with last_p as (select card_slug, max(fetched_at) latest from prices where source='tcgplayer' group by card_slug)
  select c.slug, c.name, c.number, c.set_id
  from cards c join last_p p on p.card_slug=c.slug
  where c.game='pokemon' and p.latest < now() - interval '14 days'
  order by p.latest asc nulls first limit 25
""")
rows = cur.fetchall()
print(f"=== stale-priced 샘플 {len(rows)}장 진단 ===", flush=True)

set_cache = {}
reasons = {'MATCH+price':0,'MATCH but no-tcgplayer-price':0,'set_id NULL':0,'set fetch 0/404':0,'name+num MISMATCH':0}
for slug, name, number, set_id in rows:
    if not set_id:
        reasons['set_id NULL']+=1
        print(f"[set_id NULL] {slug} | name={name!r} num={number!r}", flush=True); continue
    if set_id not in set_cache:
        try:
            d = ptcg_get('/cards', {'q':f'set.id:{set_id}','pageSize':'250','select':'id,name,number,tcgplayer'})
            set_cache[set_id] = d.get('data',[])
        except Exception as e:
            set_cache[set_id] = None
            print(f"[set fetch ERR] {set_id}: {str(e)[:50]}", flush=True)
        time.sleep(0.15)
    api_cards = set_cache.get(set_id)
    if not api_cards:
        reasons['set fetch 0/404']+=1
        print(f"[set 0/404] {slug} | set_id={set_id}", flush=True); continue
    keymap = {(norm_name(c.get('name')), norm_num(c.get('number'))): c for c in api_cards}
    k = (norm_name(name), norm_num(number))
    if k in keymap:
        c = keymap[k]
        has_tp = bool((c.get('tcgplayer') or {}).get('prices'))
        if has_tp: reasons['MATCH+price']+=1
        else:
            reasons['MATCH but no-tcgplayer-price']+=1
            print(f"[MATCH no-price] {slug} | {k}", flush=True)
    else:
        reasons['name+num MISMATCH']+=1
        same_num = [(norm_name(c.get('name')), norm_num(c.get('number'))) for c in api_cards if norm_num(c.get('number'))==k[1]]
        print(f"[MISMATCH] {slug} | DB={k} | set={set_id} | 같은번호 API후보={same_num[:3]}", flush=True)

print("\n=== 실패 사유 집계 ===", flush=True)
for r,n in reasons.items(): print(f"  {r:32s} {n}", flush=True)
cur.close(); conn.close()
