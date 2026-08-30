#!/usr/bin/env python3
"""CardPick v5 FCM push sender.

Pending public.notifications rows are delivered to registered push_devices.
Requires FIREBASE_SERVICE_ACCOUNT_JSON. Missing Firebase secret is a graceful no-op.
"""
import json
import os
import sys
import urllib.error
import urllib.request
from datetime import datetime

import psycopg2

try:
    from google.auth.transport.requests import Request
    from google.oauth2 import service_account
except ImportError:
    print("ERR: google-auth 필요", file=sys.stderr)
    sys.exit(1)

FIREBASE_JSON = os.environ.get("FIREBASE_SERVICE_ACCOUNT_JSON", "").strip()
if not FIREBASE_JSON:
    print("WARN: FIREBASE_SERVICE_ACCOUNT_JSON missing — push skipped")
    sys.exit(0)

try:
    FIREBASE_INFO = json.loads(FIREBASE_JSON)
except Exception as exc:
    print(f"ERR: invalid FIREBASE_SERVICE_ACCOUNT_JSON: {exc}")
    sys.exit(1)

PROJECT_ID = FIREBASE_INFO.get("project_id")
if not PROJECT_ID:
    print("ERR: Firebase project_id missing")
    sys.exit(1)

PG = dict(
    host=os.environ.get("SUPABASE_DB_HOST", "aws-1-ap-northeast-2.pooler.supabase.com"),
    port=int(os.environ.get("SUPABASE_DB_PORT", "6543")),
    user=os.environ.get("SUPABASE_DB_USER", "postgres.aqxrmdratnkffvivguqs"),
    password=os.environ.get("SUPABASE_DB_PASSWORD"),
    dbname="postgres",
    sslmode="require",
    connect_timeout=30,
)
if not PG["password"]:
    print("ERR: SUPABASE_DB_PASSWORD missing")
    sys.exit(1)

SCOPES = ["https://www.googleapis.com/auth/firebase.messaging"]
creds = service_account.Credentials.from_service_account_info(FIREBASE_INFO, scopes=SCOPES)
creds.refresh(Request())


def post_fcm(token, title, body, data):
    payload = {
        "message": {
            "token": token,
            "notification": {"title": title, "body": body},
            "data": {str(k): str(v) for k, v in data.items() if v is not None},
            "android": {"priority": "high"},
        }
    }
    req = urllib.request.Request(
        f"https://fcm.googleapis.com/v1/projects/{PROJECT_ID}/messages:send",
        data=json.dumps(payload).encode("utf-8"),
        headers={
            "Authorization": f"Bearer {creds.token}",
            "Content-Type": "application/json; charset=utf-8",
        },
        method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=15) as resp:
            return True, resp.read().decode("utf-8", errors="replace")[:300]
    except urllib.error.HTTPError as exc:
        txt = exc.read().decode("utf-8", errors="replace")[:1000]
        return False, f"HTTP {exc.code}: {txt}"
    except Exception as exc:
        return False, str(exc)


def message_for(row):
    ntype, actor_name, post_title, card_slug, metadata = row
    metadata = metadata or {}
    if ntype == "reply":
        return (
            "CardPick · 새 답글",
            f"{actor_name or '누군가'}님이 내 댓글에 답글을 남겼습니다.",
            {"type": "reply", "post_id": metadata.get("post_id"), "url": metadata.get("url")},
        )
    if ntype == "price_alert":
        card_name = metadata.get("card_name") or card_slug or "관심 카드"
        change = metadata.get("change_pct")
        price = metadata.get("price_after")
        change_txt = f"{float(change):+.1f}%" if change is not None else "변동"
        price_txt = f"₩{int(float(price)):,}" if price else "현재가 확인"
        return (
            "CardPick · 가격 알림",
            f"{card_name} {change_txt} · {price_txt}",
            {"type": "price_alert", "card_slug": card_slug, "url": f"https://cardpick.kr/cards/{card_slug}" if card_slug else "https://cardpick.kr/my"},
        )
    return (
        "CardPick · 새 댓글",
        f"{actor_name or '누군가'}님이 내 글에 댓글을 남겼습니다.",
        {"type": "comment", "post_id": metadata.get("post_id"), "url": metadata.get("url")},
    )


def main():
    print(f"=== CardPick push sender {datetime.utcnow().isoformat()}Z ===")
    conn = psycopg2.connect(**PG)
    conn.autocommit = True
    cur = conn.cursor()

    cur.execute("""
        select n.id, n.user_id, n.type, n.post_id, n.card_slug, n.metadata,
               coalesce(p.nickname, p.display_name, '누군가') as actor_name,
               po.title
          from public.notifications n
          left join public.profiles p on p.id = n.actor_id
          left join public.posts po on po.id = n.post_id
         where n.push_sent_at is null
           and n.push_attempts < 4
           and n.created_at > now() - interval '7 days'
         order by n.created_at asc
         limit 100
    """)
    notifications = cur.fetchall()
    print(f"pending notifications: {len(notifications)}")

    sent = 0
    for n in notifications:
        nid, uid, ntype, post_id, card_slug, metadata, actor_name, post_title = n
        metadata = dict(metadata or {})
        if post_id:
            metadata["post_id"] = post_id
            metadata["url"] = f"https://cardpick.kr/board?post={post_id}"

        cur.execute("""
            select id, token
              from public.push_devices
             where user_id=%s and enabled=true
             order by last_seen_at desc
        """, (uid,))
        devices = cur.fetchall()
        if not devices:
            cur.execute("""
                update public.notifications
                   set push_attempted_at=now(), push_attempts=push_attempts+1,
                       push_error='no_active_device'
                 where id=%s
            """, (nid,))
            continue

        title, body, data = message_for((ntype, actor_name, post_title, card_slug, metadata))
        ok_any = False
        errors = []
        for device_id, token in devices:
            ok, detail = post_fcm(token, title, body, data)
            if ok:
                ok_any = True
            else:
                errors.append(detail[:300])
                upper = detail.upper()
                if "UNREGISTERED" in upper or "NOT_FOUND" in upper:
                    cur.execute("update public.push_devices set enabled=false, updated_at=now() where id=%s", (device_id,))

        if ok_any:
            cur.execute("""
                update public.notifications
                   set push_sent_at=now(), push_attempted_at=now(),
                       push_attempts=push_attempts+1, push_error=null
                 where id=%s
            """, (nid,))
            sent += 1
        else:
            cur.execute("""
                update public.notifications
                   set push_attempted_at=now(), push_attempts=push_attempts+1,
                       push_error=%s
                 where id=%s
            """, ((" | ".join(errors) or "send_failed")[:1000], nid))

    cur.close()
    conn.close()
    print(f"sent notifications: {sent}")


if __name__ == "__main__":
    main()
