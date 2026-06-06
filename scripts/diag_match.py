#!/usr/bin/env python3
"""[읽기 전용 진단2] cards.set_id 분포 + PTCG API 매핑 가능 여부 집계. 쓰기 0."""
import os, sys, json, urllib.request, urllib.parse, psycopg2
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
sets = ptcg_get('/sets', {'pageSize':'250'}).get('data', [])
valid_ids = set(s['id'] for s in sets)
code2id = {}
for s in sets:
    code = (s.get('ptcgoCode') or '').strip().lower()
    if code: code2id.setdefault(code, s['id'])
print(f"PTCG API sets: {len(valid_ids)} / ptcgoCode 매핑: {len(code2id)}", flush=True)
conn = psycopg2.connect(**PG); conn.autocommit=True; cur=conn.cursor()
cur.execute("select coalesce(set_id,'(null)'), count(*) from cards where game='pokemon' group by 1 order by 2 desc")
dist = cur.fetchall()
print(f"\n=== DB set_id 분포 (총 {len(dist)}종) ===", flush=True)
cat_cards = {'VALID':0,'MAPPABLE':0,'NOTAPI':0}
notapi = []
for sid, cnt in dist:
    s = sid.lower()
    if sid in valid_ids: cat_cards['VALID']+=cnt; tag='VALID'
    elif s in code2id: cat_cards['MAPPABLE']+=cnt; tag=f'MAP->{code2id[s]}'
    else: cat_cards['NOTAPI']+=cnt; tag='NOT-IN-API'; notapi.append((sid,cnt))
    if cnt>=50 or tag!='VALID':
        print(f"  {sid:12s} {cnt:6d}  {tag}", flush=True)
print("\n=== 카드 수 분류 ===", flush=True)
print(f"  VALID(바로 갱신)      {cat_cards['VALID']:,}", flush=True)
print(f"  MAPPABLE(매핑하면)    {cat_cards['MAPPABLE']:,}", flush=True)
print(f"  NOT-IN-API(불가)      {cat_cards['NOTAPI']:,}", flush=True)
print("\n=== NOT-IN-API set_id ===", flush=True)
for sid,cnt in sorted(notapi,key=lambda x:-x[1])[:30]: print(f"  {sid:12s} {cnt}", flush=True)
cur.close(); conn.close()
