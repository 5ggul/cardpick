#!/usr/bin/env python3
"""가격 알림 발송 — price_alerts 구독자에게 카드 가격 변동 알림 이메일.

흐름:
1. price_alerts 테이블에서 active=true 알림 가져옴
2. 각 카드의 어제/오늘 trust display_krw 비교 (prices 테이블 + card_price_trust MV)
3. threshold_pct 초과 변동 OR trust NONE→HIGH 전환 시 발송 대상 등록
4. alert_history에 중복 체크 (같은 날 같은 trigger 1번만)
5. Resend API로 이메일 발송
6. alert_history에 발송 기록

★ Resend API key 미등록 시 graceful skip — 작업 안 함
★ user email 가져올 때 auth.admin API key 필요 (SERVICE_ROLE_KEY)
"""
import os, sys, json, urllib.request, urllib.error, psycopg2
from datetime import datetime, date, timedelta

try:
    sys.stdout.reconfigure(line_buffering=True)
except Exception:
    pass

print(f"=== send_price_alerts.py START at {datetime.utcnow().isoformat()} ==="); sys.stdout.flush()

RESEND_API_KEY = os.environ.get("RESEND_API_KEY", "").strip()
RESEND_FROM = os.environ.get("RESEND_FROM", "Cardpick <notify@cardpick.kr>")
SUPABASE_SERVICE_ROLE_KEY = os.environ.get("SUPABASE_SERVICE_ROLE_KEY", "").strip()
SUPA_URL = os.environ.get("SUPABASE_URL", "https://aqxrmdratnkffvivguqs.supabase.co")

if not RESEND_API_KEY:
    print("WARN: RESEND_API_KEY missing — alert sending skipped (graceful)")
    sys.exit(0)

if not SUPABASE_SERVICE_ROLE_KEY:
    print("WARN: SUPABASE_SERVICE_ROLE_KEY missing — cannot fetch user emails")
    sys.exit(0)

PG = dict(
    host=os.environ.get("SUPABASE_DB_HOST", "aws-1-ap-northeast-2.pooler.supabase.com"),
    port=int(os.environ.get("SUPABASE_DB_PORT", "6543")),
    user=os.environ.get("SUPABASE_DB_USER", "postgres.aqxrmdratnkffvivguqs"),
    password=os.environ.get("SUPABASE_DB_PASSWORD"),
    dbname="postgres", sslmode="require", connect_timeout=30,
)
if not PG["password"]:
    print("ERR: SUPABASE_DB_PASSWORD missing"); sys.exit(1)

DAILY_SEND_LIMIT = int(os.environ.get("ALERT_DAILY_SEND_LIMIT", "100"))  # Resend 무료 3000/월 = 100/일 안전

# ---------------------------------------------------------------- Supabase Admin

def get_user_email(user_id):
    """Service role key로 user email 가져옴."""
    req = urllib.request.Request(
        f"{SUPA_URL}/auth/v1/admin/users/{user_id}",
        headers={
            "Authorization": f"Bearer {SUPABASE_SERVICE_ROLE_KEY}",
            "apikey": SUPABASE_SERVICE_ROLE_KEY,
        }
    )
    try:
        d = json.loads(urllib.request.urlopen(req, timeout=10).read())
        return d.get("email")
    except Exception as e:
        print(f"  [warn] user email {user_id[:8]}: {e}"); sys.stdout.flush()
        return None

# ---------------------------------------------------------------- Resend API

def send_email(to_email, subject, html_body):
    """Resend API로 이메일 발송. id 반환 (성공) or None."""
    payload = json.dumps({
        "from": RESEND_FROM,
        "to": [to_email],
        "subject": subject,
        "html": html_body,
    }).encode("utf-8")
    req = urllib.request.Request(
        "https://api.resend.com/emails",
        data=payload,
        headers={
            "Authorization": f"Bearer {RESEND_API_KEY}",
            "Content-Type": "application/json",
        },
        method="POST",
    )
    try:
        resp = json.loads(urllib.request.urlopen(req, timeout=15).read())
        return resp.get("id")
    except urllib.error.HTTPError as e:
        body = e.read().decode("utf-8", errors="replace")[:200]
        print(f"  [err] resend {e.code}: {body}"); sys.stdout.flush()
        return None
    except Exception as e:
        print(f"  [err] resend: {e}"); sys.stdout.flush()
        return None

# ---------------------------------------------------------------- email template

def render_email(user_email, alerts):
    """alerts: list of dict {card_name, card_slug, change_pct, price_after, trust_level, trigger_type}"""
    rows_html = ""
    for a in alerts:
        chg = a.get("change_pct")
        chg_color = "#26E0C2" if chg and chg > 0 else "#FF4D6D" if chg and chg < 0 else "#8B96A8"
        chg_str = f"{'+' if chg and chg > 0 else ''}{chg:.1f}%" if chg is not None else "—"
        price_str = f"₩{int(a.get('price_after', 0)):,}" if a.get("price_after") else "—"
        rows_html += f"""
        <tr style="border-bottom:1px solid #1f2937">
          <td style="padding:10px 12px;font-size:14px;color:#e8edf5">
            <a href="https://cardpick.kr/cards/{a['card_slug']}" style="color:#26E0C2;text-decoration:none">{a['card_name'] or a['card_slug']}</a>
          </td>
          <td style="padding:10px 12px;font-size:14px;color:#e8edf5;text-align:right;font-family:monospace">{price_str}</td>
          <td style="padding:10px 12px;font-size:14px;color:{chg_color};text-align:right;font-family:monospace">{chg_str}</td>
          <td style="padding:10px 12px;font-size:12px;color:#8B96A8;text-align:right">{a.get('trust_level', '—')}</td>
        </tr>
        """
    return f"""<!doctype html>
<html><body style="background:#05080d;color:#e8edf5;font-family:'Pretendard',system-ui,sans-serif;margin:0;padding:24px">
  <div style="max-width:600px;margin:0 auto">
    <h1 style="font-size:20px;margin:0 0 8px;color:#26E0C2">카드픽 — 가격 알림</h1>
    <p style="font-size:13px;color:#8B96A8;margin:0 0 24px">관심 카드 {len(alerts)}개에 변동이 감지되었습니다.</p>

    <table style="width:100%;border-collapse:collapse;background:#0d121b;border:1px solid #1f2937">
      <thead>
        <tr style="background:#111722">
          <th style="padding:10px 12px;text-align:left;font-size:11px;color:#8B96A8;font-weight:600">카드</th>
          <th style="padding:10px 12px;text-align:right;font-size:11px;color:#8B96A8;font-weight:600">현재가</th>
          <th style="padding:10px 12px;text-align:right;font-size:11px;color:#8B96A8;font-weight:600">변동</th>
          <th style="padding:10px 12px;text-align:right;font-size:11px;color:#8B96A8;font-weight:600">신뢰도</th>
        </tr>
      </thead>
      <tbody>{rows_html}</tbody>
    </table>

    <p style="font-size:12px;color:#8B96A8;margin:24px 0 0;line-height:1.6">
      ※ 가격은 TCGplayer 북미 기반 해외 참고가입니다. 국내 거래가와 다를 수 있습니다.<br>
      ※ 알림 설정 변경: <a href="https://cardpick.kr/my" style="color:#26E0C2">cardpick.kr/my</a>
    </p>

    <p style="font-size:11px;color:#5b6577;margin:16px 0 0;text-align:center">
      © Cardpick · cardpick.kr · 정직 원칙으로 운영
    </p>
  </div>
</body></html>"""

# ---------------------------------------------------------------- main

def main():
    print("connecting DB..."); sys.stdout.flush()
    conn = psycopg2.connect(**PG); conn.autocommit = True; cur = conn.cursor()

    # 1) 활성 알림 구독 + 카드 정보 + 현재 trust 가격 + 어제 가격
    # alert_history dedupe — 오늘 이미 발송 안 됨
    today_str = date.today().isoformat()
    cur.execute(f"""
        with subs as (
            select pa.user_id, pa.card_slug, pa.card_name, pa.threshold_pct, pa.direction
            from price_alerts pa
            where pa.active = true
        ),
        today_price as (
            select t.card_slug, t.display_krw, t.trust_level
            from card_price_trust t
            where t.display_krw is not null
        ),
        yesterday_price as (
            select card_slug, avg(price_krw) as yest_krw
            from prices
            where fetched_at::date = (current_date - interval '1 day')::date
              and price_krw > 0
              and source in ('tcgplayer','pokemontcg-tcgplayer')
            group by card_slug
        ),
        candidates as (
            select s.user_id, s.card_slug, s.card_name, s.threshold_pct, s.direction,
                   tp.display_krw as today_krw, tp.trust_level,
                   yp.yest_krw,
                   case when yp.yest_krw > 0 then ((tp.display_krw - yp.yest_krw) / yp.yest_krw * 100) else null end as change_pct
            from subs s
            join today_price tp on tp.card_slug = s.card_slug
            left join yesterday_price yp on yp.card_slug = s.card_slug
        )
        select user_id, card_slug, card_name, today_krw, yest_krw, change_pct, trust_level, threshold_pct, direction
        from candidates c
        where c.change_pct is not null
          and abs(c.change_pct) >= c.threshold_pct
          and (c.direction = 'both'
               or (c.direction = 'above' and c.change_pct > 0)
               or (c.direction = 'below' and c.change_pct < 0))
          and not exists (
              select 1 from alert_history h
              where h.user_id = c.user_id
                and h.card_slug = c.card_slug
                and h.trigger_type = 'threshold'
                and h.created_at::date = current_date
          )
        order by abs(c.change_pct) desc
        limit %s
    """, (DAILY_SEND_LIMIT,))

    triggers = cur.fetchall()
    print(f"triggers found: {len(triggers)}"); sys.stdout.flush()
    if not triggers:
        print("nothing to send"); cur.close(); conn.close(); return

    # 2) user별 그룹핑 (한 명에 여러 카드 알림 = 1 이메일)
    by_user = {}
    for r in triggers:
        user_id, card_slug, card_name, today_krw, yest_krw, change_pct, trust_level, threshold, direction = r
        by_user.setdefault(user_id, []).append({
            "card_slug": card_slug,
            "card_name": card_name,
            "price_before": float(yest_krw or 0),
            "price_after": float(today_krw),
            "change_pct": float(change_pct),
            "trust_level": trust_level,
        })

    # 3) 사용자별 이메일 발송
    sent_count = 0
    failed_count = 0
    for user_id, alerts in by_user.items():
        email = get_user_email(user_id)
        if not email:
            failed_count += len(alerts)
            continue

        subject = f"카드픽 가격 알림 — {len(alerts)}장 변동 감지"
        html = render_email(email, alerts)
        resend_id = send_email(email, subject, html)

        # alert_history에 기록 (성공/실패 모두)
        for a in alerts:
            try:
                cur.execute("""
                    insert into alert_history
                    (user_id, card_slug, trigger_type, price_before, price_after, change_pct, trust_level, email_sent, email_sent_at, resend_id)
                    values (%s, %s, 'threshold', %s, %s, %s, %s, %s, %s, %s)
                    on conflict on constraint alert_history_dedupe do nothing
                """, (
                    user_id, a["card_slug"],
                    a["price_before"], a["price_after"], a["change_pct"], a["trust_level"],
                    bool(resend_id), datetime.utcnow() if resend_id else None, resend_id
                ))
            except Exception as e:
                print(f"  [warn] history insert: {e}"); sys.stdout.flush()

        if resend_id:
            sent_count += len(alerts)
            print(f"  [ok] sent to {email[:30]}... ({len(alerts)} cards)"); sys.stdout.flush()
        else:
            failed_count += len(alerts)

    print(f"\n=== DONE ===")
    print(f"  sent      : {sent_count}")
    print(f"  failed    : {failed_count}")
    print(f"  recipients: {len(by_user)}")

    cur.close(); conn.close()

if __name__ == "__main__":
    main()
