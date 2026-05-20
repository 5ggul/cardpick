#!/usr/bin/env python3
"""eBay Browse API → Pokemon 카드 active listings 평균/최저/표본수 적재.

목적: TCGplayer 표본 1건짜리 (예: ₩152 같은 저신뢰 가격) 카드의 신뢰성 보정.
      eBay US active listing 시장가를 보조 출처로 노출 → 정직 강화.

★ 정직 원칙:
  - Browse API는 active listings 만 (판매 완료 아님).
  - Sold listings는 Marketplace Insights API (partner approval 필요) → 미사용.
  - UI에도 "현재 listing 평균 · sold 아님" 명시 의무.

대상 우선순위 (일일 1,500카드 budget):
  1. 저신뢰 — samples_7d < 2 OR latest_krw < 1000
  2. 고가 — latest_krw >= 10000
  3. 그 외 stale 우선
  → 모두 latest_krw > 0 카드만 (가격 정보 없는 카드는 skip)

cron 권장: 매일 KST 05:30 (= UTC 20:30) — TCGplayer 갱신 직후
환경변수: EBAY_APP_ID, EBAY_CERT_ID, SUPABASE_DB_PASSWORD
"""
import os, sys, time, json, base64, urllib.request, urllib.parse, psycopg2
from datetime import datetime, timezone

try:
    sys.stdout.reconfigure(line_buffering=True)
except Exception:
    pass

print(f"=== refresh_ebay_active.py START at {datetime.utcnow().isoformat()} ==="); sys.stdout.flush()

EBAY_APP_ID  = os.environ.get("EBAY_APP_ID", "").strip()
EBAY_CERT_ID = os.environ.get("EBAY_CERT_ID", "").strip()
if not (EBAY_APP_ID and EBAY_CERT_ID):
    print("ERR: EBAY_APP_ID / EBAY_CERT_ID missing — eBay refresh skip"); sys.exit(0)

PG = dict(
    host=os.environ.get("SUPABASE_DB_HOST", "aws-1-ap-northeast-2.pooler.supabase.com"),
    port=int(os.environ.get("SUPABASE_DB_PORT", "6543")),
    user=os.environ.get("SUPABASE_DB_USER", "postgres.aqxrmdratnkffvivguqs"),
    password=os.environ.get("SUPABASE_DB_PASSWORD"),
    dbname="postgres", sslmode="require", connect_timeout=30,
)
if not PG["password"]:
    print("ERR: SUPABASE_DB_PASSWORD missing"); sys.exit(1)

DAILY_TARGET = int(os.environ.get("EBAY_DAILY_TARGET", "1500"))
DEADLINE_SEC = int(os.environ.get("EBAY_DEADLINE_SEC", "3000"))  # 50분
REQ_SLEEP_SEC = float(os.environ.get("EBAY_REQ_SLEEP_SEC", "0.4"))  # 2.5 req/sec
USD_KRW_DEFAULT = 1381.0
EBAY_MARKETPLACE = "EBAY_US"
# Pokemon TCG Individual Cards 카테고리 (eBay US)
EBAY_CATEGORY_ID = "183454"

# ---------------------------------------------------------------- env / FX

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

# ---------------------------------------------------------------- OAuth

_token_cache = {"token": None, "expires_at": 0}

def ebay_token():
    """OAuth 2.0 client_credentials grant. 토큰은 2시간 유효, 메모리 캐시."""
    now = time.time()
    if _token_cache["token"] and _token_cache["expires_at"] > now + 60:
        return _token_cache["token"]
    creds = f"{EBAY_APP_ID}:{EBAY_CERT_ID}".encode("utf-8")
    basic = base64.b64encode(creds).decode("ascii")
    body = urllib.parse.urlencode({
        "grant_type": "client_credentials",
        "scope": "https://api.ebay.com/oauth/api_scope",
    }).encode("utf-8")
    req = urllib.request.Request(
        "https://api.ebay.com/identity/v1/oauth2/token",
        data=body,
        headers={
            "Authorization": f"Basic {basic}",
            "Content-Type": "application/x-www-form-urlencoded",
        },
        method="POST",
    )
    try:
        d = json.loads(urllib.request.urlopen(req, timeout=20).read())
    except Exception as e:
        print(f"ERR oauth token: {e}"); sys.exit(2)
    tok = d.get("access_token")
    expires_in = int(d.get("expires_in", 7200))
    if not tok:
        print(f"ERR oauth: no access_token in response: {d}"); sys.exit(2)
    _token_cache["token"] = tok
    _token_cache["expires_at"] = now + expires_in
    return tok

# ---------------------------------------------------------------- Browse API

def browse_search(name, number, retries=2):
    """eBay Browse API item_summary/search.
    쿼리: 'Pokemon {name} {number}' — Codex 권장 패턴 (정확도 ↑).
    Filter: 카테고리 + 가격 범위 + 통화 USD.
    """
    # 쿼리 조립 — name과 number를 공백으로
    q_parts = ["Pokemon"]
    if name: q_parts.append(name)
    if number: q_parts.append(str(number))
    q = " ".join(q_parts)

    params = {
        "q": q,
        "category_ids": EBAY_CATEGORY_ID,
        "filter": "price:[1..50000],priceCurrency:USD,buyingOptions:{FIXED_PRICE|AUCTION},itemLocationCountry:US",
        "limit": "50",
        "sort": "price",
    }
    qs = urllib.parse.urlencode(params)
    url = f"https://api.ebay.com/buy/browse/v1/item_summary/search?{qs}"

    last_err = None
    for attempt in range(retries + 1):
        try:
            req = urllib.request.Request(url, headers={
                "Authorization": f"Bearer {ebay_token()}",
                "X-EBAY-C-MARKETPLACE-ID": EBAY_MARKETPLACE,
                "Accept": "application/json",
                "Accept-Language": "en-US",
                "User-Agent": "cardpick/1.0",
            })
            return json.loads(urllib.request.urlopen(req, timeout=20).read())
        except Exception as e:
            last_err = e
            if attempt < retries:
                time.sleep(1 + attempt)
                continue
            raise last_err

def aggregate_listings(data):
    """Browse API response → 평균/최저/최고/표본수.
    노이즈 컷: bulk lot / proxy / damaged 키워드 제외.
    """
    items = data.get("itemSummaries") or []
    prices_usd = []
    for it in items:
        try:
            p = it.get("price") or {}
            cur = p.get("currency") or ""
            val = float(p.get("value") or 0)
        except Exception:
            continue
        if cur != "USD" or val <= 0:
            continue
        # 노이즈 컷 — bulk / lot / proxy / damaged / fake / replica
        title = (it.get("title") or "").lower()
        if any(kw in title for kw in [" lot ", " lot of", " bulk", "proxy", "custom", "fake", "replica", " damage", "heavily play"]):
            continue
        prices_usd.append(val)
    if not prices_usd:
        return None
    n = len(prices_usd)
    avg = sum(prices_usd) / n
    low = min(prices_usd)
    high = max(prices_usd)
    # 중앙값
    s = sorted(prices_usd)
    mid = s[n // 2] if n % 2 == 1 else (s[n // 2 - 1] + s[n // 2]) / 2
    return {"count": n, "avg_usd": avg, "low_usd": low, "high_usd": high, "med_usd": mid}

# ---------------------------------------------------------------- target selection

def pick_targets(cur, limit):
    """우선순위:
      tier 1 = 저신뢰 (samples_7d < 2 OR latest_krw < 1000)
      tier 2 = 고가 (latest_krw >= 10000)
      tier 3 = 그 외 stale (ebay_last_fetched_at IS NULL 또는 7일+)
    각 tier 안에서 ebay_last_fetched_at NULLS FIRST (LRU).
    """
    cur.execute("""
        with src as (
          select c.slug, c.name, c.number, c.set_code, c.set_name,
                 b.latest_krw, b.samples_7d,
                 c.ebay_last_fetched_at,
                 case
                   when (b.samples_7d is null or b.samples_7d < 2) or b.latest_krw < 1000 then 1
                   when b.latest_krw >= 10000 then 2
                   else 3
                 end as tier
          from cards c
          join card_price_summary_best b on b.card_slug = c.slug
          where c.game = 'pokemon'
            and b.latest_krw > 0
            and lower(coalesce(c.rarity_class, '')) not in ('common','uncommon')
            and (c.ebay_last_fetched_at is null or c.ebay_last_fetched_at < now() - interval '7 days')
        )
        select slug, name, number, set_code, set_name, latest_krw, samples_7d, tier
        from src
        order by tier asc, ebay_last_fetched_at asc nulls first, latest_krw desc
        limit %s
    """, (limit,))
    return cur.fetchall()

# ---------------------------------------------------------------- DB persist

INS_PRICE = """insert into prices
    (card_slug, source, variant, currency,
     price_low, price_mid, price_market, price_high,
     price_krw, exchange_rate, fetched_at)
    values (%s, 'ebay-active', 'normal', 'USD',
            %s, %s, %s, %s, %s, %s, now())"""

UPD_CARD = """update cards set
    ebay_active_avg_krw = %s,
    ebay_active_low_krw = %s,
    ebay_active_count   = %s,
    ebay_last_fetched_at = now()
  where slug = %s"""

UPD_CARD_NULL = """update cards set
    ebay_active_avg_krw = null,
    ebay_active_low_krw = null,
    ebay_active_count   = 0,
    ebay_last_fetched_at = now()
  where slug = %s"""

# ---------------------------------------------------------------- main

def main():
    print(f"  config: DAILY_TARGET={DAILY_TARGET} DEADLINE_SEC={DEADLINE_SEC}"); sys.stdout.flush()
    fx = get_usd_krw()
    print(f"  FX USD/KRW = {fx}"); sys.stdout.flush()

    print("connecting to Supabase..."); sys.stdout.flush()
    conn = psycopg2.connect(**PG); conn.autocommit = True; cur = conn.cursor()
    cur.execute("set statement_timeout = 0")
    print("DB connected"); sys.stdout.flush()

    # job log start
    cur.execute("""insert into api_update_logs
        (source, job_name, status, started_at)
        values ('ebay-browse', 'daily', 'started', now()) returning id""")
    job_id = cur.fetchone()[0]

    # OAuth 사전 발급 (실패 시 일찍 종료)
    try:
        ebay_token()
        print("  [ok] eBay OAuth token acquired"); sys.stdout.flush()
    except SystemExit:
        cur.execute("update api_update_logs set status='failed', finished_at=now() where id=%s", (job_id,))
        cur.close(); conn.close()
        return

    # 샘플 사전 검증 (CLAUDE.md §2-1 사고1 재발 방지)
    # 작은 표본으로 매칭률 측정 → 50% 미만이면 작업 중단
    print("\n=== Sample validation (10 cards) ==="); sys.stdout.flush()
    cur.execute("""
        select c.slug, c.name, c.number
        from cards c
        join card_price_summary_best b on b.card_slug = c.slug
        where c.game = 'pokemon' and b.latest_krw > 1000
          and lower(coalesce(c.rarity_class, '')) not in ('common','uncommon')
        order by b.latest_krw desc
        limit 10
    """)
    sample = cur.fetchall()
    sample_matched = 0
    for s_slug, s_name, s_num in sample:
        try:
            r = browse_search(s_name, s_num)
            agg = aggregate_listings(r)
            if agg and agg["count"] >= 3:
                sample_matched += 1
        except Exception:
            pass
        time.sleep(REQ_SLEEP_SEC)
    match_rate = sample_matched / max(len(sample), 1)
    print(f"  sample matched: {sample_matched}/{len(sample)} ({match_rate:.0%})"); sys.stdout.flush()
    if match_rate < 0.5:
        print(f"  [ABORT] match rate < 50% — eBay query pattern may be broken")
        cur.execute("update api_update_logs set status='failed', failed_count=%s, finished_at=now() where id=%s",
                    (len(sample) - sample_matched, job_id))
        cur.close(); conn.close()
        sys.exit(3)

    # 본 작업
    targets = pick_targets(cur, DAILY_TARGET)
    print(f"\n=== Main rotation — {len(targets)} cards ==="); sys.stdout.flush()
    if not targets:
        print("  nothing to do");
        cur.execute("update api_update_logs set status='completed', updated_count=0, finished_at=now() where id=%s", (job_id,))
        cur.close(); conn.close()
        return

    deadline_ts = time.time() + DEADLINE_SEC
    updated = 0
    no_match = 0
    failed = 0
    calls = 0
    for i, row in enumerate(targets):
        if time.time() > deadline_ts:
            print(f"  [TIMEOUT] deadline at {i}/{len(targets)} — stopping gracefully"); sys.stdout.flush()
            break
        slug, name, number, set_code, set_name, krw_now, samples_7d, tier = row
        try:
            res = browse_search(name, number)
            calls += 1
            agg = aggregate_listings(res)
        except Exception as e:
            failed += 1
            if i % 50 == 0:
                print(f"  [progress] {i}/{len(targets)} err: {str(e)[:60]}"); sys.stdout.flush()
            time.sleep(REQ_SLEEP_SEC)
            continue

        if not agg or agg["count"] < 2:
            no_match += 1
            try:
                cur.execute(UPD_CARD_NULL, (slug,))
            except Exception:
                pass
            time.sleep(REQ_SLEEP_SEC)
            continue

        avg_usd = agg["avg_usd"]
        low_usd = agg["low_usd"]
        high_usd = agg["high_usd"]
        med_usd = agg["med_usd"]
        avg_krw = round(avg_usd * fx)
        low_krw = round(low_usd * fx)

        # prices 적재 (history)
        try:
            cur.execute(INS_PRICE, (
                slug, low_usd, med_usd, avg_usd, high_usd, avg_krw, fx
            ))
        except Exception:
            pass

        # cards 캐시 update
        try:
            cur.execute(UPD_CARD, (avg_krw, low_krw, agg["count"], slug))
            updated += 1
        except Exception as e:
            failed += 1
            print(f"  card update err {slug}: {str(e)[:60]}"); sys.stdout.flush()

        if i % 50 == 0:
            print(f"  [progress] {i+1}/{len(targets)} updated={updated} no_match={no_match} failed={failed} calls={calls}"); sys.stdout.flush()
        time.sleep(REQ_SLEEP_SEC)

    # job log finish
    cur.execute("""update api_update_logs set status='completed',
        updated_count=%s, failed_count=%s, api_calls_used=%s, finished_at=now()
        where id=%s""", (updated, failed + no_match, calls, job_id))

    # MV refresh (가격 변동 반영) — best 가져오는 쿼리는 MV이므로 ebay는 안 들어가지만,
    # samples_7d 같은 변동은 영향. 안전하게 refresh.
    print("\nMV refresh..."); sys.stdout.flush()
    try:
        cur.execute("select refresh_card_price_summary()")
    except Exception:
        try:
            cur.execute("refresh materialized view card_price_summary")
            cur.execute("refresh materialized view card_price_summary_best")
        except Exception as e:
            print(f"  MV refresh err: {e}"); sys.stdout.flush()
    print("MV refreshed"); sys.stdout.flush()

    # 최종 통계
    cur.execute("select count(*) from cards where ebay_active_avg_krw is not null")
    ebay_priced = cur.fetchone()[0]

    print(f"\n=== DONE ===")
    print(f"  updated      : {updated}")
    print(f"  no_match     : {no_match}")
    print(f"  failed       : {failed}")
    print(f"  api_calls    : {calls}")
    print(f"  ebay_priced  : {ebay_priced:,}  (cards with eBay active data)")

    cur.close(); conn.close()

if __name__ == "__main__":
    main()
