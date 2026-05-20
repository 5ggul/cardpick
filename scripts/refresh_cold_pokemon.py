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

def cold_rotation(cur, fx, deadline_ts):
    print("\n=== Phase B: cold rotation ==="); sys.stdout.flush()
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
    BATCH = 25  # 50 → 25 (OR query 너무 길면 timeout)
    for i in range(0, len(targets), BATCH):
        # deadline 체크
        if time.time() > deadline_ts:
            print(f"  [TIMEOUT] Phase B deadline at batch {i}/{len(targets)} — stopping gracefully"); sys.stdout.flush()
            break
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

        # 매 batch마다 진행 print (실시간)
        print(f"  [progress] batch {i//BATCH+1} → updated={updated} failed={failed} calls={calls}"); sys.stdout.flush()
        time.sleep(0.2)

    cur.execute("""update api_update_logs set status='completed',
        updated_count=%s, failed_count=%s, api_calls_used=%s, finished_at=now()
        where id=%s""", (updated, failed, calls, job_id))

    print(f"\n  Phase B done: updated={updated}  failed={failed}  calls={calls}")
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
    # 6. get_hot_cards RPC — /hot 페이지에서 사용 (★ Trust Gate v1: trust_level 노출 + NONE 제외)
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
          -- ★ Trust NONE 카드 안전망 제외 (compute_hot_cards가 이미 필터링하지만 이중 방어)
          and coalesce(t.trust_level, 'UNKNOWN') != 'NONE'
        order by hc.category, hc.rank
      $func$""")
    cur.execute("grant execute on function get_hot_cards() to anon, authenticated")
    print("  [ok] get_hot_cards RPC"); sys.stdout.flush()
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
            when c.distinct_7d >= 5 and cardpick_ratio_gate(best.latest_krw, cs.clean_30d_median_krw) then 'HIGH'
            when c.distinct_30d >= 10 then 'MEDIUM'
            else 'LOW'
          end as trust_level,
          case
            when coalesce(cs.clean_30d_n, 0) < 5 then null::numeric
            when c.distinct_7d >= 5 and cardpick_ratio_gate(best.latest_krw, cs.clean_30d_median_krw) then round(best.latest_krw)::numeric
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
    # 13. cards.released_at backfill (set_id별 releaseDate 매핑)
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
