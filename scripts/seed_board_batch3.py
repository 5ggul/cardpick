#!/usr/bin/env python3
"""게시판 시드 3차 — '오늘 올라온 질문' 위젯용 최신 글 2개 + 신규 유저 2명.
psycopg2 직접 연결 (Supabase RLS 우회).
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

# 신규 사용자 2명 (기존 9명과 겹치지 않음)
USERS = [
    ('a0000001-0000-0000-0000-000000000010', 'nayeon22',  'seed_nayeon22@cardpick.kr',  '18 days'),
    ('a0000001-0000-0000-0000-000000000011', '모찌카드',  'seed_mochi@cardpick.kr',     '28 days'),
    # 댓글 작성자도 별도 신규
    ('a0000001-0000-0000-0000-000000000012', 'jhkim_92',  'seed_jhkim92@cardpick.kr',   '42 days'),
    ('a0000001-0000-0000-0000-000000000013', '파이리덕후','seed_charm@cardpick.kr',     '33 days'),
]

# 글 2개: (user_id, board, title, body, hours_ago, views, cc)
POSTS = [
    ('a0000001-0000-0000-0000-000000000010', 'qna',
     'PSA 9 받은 카드 다시 보내면 PSA 10 가능한가요?',
     'PSA 9 받은 카드가 한 장 있는데 센터링이 거의 50/50이고 모서리도 깨끗합니다.\n'
     '슬랩 깐 다음 재신청하면 PSA 10 받을 수도 있다고 들어서요.\n\n'
     'PSA 10 가능성이 정말 있을까요? 슬랩 깰 때 카드 손상 위험도 무서운데\n'
     '경험 있으신 분 조언 부탁드립니다. 카드는 모던 SAR이고 시세는 60만원 정도입니다.',
     3, 17, 1),
    ('a0000001-0000-0000-0000-000000000011', 'qna',
     '리자몽 ex SAR 232 시세 지금이 고점인가요?',
     '한 달 전쯤 90만원에 사려다가 비싸서 미뤘는데\n'
     '지금 보니까 105만원 정도까지 올라가 있네요.\n\n'
     '발매 6개월 정도 지났는데 지금 사도 될까요?\n'
     '아니면 1년쯤 더 기다리면 하락 들어올까요?\n'
     '비슷한 시리즈 SAR 흐름 알려주실 분 계신가요?',
     1, 29, 1),
]

# 댓글: 글 인덱스 → (댓글 작성자 UID, 본문, hours_offset_from_post)
COMMENTS = {
    0: [  # PSA 재그레이딩
        ('a0000001-0000-0000-0000-000000000012',
         '재그레이딩 자체는 가능합니다. 다만 슬랩 깰 때 카드에 압력 가해지면 모서리 흰 점 생길 수 있어서 추천 안 합니다. PSA 9이면 그냥 들고 가시는 게 안전해요. 같은 카드 PSA 9 → 10 업그레이드되어도 차익이 슬랩 깨고 재발송하는 비용·리스크보다 크지 않을 때가 많습니다.',
         2),  # 글 2시간 후
    ],
    1: [  # 리자몽 SAR 시세
        ('a0000001-0000-0000-0000-000000000013',
         '비슷한 위치의 영문 SAR들 흐름 보면 보통 발매 1~2년 사이가 천천히 우상향, 2년+ 이후 신규 시리즈 나오면 살짝 조정 들어오는 패턴이 많습니다. 105만원이 고점인지는 단정 어렵고, 일판/한글판 어느 쪽이냐에 따라도 달라요. 지금 살 거면 한 장은 보관용, 한 장은 그레이딩 후보로 보는 게 보통입니다.',
         0),  # 1시간 후 (글 자체가 1시간 전이라 시간 충돌 회피 — 글 시각 같이)
    ],
}

def main():
    print("[seed_board_batch3] 시작")
    conn = psycopg2.connect(**PG); conn.autocommit = False
    cur = conn.cursor()

    # 1. auth.users 4명
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

    # 3. 글 + 댓글
    inserted_posts = 0
    inserted_comments = 0
    for idx, (user_id, board, title, body, h_ago, views, cc) in enumerate(POSTS):
        cur.execute("SELECT id FROM posts WHERE user_id = %s AND title = %s LIMIT 1", (user_id, title))
        existing = cur.fetchone()
        if existing:
            post_id = existing[0]
            print(f"  [{idx+1}] exists skip: {title[:30]}...")
            continue

        cur.execute(f"""
            INSERT INTO posts (
                user_id, board, title, body, created_at, updated_at,
                is_pinned, views, likes, comments_count
            ) VALUES (
                %s, %s, %s, %s,
                now() - interval '{h_ago} hours', now() - interval '{h_ago} hours',
                false, %s, 0, %s
            )
            RETURNING id
        """, (user_id, board, title, body, views, cc))
        post_id = cur.fetchone()[0]
        inserted_posts += 1
        print(f"  [{idx+1}] post inserted ({h_ago}h ago, views={views}): {title[:35]}...")

        for c_uid, c_body, c_h_off in COMMENTS.get(idx, []):
            # 댓글 시각 = 글 시각 + c_h_off 시간 후
            # = now() - (h_ago - c_h_off) hours
            net_h = h_ago - c_h_off
            if net_h < 0: net_h = 0
            cur.execute(f"""
                INSERT INTO comments (post_id, user_id, body, created_at)
                VALUES (%s, %s, %s, now() - interval '{net_h} hours')
            """, (post_id, c_uid, c_body))
            inserted_comments += 1

        cur.execute("""
            UPDATE posts SET comments_count = (SELECT count(*) FROM comments WHERE post_id = %s)
             WHERE id = %s
        """, (post_id, post_id))

    conn.commit()
    cur.close(); conn.close()
    print(f"[seed_board_batch3] 완료: posts={inserted_posts}, comments={inserted_comments}")

if __name__ == "__main__":
    main()
