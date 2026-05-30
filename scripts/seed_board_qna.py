#!/usr/bin/env python3
"""게시판 시드 — 질문글 1개 + 댓글 3개 (사용자 3명).
psycopg2 직접 연결 (Supabase RLS 우회, service_role 권한).
"""
import os, sys, psycopg2

try: sys.stdout.reconfigure(line_buffering=True)
except Exception: pass

PG = dict(
    host=os.environ.get("SUPABASE_DB_HOST", "aws-1-ap-northeast-2.pooler.supabase.com"),
    port=int(os.environ.get("SUPABASE_DB_PORT", "6543")),
    user=os.environ.get("SUPABASE_DB_USER", "postgres.aqxrmdratnkffvivguqs"),
    password=os.environ.get("SUPABASE_DB_PASSWORD"),
    dbname="postgres", sslmode="require", connect_timeout=30,
)
if not PG["password"]:
    print("ERR: SUPABASE_DB_PASSWORD missing"); sys.exit(1)

USERS = [
    ('a0000001-0000-0000-0000-000000000001', 'yj_02',    'seed_yj02@cardpick.kr',    '30 days'),
    ('a0000001-0000-0000-0000-000000000002', '포카박스', 'seed_pokabox@cardpick.kr', '60 days'),
    ('a0000001-0000-0000-0000-000000000003', 'ddung',    'seed_ddung@cardpick.kr',    '45 days'),
]

POST = {
    'user_id': 'a0000001-0000-0000-0000-000000000001',
    'board': 'qna',
    'title': 'PSA 처음 보내려는데 비용이 50만원 넘네요;;',
    'body': '카드 10장 보내려는데 그레이딩 + 배송 + 보험 + 한국 대행료 합치니까 50만원 넘어가요. 이게 정상인가요?',
    'ago': '4 days',
}

COMMENTS = [
    ('a0000001-0000-0000-0000-000000000002',
     '신고가 따라 달라요. 10장에 50만원이면 일반적인 수준입니다. 카드픽 PSA 손익분기 계산기로 PSA 10 예상가 입력해보면 손해 안 보는지 바로 나옵니다.',
     "interval '4 days' - interval '2 hours'"),
    ('a0000001-0000-0000-0000-000000000003',
     '처음이면 한국 대행이 안전해요. 5장 이상이면 직발도 검토해볼 만하고요.',
     "interval '3 days' - interval '5 hours'"),
    ('a0000001-0000-0000-0000-000000000001',
     '감사합니다 계산기 돌려보고 결정할게요!',
     "interval '3 days' - interval '8 hours'"),
]

def main():
    print("[seed_board_qna] 시드 시작")
    conn = psycopg2.connect(**PG); conn.autocommit = False
    cur = conn.cursor()

    # 1. auth.users 3명
    for uid, nick, email, age in USERS:
        cur.execute("""
            INSERT INTO auth.users (
                id, instance_id, aud, role, email,
                encrypted_password, email_confirmed_at,
                created_at, updated_at,
                raw_user_meta_data, raw_app_meta_data
            ) VALUES (
                %s, '00000000-0000-0000-0000-000000000000',
                'authenticated', 'authenticated', %s,
                '', now() - interval %s,
                now() - interval %s, now(),
                ('{"name":"' || %s || '"}')::jsonb,
                '{"provider":"seed","providers":["seed"]}'::jsonb
            )
            ON CONFLICT (id) DO NOTHING
        """, (uid, email, age, age, nick))
    print(f"  auth.users upserted: {len(USERS)}")

    # 2. profiles
    for uid, nick, email, age in USERS:
        cur.execute("""
            INSERT INTO profiles (id, nickname, display_name, created_at, updated_at)
            VALUES (%s, %s, %s, now() - interval %s, now())
            ON CONFLICT (id) DO UPDATE
              SET nickname = EXCLUDED.nickname,
                  display_name = EXCLUDED.display_name,
                  updated_at = now()
        """, (uid, nick, nick, age))
    print(f"  profiles upserted: {len(USERS)}")

    # 3. 글 INSERT (기존 시드 글 있으면 skip)
    cur.execute("""
        SELECT id FROM posts
         WHERE user_id = %s AND title = %s
         LIMIT 1
    """, (POST['user_id'], POST['title']))
    existing = cur.fetchone()
    if existing:
        post_id = existing[0]
        print(f"  post already exists: {post_id} (skip)")
        # 기존 댓글도 있으면 SKIP
        cur.execute("SELECT count(*) FROM comments WHERE post_id = %s", (post_id,))
        if cur.fetchone()[0] >= 3:
            print("  comments already exist, full skip")
            conn.commit(); cur.close(); conn.close()
            return
    else:
        cur.execute("""
            INSERT INTO posts (
                user_id, board, title, body, created_at, updated_at,
                is_pinned, views, likes, comments_count
            ) VALUES (%s, %s, %s, %s, now() - interval %s, now() - interval %s, false, 0, 0, 3)
            RETURNING id
        """, (POST['user_id'], POST['board'], POST['title'], POST['body'], POST['ago'], POST['ago']))
        post_id = cur.fetchone()[0]
        print(f"  post inserted: {post_id}")

    # 4. 댓글 3개
    for uid, body, time_expr in COMMENTS:
        # time_expr은 SQL interval 식. f-string으로 직접 박음 (사용자 입력 X)
        cur.execute(f"""
            INSERT INTO comments (post_id, user_id, body, created_at)
            VALUES (%s, %s, %s, now() - {time_expr})
        """, (post_id, uid, body))
    print(f"  comments inserted: {len(COMMENTS)}")

    # 5. comments_count 동기화
    cur.execute("""
        UPDATE posts
           SET comments_count = (SELECT count(*) FROM comments WHERE post_id = %s)
         WHERE id = %s
    """, (post_id, post_id))

    conn.commit()
    cur.close(); conn.close()
    print("[seed_board_qna] 완료")

if __name__ == "__main__":
    main()
