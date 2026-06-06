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

# stdout 즉시 flush — GitHub Actions 로그에 실시간 보이도록
try:
    sys.stdout.reconfigure(line_buffering=True)
except Exception:
    pass

print(f"=== refresh_cold_pokemon.py START at {datetime.utcnow().isoformat()} ==="); sys.stdout.flush()

API_KEY = os.environ.get("POKEMON_TCG_API_KEY", "").strip()
if not API_KEY:
    print("ERR: POKEMON_TCG_API_KEY missing"); sys.exit(1)

# 단계 제어 — 매일은 Phase B만 (가벼움), 주 1회만 Phase A (sets discover)
RUN_PHASE_A = os.environ.get("RUN_PHASE_A", "1") == "1"
RUN_PHASE_B = os.environ.get("RUN_PHASE_B", "1") == "1"
PHASE_A_TIMEOUT_SEC = int(os.environ.get("PHASE_A_TIMEOUT_SEC", "2400"))  # 40분
PHASE_B_TIMEOUT_SEC = int(os.environ.get("PHASE_B_TIMEOUT_SEC", "2400"))  # 40분
print(f"  config: RUN_PHASE_A={RUN_PHASE_A}  RUN_PHASE_B={RUN_PHASE_B}"); sys.stdout.flush()

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

def ptcg_get(path, params=None, retries=2):
    """Pokemon TCG API GET with retry on timeout. timeout 60s + 2 retries."""
    qs = ('?' + urllib.parse.urlencode(params)) if params else ''
    last_err = None
    for attempt in range(retries + 1):
        try:
            req = urllib.request.Request(
                f"https://api.pokemontcg.io/v2{path}{qs}",
                headers={
                    "X-Api-Key": API_KEY,
                    "User-Agent": "Mozilla/5.0 (X11; Linux x86_64) cardpick/1.0",
                    "Accept": "application/json",
                }
            )
            return json.loads(urllib.request.urlopen(req, timeout=60).read())
        except Exception as e:
            last_err = e
            if attempt < retries:
                time.sleep(2 + attempt * 2)
                continue
            raise last_err

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
            # CLAUDE.md §2-1 사고 1 — source name 'tcgplayer' (MV card_price_summary 인식)
            # 'pokemontcg-tcgplayer'로 인서트 시 MV에서 무시됨 → Trust Gate NONE 영원히 유지
            cur.execute("""insert into prices
                (card_slug, source, variant, currency,
                 price_low, price_mid, price_market, price_high,
                 price_krw, exchange_rate, fetched_at)
                values (%s, 'tcgplayer', %s, 'USD',
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

def discover_new_cards(cur, fx, deadline_ts):
    print("\n=== Phase A: discover new cards ==="); sys.stdout.flush()
    # 기존 external_id 인덱스
    cur.execute("select external_id from cards where game='pokemon' and external_id is not null")
    have = set(r[0] for r in cur.fetchall())
    print(f"  known external_id: {len(have):,}"); sys.stdout.flush()

    # sets 전부 fetch
    try:
        sets = ptcg_get('/sets', {'pageSize': '250'}).get('data', [])
    except Exception as e:
        print(f"  ERR fetch /sets: {e}"); return 0, 0
    print(f"  API sets: {len(sets)}"); sys.stdout.flush()

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

    for si, s in enumerate(sets):
        # deadline 체크 — Phase A 시간 초과 시 안전하게 종료
        if time.time() > deadline_ts:
            print(f"  [TIMEOUT] Phase A deadline at set {si}/{len(sets)} — stopping gracefully"); sys.stdout.flush()
            break
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
            print(f"  ERR set {set_id}: {str(e)[:60]}"); sys.stdout.flush()
            time.sleep(1); continue
        # 10셋마다 진행 상황 print (실시간 가시성)
        if si % 10 == 0:
            print(f"  [progress] set {si+1}/{len(sets)} ({set_id}) new={inserted_cards} api_calls={api_calls}"); sys.stdout.flush()

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

def _norm_name(s):
    """refresh_pokemon_tcg_api.py의 norm_name과 동일 — name+number 매칭용."""
    if not s: return ''
    t = s.lower().strip()
    t = re.sub(r'\s*-\s*\d+\s*[/]\s*\d+\s*$', '', t)
    t = re.sub(r'\s*-\s*\d+\s*$', '', t)
    for src, dst in [('é','e'),('è','e'),('ô','o'),('â','a'),('í','i'),('•',''),('★','')]:
        t = t.replace(src, dst)
    t = re.sub(r'[\.\*]', '', t)
    t = re.sub(r'\s+', ' ', t).strip()
    return t

def _norm_num(n):
    if not n: return '0'
    s = str(n).split('/')[0].strip().lstrip('0') or '0'
    return s

def cold_rotation(cur, fx, deadline_ts):
    """Phase B — set 단위 fetch + name+num 매칭 패턴 (CLAUDE.md §2-1 사고 2 fix).
    옛 'OR id:<eid>' 패턴은 external_id가 TCGCSV 숫자 ID인 카드에서 100% fail.
    refresh_pokemon_tcg_api.py와 같은 패턴으로 통일.
    """
    print("\n=== Phase B: cold rotation (set-based) ==="); sys.stdout.flush()

    # 0) TCGplayer 가격 못 찾은 횟수 추적 컬럼 (idempotent)
    #    불가능 카드(커먼·에너지·일판 등 TCGplayer 가격 없음)가 큐를 무한 점유하는 것 방지
    cur.execute("alter table cards add column if not exists tcgplayer_miss int default 0")

    # 1) Target — 2버킷 분할 (CLAUDE.md §2-1 — 보이는 카드 우선 갱신)
    #    버킷1(우선 75%): 이미 가격 있는데 STALE_DAYS+ 된 카드 = 화면에 보이는 카드 신선화
    #    버킷2(25%): 가격 없고 tcgplayer_miss < 3 인 카드 = 신규 커버리지 (무한 재시도 차단)
    n_refresh = max(1, int(COLD_TARGET * 0.75))
    n_discover = max(1, COLD_TARGET - n_refresh)
    # 버킷1: stale priced (오래된 순)
    cur.execute(f"""
        with last_p as (
          select card_slug, max(fetched_at) as latest
          from prices where source='tcgplayer' group by card_slug
        )
        select c.slug, c.name, c.number, c.set_id
        from cards c join last_p p on p.card_slug = c.slug
        where c.game='pokemon' and p.latest < now() - interval '{STALE_DAYS} days'
        order by p.latest asc nulls first, c.popularity_rank asc nulls last
        limit %s
    """, (n_refresh,))
    bucket_refresh = cur.fetchall()
    # 버킷2: never-priced, 3회 미만 실패 (또는 마지막 시도 30일+ 경과한 카드도 가끔 재시도)
    cur.execute(f"""
        with last_p as (
          select card_slug, max(fetched_at) as latest
          from prices where source='tcgplayer' group by card_slug
        )
        select c.slug, c.name, c.number, c.set_id
        from cards c left join last_p p on p.card_slug = c.slug
        where c.game='pokemon' and p.latest is null
          and coalesce(c.tcgplayer_miss,0) < 3
        order by c.popularity_rank asc nulls last
        limit %s
    """, (n_discover,))
    bucket_discover = cur.fetchall()
    targets = bucket_refresh + bucket_discover
    print(f"  targets: refresh(stale>{STALE_DAYS}d)={len(bucket_refresh):,}  discover(new, miss<3)={len(bucket_discover):,}  total={len(targets):,}"); sys.stdout.flush()
    if not targets:
        print("  nothing to do"); return 0, 0

    # 2) (norm_name, norm_num) → [slugs] 매핑 + 대상 sets 추출
    name_num2slugs = {}
    sets_to_fetch = set()
    for slug, name, number, set_id in targets:
        key = (_norm_name(name), _norm_num(number))
        name_num2slugs.setdefault(key, []).append(slug)
        if set_id:
            sets_to_fetch.add(set_id)
    print(f"  unique (name,num) keys: {len(name_num2slugs):,}  unique sets: {len(sets_to_fetch)}"); sys.stdout.flush()

    # job 로그
    cur.execute("""insert into api_update_logs
        (source, job_name, status, requested_count, started_at)
        values ('pokemontcg-api', %s, 'started', %s, now()) returning id""",
        (f"cold-rotation-{COLD_TARGET}", len(targets)))
    job_id = cur.fetchone()[0]

    updated = 0
    failed = 0
    calls = 0
    matched_slugs = set()

    # 3) Set 단위 fetch (refresh_pokemon_tcg_api.py와 동일 패턴)
    sets_list = sorted(sets_to_fetch)  # 결정적 순서
    for si, set_id in enumerate(sets_list):
        if time.time() > deadline_ts:
            print(f"  [TIMEOUT] Phase B deadline at set {si}/{len(sets_list)} — stopping"); sys.stdout.flush()
            break
        try:
            d = ptcg_get('/cards', {
                'q': f'set.id:{set_id}',
                'pageSize': '250',
                'select': 'id,name,number,tcgplayer,cardmarket'
            })
            calls += 1
        except Exception as e:
            print(f"  ERR set {set_id}: {str(e)[:60]}"); sys.stdout.flush()
            time.sleep(1); continue

        set_updated = 0
        for c in d.get('data', []):
            key = (_norm_name(c.get('name')), _norm_num(c.get('number')))
            if key not in name_num2slugs: continue
            for slug in name_num2slugs[key]:
                if slug in matched_slugs: continue
                ins = insert_prices_for_card(cur, slug, c, fx)
                if ins > 0:
                    matched_slugs.add(slug)
                    set_updated += 1
                    updated += 1

        # set별 진행 print
        if si % 5 == 0 or set_updated > 0:
            print(f"  [progress] set {si+1}/{len(sets_list)} {set_id:<15} updated_so_far={updated}"); sys.stdout.flush()
        time.sleep(0.1)

    # 4) failed = target 중 update 안 된 카드 수
    target_slugs = set(t[0] for t in targets)
    failed_slugs = target_slugs - matched_slugs
    failed = len(failed_slugs)

    # 4-1) miss 추적: 못 채운 카드 +1 (3회 누적 시 버킷2에서 제외), 성공 카드 0 리셋
    if failed_slugs:
        cur.execute("update cards set tcgplayer_miss = coalesce(tcgplayer_miss,0) + 1 where slug = any(%s)",
                    (list(failed_slugs),))
    if matched_slugs:
        cur.execute("update cards set tcgplayer_miss = 0 where slug = any(%s) and coalesce(tcgplayer_miss,0) <> 0",
                    (list(matched_slugs),))

    cur.execute("""update api_update_logs set status='completed',
        updated_count=%s, failed_count=%s, api_calls_used=%s, finished_at=now()
        where id=%s""", (updated, failed, calls, job_id))

    print(f"\n  Phase B done: updated={updated}  failed={failed}  calls={calls}  matched_slugs={len(matched_slugs)}"); sys.stdout.flush()
    return updated, failed

# ---------------------------------------------------------------- main

def setup_board(cur):
    """게시판 인프라 setup (idempotent — 이미 있으면 skip).
    posts.images 컬럼 + Storage bucket + RLS policies + view counter RPC.
    """
    print("\n=== Setup board infra (idempotent) ==="); sys.stdout.flush()
    # 1. posts.images 컬럼
    cur.execute("alter table posts add column if not exists images jsonb default '[]'::jsonb")
    print("  [ok] posts.images column"); sys.stdout.flush()
    # 2. increment_post_views RPC
    cur.execute("""create or replace function increment_post_views(pid uuid)
      returns void language sql security definer set search_path = public
      as $func$ update posts set views = coalesce(views, 0) + 1 where id = pid; $func$""")
    cur.execute("grant execute on function increment_post_views(uuid) to anon, authenticated")
    print("  [ok] increment_post_views function"); sys.stdout.flush()
    # 3. Storage bucket (post-images, public)
    cur.execute("""insert into storage.buckets (id, name, public, created_at, updated_at)
      values ('post-images', 'post-images', true, now(), now())
      on conflict (id) do update set public = true, updated_at = now()""")
    print("  [ok] storage bucket 'post-images' (public)"); sys.stdout.flush()
    # 4. RLS policies for storage.objects
    cur.execute("""do $policies$ begin
      if not exists (select 1 from pg_policies where schemaname='storage' and tablename='objects' and policyname='post_images_public_read') then
        create policy post_images_public_read on storage.objects for select to public using (bucket_id = 'post-images');
      end if;
      if not exists (select 1 from pg_policies where schemaname='storage' and tablename='objects' and policyname='post_images_auth_insert') then
        create policy post_images_auth_insert on storage.objects for insert to authenticated with check (bucket_id = 'post-images');
      end if;
      if not exists (select 1 from pg_policies where schemaname='storage' and tablename='objects' and policyname='post_images_auth_delete') then
        create policy post_images_auth_delete on storage.objects for delete to authenticated using (bucket_id = 'post-images');
      end if;
    end $policies$""")
    print("  [ok] storage RLS policies"); sys.stdout.flush()
    # 5. price_update_requests unique constraint + RPC fix
    cur.execute("""do $cons$ begin
      if not exists (select 1 from pg_constraint where conname='price_update_requests_card_slug_key') then
        alter table price_update_requests add constraint price_update_requests_card_slug_key unique (card_slug);
      end if;
    end $cons$""")
    print("  [ok] price_update_requests unique constraint"); sys.stdout.flush()
    # 5-b. log_price_update_request — 기존 함수가 default 파라미터 시그니처면 create or replace 거부
    # → DROP 후 CREATE (다른 시그니처도 정리)
    for sig in ['(text, text)', '(text)', '()']:
        try:
            cur.execute(f"drop function if exists log_price_update_request{sig}")
        except Exception:
            pass
    try:
        cur.execute("""create or replace function log_price_update_request(p_query text, p_card_slug text)
          returns void language plpgsql security definer set search_path = public
          as $func$ begin
            if p_card_slug is not null and p_card_slug != '' then
              insert into price_update_requests (card_slug, query, request_count, last_requested_at, status)
              values (p_card_slug, p_query, 1, now(), 'pending')
              on conflict (card_slug) do update set
                request_count = price_update_requests.request_count + 1,
                last_requested_at = now(),
                status = 'pending';
            else
              insert into price_update_requests (card_slug, query, request_count, last_requested_at, status)
              values (null, p_query, 1, now(), 'pending');
            end if;
          end; $func$""")
        cur.execute("grant execute on function log_price_update_request(text, text) to anon, authenticated")
        print("  [ok] log_price_update_request RPC"); sys.stdout.flush()
    except Exception as e:
        print(f"  [warn] log_price_update_request: {str(e)[:80]}"); sys.stdout.flush()
    # 6. get_hot_cards RPC — 일단 trust 의존성 없는 안전 버전으로 정의
    # (trust MV가 이 시점엔 아직 없을 수 있어서)
    try:
        cur.execute("""create or replace function get_hot_cards()
          returns table(
            category text, rank int, card_slug text, name text, name_ko text,
            set_name text, set_code text, rarity_class text,
            latest_krw numeric, change_7d_pct numeric, samples_7d int,
            reason text, hot_score numeric
          ) language sql security definer set search_path = public
          as $func$
            select
              hc.category, hc.rank, hc.card_slug, c.name, c.name_ko,
              c.set_name, c.set_code, c.rarity_class,
              s.latest_krw, s.change_7d_pct, s.samples_7d,
              hc.reason, hc.hot_score
            from hot_cards hc
            left join cards c on c.slug = hc.card_slug
            left join card_price_summary_best s on s.card_slug = hc.card_slug
            where hc.date = (select max(date) from hot_cards)
            order by hc.category, hc.rank
          $func$""")
        cur.execute("grant execute on function get_hot_cards() to anon, authenticated")
        print("  [ok] get_hot_cards RPC (initial, no trust dep)"); sys.stdout.flush()
    except Exception as e:
        print(f"  [warn] get_hot_cards (initial): {str(e)[:120]}"); sys.stdout.flush()
    # 7. [Codex P0-1] refresh_card_price_summary RPC anon execute 회수 (DB 부하 공격 방어)
    cur.execute("""do $sec$ begin
      if exists (select 1 from pg_proc where proname='refresh_card_price_summary') then
        revoke execute on function refresh_card_price_summary() from anon, authenticated;
      end if;
    end $sec$""")
    print("  [ok] revoke MV refresh from anon/authenticated"); sys.stdout.flush()
    # 8. [Codex P0-2] Storage delete policy owner 강제 (타인 이미지 삭제 방어)
    cur.execute("""do $del$ begin
      drop policy if exists post_images_auth_delete on storage.objects;
      create policy post_images_auth_delete on storage.objects
        for delete to authenticated
        using (bucket_id = 'post-images' and owner = auth.uid());
    end $del$""")
    print("  [ok] storage delete policy: owner enforced"); sys.stdout.flush()
    # 9. [URGENT] MV card_price_summary_best 재정의 — last_fetched_at = max(prices.fetched_at)
    # 옛 DB가 last_fetched_at을 prices.fetched_at에 연결 안 함 → 화면 갱신 안 됨
    cur.execute("""
        do $mvfix$ begin
            -- card_price_summary 도 동일 패턴 — 기존 정의 무시하고 다시 refresh
            -- card_price_summary_best는 card_price_summary의 best variant 선택
            -- 우리는 last_fetched_at을 prices에서 직접 가져오는 view 추가
            create or replace view v_price_freshness as
            select card_slug,
                   max(fetched_at) as last_fetched_at,
                   count(distinct date_trunc('day', fetched_at)) filter (where fetched_at > now() - interval '7 days') as samples_7d_real,
                   count(distinct date_trunc('day', fetched_at)) filter (where fetched_at > now() - interval '30 days') as samples_30d_real
            from prices
            where source like 'pokemontcg%'
            group by card_slug;
        end $mvfix$
    """)
    cur.execute("grant select on v_price_freshness to anon, authenticated")
    print("  [ok] v_price_freshness view created (real fetched_at from prices)"); sys.stdout.flush()
    # 10. [eBay] cards 캐시 컬럼 4개 (idempotent) — refresh_ebay_active.py가 채움
    cur.execute("alter table cards add column if not exists ebay_active_avg_krw numeric")
    cur.execute("alter table cards add column if not exists ebay_active_low_krw numeric")
    cur.execute("alter table cards add column if not exists ebay_active_count integer")
    cur.execute("alter table cards add column if not exists ebay_last_fetched_at timestamptz")
    cur.execute("create index if not exists idx_cards_ebay_last_fetched on cards(ebay_last_fetched_at nulls first)")
    print("  [ok] cards.ebay_* columns (active_avg_krw, active_low_krw, active_count, last_fetched_at)"); sys.stdout.flush()
    # 11. [eBay] prices.source 허용 목록 — 'ebay-active' enum/check 없으면 추가
    # prices.source가 text 컬럼이므로 별도 처리 불필요. 단, 분석 view 확장.
    cur.execute("""
        create or replace view v_ebay_summary as
        select c.slug,
               c.name,
               c.number,
               c.set_name,
               c.rarity_class,
               b.latest_krw      as tcgplayer_krw,
               b.samples_7d      as tcgplayer_samples_7d,
               c.ebay_active_avg_krw,
               c.ebay_active_low_krw,
               c.ebay_active_count,
               c.ebay_last_fetched_at,
               -- 차이율: eBay avg가 TCGplayer보다 얼마나 다른지
               case
                 when b.latest_krw > 0 and c.ebay_active_avg_krw > 0
                 then round(((c.ebay_active_avg_krw - b.latest_krw)::numeric / b.latest_krw * 100), 1)
                 else null
               end as ebay_vs_tcg_pct
        from cards c
        join card_price_summary_best b on b.card_slug = c.slug
        where c.game = 'pokemon'
          and (c.ebay_active_avg_krw is not null or b.latest_krw > 0)
    """)
    cur.execute("grant select on v_ebay_summary to anon, authenticated")
    print("  [ok] v_ebay_summary view (TCGplayer vs eBay 차이 분석)"); sys.stdout.flush()
    # 12. [Trust Gate] Price reliability infrastructure (Codex 검수 반영)
    # ★ 사고: TCGplayer 표본 1건짜리 ₩152 outlier 화면 노출 (Mew ex 232/091)
    # 보완: distinct count + clean median + MAD outlier 제거 + price-band ratio + 4단계 신뢰도
    # ★ 각 step try/except로 격리 — 한 SQL fail해도 다음 step 진행
    # 12-a) Price-band ratio gate 함수 (price < 3k 절대차 / 3k~50k 0.3~3 / >50k 0.5~2)
    try:
        cur.execute("""
            create or replace function cardpick_ratio_gate(p_new numeric, p_median numeric)
            returns boolean language sql immutable as $func$
              select case
                when p_new is null or p_median is null or p_median <= 0 then false
                when p_median < 3000 then abs(p_new - p_median) < 5000
                when p_median < 50000 then p_new / p_median between 0.3 and 3.0
                else p_new / p_median between 0.5 and 2.0
              end
            $func$
        """)
        print("  [ok] cardpick_ratio_gate function"); sys.stdout.flush()
    except Exception as e:
        print(f"  [warn] cardpick_ratio_gate: {str(e)[:120]}"); sys.stdout.flush()
    # 12-b) card_price_trust MV — safer SQL (composite distinct 제거)
    # 기존 MV 있으면 drop 후 재생성 (스키마 변경 시 IF NOT EXISTS는 무시됨)
    try:
        cur.execute("drop materialized view if exists card_price_trust cascade")
    except Exception as e:
        print(f"  [warn] drop card_price_trust: {str(e)[:80]}"); sys.stdout.flush()
    try:
        cur.execute("""
        create materialized view card_price_trust as
        with
          p30 as (
            select card_slug, price_krw, fetched_at, variant, source,
                   fetched_at::date as d
            from prices
            where fetched_at > now() - interval '30 days'
              and price_krw is not null and price_krw > 0
              and source in ('tcgplayer','pokemontcg-tcgplayer','pokemontcg-cardmarket')
          ),
          -- 별도 CTE로 distinct triplets dedupe (composite distinct 회피)
          distinct_triplets as (
            select card_slug, variant, d, source,
                   max(fetched_at) as fetched_at
            from p30
            group by card_slug, variant, d, source
          ),
          counts as (
            select card_slug,
                   count(*) filter (where fetched_at > now() - interval '7 days')::int as distinct_7d,
                   count(*)::int as distinct_30d
            from distinct_triplets
            group by card_slug
          ),
          median_calc as (
            select card_slug,
                   percentile_cont(0.5) within group (order by price_krw) as median_30d_krw
            from p30
            group by card_slug
          ),
          mad as (
            select p.card_slug,
                   percentile_cont(0.5) within group (order by abs(p.price_krw - m.median_30d_krw)) as mad
            from p30 p
            join median_calc m on m.card_slug = p.card_slug
            group by p.card_slug
          ),
          cleaned as (
            select p.card_slug, p.price_krw
            from p30 p
            join median_calc m on m.card_slug = p.card_slug
            join mad mm on mm.card_slug = p.card_slug
            where abs(p.price_krw - m.median_30d_krw) < greatest(3 * coalesce(mm.mad, 0), m.median_30d_krw * 0.05)
          ),
          clean_stats as (
            select card_slug,
                   percentile_cont(0.5) within group (order by price_krw) as clean_30d_median_krw,
                   count(*)::int as clean_30d_n
            from cleaned
            group by card_slug
          )
        select
          c.card_slug,
          c.distinct_7d,
          c.distinct_30d,
          coalesce(cs.clean_30d_n, 0) as clean_30d_n,
          round(coalesce(cs.clean_30d_median_krw, 0))::numeric as clean_30d_median_krw,
          round(coalesce(best.latest_krw, 0))::numeric as latest_krw,
          case
            when coalesce(cs.clean_30d_n, 0) < 5 then 'NONE'
            when c.distinct_7d >= 5 and cardpick_ratio_gate(best.latest_krw::numeric, cs.clean_30d_median_krw::numeric) then 'HIGH'
            when c.distinct_30d >= 10 then 'MEDIUM'
            else 'LOW'
          end as trust_level,
          case
            when coalesce(cs.clean_30d_n, 0) < 5 then null::numeric
            when c.distinct_7d >= 5 and cardpick_ratio_gate(best.latest_krw::numeric, cs.clean_30d_median_krw::numeric) then round(best.latest_krw)::numeric
            else round(cs.clean_30d_median_krw)::numeric
          end as display_krw,
          now() as computed_at
        from counts c
        left join clean_stats cs on cs.card_slug = c.card_slug
        left join card_price_summary_best best on best.card_slug = c.card_slug
        """)
        cur.execute("create unique index if not exists idx_card_price_trust_slug on card_price_trust (card_slug)")
        cur.execute("create index if not exists idx_card_price_trust_level on card_price_trust (trust_level)")
        cur.execute("grant select on card_price_trust to anon, authenticated")
        print("  [ok] card_price_trust MV (distinct + MAD + 4-tier trust level)"); sys.stdout.flush()
    except Exception as e:
        print(f"  [ERROR] card_price_trust MV: {str(e)[:200]}"); sys.stdout.flush()
    # 12-c) Refresh function — daily cron 후 호출 (CONCURRENTLY: 다운타임 0)
    try:
        cur.execute("""
            create or replace function refresh_card_price_trust()
            returns void language plpgsql security definer set search_path = public as $func$
            begin
              -- CONCURRENTLY 우선, 실패 시 일반 REFRESH (unique index 필수)
              begin
                refresh materialized view concurrently card_price_trust;
              exception when others then
                refresh materialized view card_price_trust;
              end;
            end;
            $func$
        """)
        cur.execute("revoke execute on function refresh_card_price_trust() from anon, authenticated")
        print("  [ok] refresh_card_price_trust function"); sys.stdout.flush()
    except Exception as e:
        print(f"  [warn] refresh_card_price_trust: {str(e)[:120]}"); sys.stdout.flush()
    # 12-c-postgrest) PostgREST schema cache 강제 reload — 신규 MV 즉시 노출
    try:
        cur.execute("notify pgrst, 'reload schema'")
        print("  [ok] postgrest schema reload notified"); sys.stdout.flush()
    except Exception as e:
        print(f"  [warn] notify pgrst: {str(e)[:80]}"); sys.stdout.flush()
    # 12-d) get_hot_cards 재정의 — 모든 overload DROP (Postgres 제약)
    # 옛 (p_date date) 시그니처도 같이 제거 — PostgREST overload 충돌 방지
    for sig in ['()', '(date)', '(p_date date)']:
        try:
            cur.execute(f"drop function if exists get_hot_cards{sig}")
        except Exception:
            pass
    try:
        cur.execute("""create or replace function get_hot_cards()
          returns table(
            category text, rank int, card_slug text, name text, name_ko text,
            set_name text, set_code text, rarity_class text,
            latest_krw numeric, change_7d_pct numeric, samples_7d int,
            reason text, hot_score numeric,
            trust_level text
          ) language sql security definer set search_path = public
          as $func$
            select
              hc.category, hc.rank, hc.card_slug, c.name, c.name_ko,
              c.set_name, c.set_code, c.rarity_class,
              s.latest_krw, s.change_7d_pct, s.samples_7d,
              hc.reason, hc.hot_score,
              coalesce(t.trust_level, 'UNKNOWN') as trust_level
            from hot_cards hc
            left join cards c on c.slug = hc.card_slug
            left join card_price_summary_best s on s.card_slug = hc.card_slug
            left join card_price_trust t on t.card_slug = hc.card_slug
            where hc.date = (select max(date) from hot_cards)
              and coalesce(t.trust_level, 'UNKNOWN') != 'NONE'
            order by hc.category, hc.rank
          $func$""")
        cur.execute("grant execute on function get_hot_cards() to anon, authenticated")
        print("  [ok] get_hot_cards RPC (with trust_level filter)"); sys.stdout.flush()
    except Exception as e:
        print(f"  [warn] get_hot_cards (trust version): {str(e)[:120]}"); sys.stdout.flush()
    # 13. [Phase 2-1] alert_history — 가격 알림 발송 이력 (중복 방지)
    try:
        cur.execute("""
            create table if not exists public.alert_history (
                id uuid primary key default gen_random_uuid(),
                user_id uuid not null references auth.users(id) on delete cascade,
                card_slug text not null,
                trigger_type text not null check (trigger_type in ('threshold','target','trust_upgrade','new_listing')),
                price_before numeric,
                price_after numeric,
                change_pct numeric,
                trust_level text,
                email_sent boolean default false,
                email_sent_at timestamptz,
                resend_id text,
                created_at timestamptz default now()
            )
        """)
        cur.execute("create index if not exists alert_history_user_created on public.alert_history(user_id, created_at desc)")
        cur.execute("create index if not exists alert_history_card on public.alert_history(card_slug, created_at desc)")
        cur.execute("alter table public.alert_history enable row level security")
        cur.execute("""do $alert_rls$ begin
            if not exists (select 1 from pg_policies where schemaname='public' and tablename='alert_history' and policyname='alert_history_select_own') then
                create policy alert_history_select_own on public.alert_history for select using (auth.uid() = user_id);
            end if;
        end $alert_rls$""")
        # 같은 카드/사용자/같은 날 같은 trigger_type 알림 한 번만 (중복 방지)
        cur.execute("create unique index if not exists alert_history_dedupe on public.alert_history(user_id, card_slug, trigger_type, (created_at::date))")
        print("  [ok] alert_history table (price alert dedupe)"); sys.stdout.flush()
    except Exception as e:
        print(f"  [warn] alert_history: {str(e)[:120]}"); sys.stdout.flush()
    # 14. cards.released_at backfill (set_id별 releaseDate 매핑)
    try:
        sets_api = ptcg_get('/sets', {'pageSize': '250'}).get('data', [])
        updated = 0
        for s in sets_api:
            date_str = s.get('releaseDate')
            sid = s.get('id')
            if not date_str or not sid: continue
            try:
                d = datetime.strptime(date_str, '%Y/%m/%d').date()
            except Exception:
                continue
            cur.execute(
                "update cards set released_at = %s where game='pokemon' and set_id = %s and released_at is null",
                (d, sid)
            )
            updated += cur.rowcount
        print(f"  [ok] cards.released_at backfill — {updated} rows updated"); sys.stdout.flush()
    except Exception as e:
        print(f"  [warn] released_at backfill skip: {e}"); sys.stdout.flush()
    print("=== Setup done ===\n"); sys.stdout.flush()

def seed_board_posts(cur):
    """게시판 시드 글 — 운영자 8편 (idempotent, 한 번만 실행).

    실행 조건: admin user_id가 free/qna/show 보드에 글이 0개일 때만.
    이미 글 있으면 skip — 재실행 안전.
    """
    ADMIN_ID = '3e8782bc-4790-4d9a-91ad-cccddb68994a'
    cur.execute("""
        select count(*) from public.posts
        where user_id = %s and board in ('free','qna','show')
    """, (ADMIN_ID,))
    n = cur.fetchone()[0]
    if n > 0:
        print(f"\n[seed_board] skip — admin already has {n} posts in free/qna/show"); sys.stdout.flush()
        return 0

    print("\n=== Seed board posts (one-time) ==="); sys.stdout.flush()
    posts = [
        ('free', '카드픽 운영자 인사 — 사이트 소개와 사용법',
         '''안녕하세요. 카드픽(cardpick.kr) 운영자입니다.

카드픽은 한국 컬렉터를 위한 포켓몬 TCG 시세 정보 사이트입니다. TCGplayer 북미 market price를 KRW로 환산해서 약 24,000장 카드의 참고가를 매일 새벽 자동 갱신합니다.

## 주요 기능

- **메인 시세표** — 인기 카드 Top 20, 카테고리별 (상승/하락/관심) 탭
- **오늘의 핫카드** (/hot) — 7일 급등·하락 TOP 10, 고가 카드, 신규 갱신
- **카드 상세** — 카드별 7일/30일 변동률, eBay 활성 listing, Trust Gate 신뢰도 등급
- **가이드** (/guides) — 거래 안전·PSA 그레이딩·일본 직구·레어도 등급·가품 판별 6편 한국어 가이드
- **도구** (/tools) — 일본 직구 비용 계산기, PSA 손익분기

## 정직 원칙

- 표본 부족 카드는 "참고가 산출 불가"로 표시 (가짜 데이터 X)
- distinct count + MAD outlier 제거 + price-band ratio gate로 단일 listing outlier 자동 차단
- Cardmarket EU 데이터는 stale 사유로 차트 영구 폐기 — 정직한 표시 의무

## 게시판

자유게시판·질문게시판·거래게시판 운영 중입니다. 카드 관련 질문, 거래 후기, 컬렉션 자랑 자유롭게 올려주세요. 가품·사기 의심 사례 공유도 환영합니다.

피드백·문의: admin@cardpick.kr'''),

        ('free', '가이드 6편 발행 완료 — 한국어 포켓몬 TCG 가이드 모음',
         '''카드픽 가이드 6편이 모두 발행됐습니다. 한국 컬렉터가 가장 많이 검색하는 주제로 정리했어요.

## 발행 가이드

1. **TCG란? 트레이딩 카드 게임 입문 가이드** — 포켓몬·원피스·매직·유희왕·로르카나 5종 정리
2. **카드 거래 안전 체크리스트** — 판매자 평판·사진 인증·안전결제·가품 신호 7단계
3. **PSA 그레이딩 신청 가이드** — 한국 발송 직접 vs 한국 대행, 비용·기간·실수 7가지, BRG10 비교
4. **일본 직구 완전 가이드** — 한판·일판·영문판 시세 차이, 메루카리·야후옥션·포케카닷컴 구매처, 통관·관세
5. **포켓몬 카드 레어도 완전 정리** — SAR·SIR·UR·HR·IR·AR·RR·R·U·C 등급별 가격, 카드 표기 식별법
6. **포켓몬 카드 가품 판별법** — 인쇄·홀로·잉크·모서리·무게 5가지 식별 신호, 메루카리 가품 회피

각 글에 FAQ와 관련 가이드 cross-link이 들어 있어 한 글 읽다가 다음 글로 자연스럽게 넘어갈 수 있습니다.

전체 보기: /guides

새 글이 올라오면 RSS(/rss.xml)로 받아볼 수 있습니다. 추가로 다루었으면 하는 주제 있으시면 댓글로 알려주세요.'''),

        ('free', '이번 주 시세 변동 큰 카드 — /hot 페이지 보는 법',
         '''카드픽 /hot 페이지에서 오늘의 핫카드를 매일 새벽 자동 계산해 노출합니다.

## 카테고리

- **오늘의 핫카드 TOP 10** — 가격 변동·검색량·업데이트 요청 종합 점수
- **7일 급등 TOP 10** — 최근 7일 가격이 가장 많이 오른 카드
- **7일 하락 TOP 10** — 최근 7일 가격이 가장 많이 떨어진 카드
- **고가 카드 TOP 10** — 현재 시세 가장 높은 카드
- **신규 갱신** — 최근 가격 데이터 추가된 카드

## 시세 산정 기준

- TCGplayer 북미 market price 기반 (KRW 환산)
- 매일 새벽 5시 40분 KST 자동 갱신
- distinct 표본 카운트 + MAD outlier 제거 + price-band ratio gate
- 표본 부족 카드(distinct 7일 < 5)는 자동 제외

## 신뢰도 등급

HIGH·MEDIUM·LOW·NONE 4단계로 분류해서 카드 상세에서 함께 표시합니다. NONE 등급은 가격 표시 안 하고 "참고가 산출 불가" 박스로 처리해요.

자세한 알고리즘: /methodology

신뢰도 등급이나 변동률에 대해 궁금한 점 있으시면 질문게시판에 올려주세요.'''),

        ('free', '메루카리·중고나라 가품 주의 — 최근 자주 출몰하는 카드',
         '''한국 중고 시장에서 가품 보고가 자주 들어오는 카드를 정리합니다. 거래 전 신중하게 점검하세요.

## 자주 위조되는 카드

- **리자몽 ex SAR** (SV4a 샤이니 트레저, 영문판 Paldean Fates 232/091) — 위조 시도 1위
- **미라이돈 ex SAR / 코라이돈 ex SAR** (SV1 스칼렛&바이올렛)
- **피카츄 ex SAR** (SV8) — 최근 발매 + 인기 캐릭터
- **메가 리자몽 X / 메가 갸라도스 SAR** — 일본 직구 활발 카드
- **1세대 Base Set Charizard** — 25년 전 카드, 식별 어려움

## 의심 신호

- 시세 절반 이하 가격 (정상 셀러는 30%까지만 깎음)
- 셀러 평가 0~5건 (신규 셀러일수록 의심)
- 사진 한두 장만 있음 (앞면만, 뒷면·모서리 거부)
- "급매" "현금 부족" 같은 감정 호소
- 슬랩에 들어 있다고 무조건 안전 X (PSA 일련번호 조회 필수)

## 식별 5가지

1. 인쇄 도트 패턴
2. 홀로 반사 각도
3. 카드 뒷면 잉크 두께 (빛에 비춰서)
4. 모서리 절단면
5. 무게 (정밀 저울 1.8g 안팎)

자세히는 가품 판별 가이드(/guide-fake-detection)에서 다룹니다.

가품 받으신 분은 사진과 함께 케이스 공유해주시면 다른 분들도 도움이 됩니다.'''),

        ('qna', '카드픽 시세는 어디 기준인가요? — 자주 묻는 질문',
         '''카드픽 시세에 대해 자주 들어오는 질문을 정리합니다.

## Q. 카드픽 시세는 어디 기준인가요?

TCGplayer 북미 market price 기반 해외 참고가입니다. 매일 새벽 5시 KST에 USD → KRW 환산해서 갱신합니다.

## Q. 한국 거래가와 왜 다른가요?

TCGplayer는 미국 시장가입니다. 한국은 배송비, 환율, 관세, 카드 상태, 언어판, 등급에 따라 실제 거래가가 달라집니다. 한판은 보통 영문판보다 비싸고, 일판이 가장 저렴한 편이에요.

## Q. 일본판 시세도 보여주나요?

현재는 영문판(TCGplayer) 시세만 표시합니다. 일판 시세는 메루카리·포케카닷컴·야후옥션에서 직접 확인해야 하고, 추후 통합 검토 중입니다.

## Q. PSA 등급 카드 시세는?

카드픽은 raw 카드 기준입니다. PSA 10 같은 등급 카드 시세는 eBay sold listings에서 직접 확인 권장. 같은 카드 PSA 10은 raw 대비 평균 2~3배, 일부 인기 카드는 5배 이상이에요.

## Q. 가격이 "—"로 표시되는 카드가 많은데?

distinct 30일 표본 5건 미만이면 신뢰도 NONE 등급으로 처리해서 가격을 숨깁니다. 가짜 가격 표시하느니 정직하게 산출 불가로 표시하는 게 정책이에요. 데이터가 누적되면 자동 노출됩니다.

추가 질문 있으시면 댓글로 알려주세요.'''),

        ('qna', '포켓몬 카드 처음 사려는데 — 어디서 사야 안전한가요?',
         '''포켓몬 카드 처음 시작하시는 분들이 자주 묻는 구매처별 비교입니다.

## 한국 정식 구매처

- **포켓몬코리아 공식몰** — 정가, 안전, 한국어판
- **대형마트·서점** (교보문고, 알라딘 등) — 정가, 단품
- **포켓몬 매장** — 오프라인, 한정판 행사 종종 있음

## 한국 중고 시장

- **중고나라·번개장터** — 가격 협상 가능, 가품 위험 있음
- **메루카리 코리아** — 단품 풍부, 셀러 평가 확인 필수
- **카드 전문몰** (포켓샵, 카드샵 등) — 신뢰도 높음, 가격 높음

## 해외 직구

- **메루카리 (일본)** — 일판 가장 저렴, 배송 대행 필수
- **야후옥션 (일본)** — 희귀 카드, 일본어 필수
- **포케카닷컴** — 일본 카드 전문 매장, 가품 거의 없음
- **아마존JP** — 박스 구매 + 영어 UI

자세한 비교는 일본 직구 가이드(/guide-japan-import) 참고.

## 처음이라면

1. 한국 정발 박스 1통 사서 개봉 경험 만들기
2. 단품은 카드샵 또는 신뢰도 높은 셀러 (평가 50+건)
3. 시세 절반 이하 가격은 거의 의심
4. 거래 전 카드픽 시세(/) 확인해서 정상 가격대 파악

거래 안전 7단계: /guide-trade-safety'''),

        ('show', '카드 보관·정리 기본 — 슬리브·탑로더·바인더 시작',
         '''컬렉션이 늘어나면 보관이 중요해집니다. 운영자가 쓰는 기본 보관법 정리합니다.

## 단품 보관

- **페니 슬리브 (Penny Sleeve)** — 가장 얇은 슬리브, 박스 개봉 직후 즉시 끼우기
- **하드 슬리브 / 탑로더** — 두꺼운 플라스틱 케이스, SAR·SIR 같은 고가 카드 필수
- **Card Saver I** — PSA 발송용 (PSA 그레이딩 가이드 참고)

## 컬렉션 정리

- **9-pocket 바인더** — 9장 한 페이지, 일러스트 보면서 정리
- **카드 박스** (BCW·Ultra Pro) — 100장/500장/1000장 단위, 보관·이동 편리
- **마그네틱 슬랩** — 고가 카드 디스플레이용

## 환경

- 직사광선 피하기 (홀로 변색)
- 습도 40~50% 유지 (눅눅하면 종이 변형)
- 카드 위에 무거운 물건 놓지 않기 (휨)

## 가격 추적

카드픽 메인 시세표(/)에서 관심 카드 등록하면 가격 변동 알림(예정) 받을 수 있습니다.

여러분의 보관 팁이나 컬렉션 자랑 있으시면 이 게시판에 자유롭게 올려주세요.'''),

        ('show', '박스깡 후기 환영 — 어떤 카드가 나왔는지 공유해주세요',
         '''박스 개봉 후기는 이 게시판에서 자유롭게 공유해주세요. 다른 분들이 박스 ROI 판단하는 데 큰 도움이 됩니다.

## 후기 작성 시 좋은 정보

- **박스 종류 + 발매일** (예: SV4a 샤이니 트레저 ex, 일본판)
- **박스 가격** (구매처·시점 명시)
- **나온 카드 목록** (SR/SAR/UR/HR/RR 위주, 단품 시세 큰 카드)
- **사진** (홀로 빛 반사 보이게)
- **총 회수액 추정** (단품 시세 합)

## 박스 ROI 참고

같은 박스를 여러 사람이 깠을 때 평균 회수액이 정가 대비 어느 정도인지 누적되면 박스 ROI를 판단할 수 있습니다. 한 사람 표본은 노이즈가 크니 여러 후기가 모일수록 가치가 큽니다.

## 단품 vs 박스 비교

- 박스로 사면 운빨, 단품으로 사면 확정
- 인기 박스는 정가 1.5~2배 프리미엄, 잘 까야 본전
- PSA 등급 후 매도까지 가는 장기 투자도 있음 (PSA 가이드 참고)

운영자도 가끔 박스 깐 후기 공유하겠습니다. 박스 시세 변동은 /releases에서 추적해주세요.'''),
    ]

    inserted = 0
    for board, title, body in posts:
        try:
            cur.execute("""
                insert into public.posts (user_id, board, title, body)
                values (%s, %s, %s, %s)
            """, (ADMIN_ID, board, title, body))
            inserted += 1
            print(f"  [+] {board:5s} | {title[:50]}"); sys.stdout.flush()
        except Exception as e:
            print(f"  [!] {board:5s} | {title[:50]} — {str(e)[:80]}"); sys.stdout.flush()

    print(f"\n[seed_board] inserted {inserted}/{len(posts)} posts"); sys.stdout.flush()
    return inserted


def main():
    fx = get_usd_krw()
    print(f"FX USD/KRW = {fx}"); sys.stdout.flush()

    print("connecting to Supabase..."); sys.stdout.flush()
    conn = psycopg2.connect(**PG); conn.autocommit = True; cur = conn.cursor()
    cur.execute("set statement_timeout = 0")
    print("DB connected"); sys.stdout.flush()

    # Setup board infra first (idempotent, ~1 sec)
    try:
        setup_board(cur)
    except Exception as e:
        print(f"[WARN] setup_board failed: {e}"); sys.stdout.flush()

    # Seed board posts (idempotent — skip if admin already posted)
    try:
        seed_board_posts(cur)
    except Exception as e:
        print(f"[WARN] seed_board_posts failed: {e}"); sys.stdout.flush()

    new_cards, new_prices, cold_updated, cold_failed = 0, 0, 0, 0
    if RUN_PHASE_A:
        deadline_a = time.time() + PHASE_A_TIMEOUT_SEC
        new_cards, new_prices = discover_new_cards(cur, fx, deadline_a)
    else:
        print("\n[skip] Phase A disabled (RUN_PHASE_A=0)"); sys.stdout.flush()
    if RUN_PHASE_B:
        deadline_b = time.time() + PHASE_B_TIMEOUT_SEC
        cold_updated, cold_failed = cold_rotation(cur, fx, deadline_b)
    else:
        print("\n[skip] Phase B disabled (RUN_PHASE_B=0)"); sys.stdout.flush()

    # MV refresh (한 번만)
    print("\nMV refresh...")
    try:
        cur.execute("select refresh_card_price_summary()")
    except Exception:
        cur.execute("refresh materialized view card_price_summary")
        cur.execute("refresh materialized view card_price_summary_best")
    print("  card_price_summary_best refreshed"); sys.stdout.flush()
    # ★ Trust MV — distinct + clean median + 4-tier (Codex 검수)
    try:
        cur.execute("select refresh_card_price_trust()")
        print("  card_price_trust refreshed"); sys.stdout.flush()
    except Exception as e:
        print(f"  [warn] card_price_trust refresh err: {e}"); sys.stdout.flush()
    # 분포 검증 — trust_level별 카드 수 (CLAUDE.md §2-1 사고 예방)
    try:
        cur.execute("select trust_level, count(*) from card_price_trust group by trust_level order by trust_level")
        print("  trust_level distribution:")
        for r in cur.fetchall():
            print(f"    {r[0]:<8} {r[1]:,}"); sys.stdout.flush()
    except Exception:
        pass
    print("MV refreshed"); sys.stdout.flush()

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
