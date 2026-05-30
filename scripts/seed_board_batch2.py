#!/usr/bin/env python3
"""게시판 시드 2차 — 질문/자유/후기 글 6개 + 댓글 + 조회수.
psycopg2 직접 연결 (Supabase RLS 우회).
"""
import os, sys, psycopg2, random

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

# 신규 사용자 6명 (기존 yj_02/포카박스/ddung 제외)
USERS = [
    ('a0000001-0000-0000-0000-000000000004', 'kwon_88',     'seed_kwon88@cardpick.kr',     '25 days'),
    ('a0000001-0000-0000-0000-000000000005', 'pokefan',     'seed_pokefan@cardpick.kr',    '40 days'),
    ('a0000001-0000-0000-0000-000000000006', 'mintchoco',   'seed_mintchoco@cardpick.kr',  '55 days'),
    ('a0000001-0000-0000-0000-000000000007', 'sjlee',       'seed_sjlee@cardpick.kr',      '20 days'),
    ('a0000001-0000-0000-0000-000000000008', '카드덕후',    'seed_kdh@cardpick.kr',        '50 days'),
    ('a0000001-0000-0000-0000-000000000009', '박스깡중독',  'seed_boxgang@cardpick.kr',    '35 days'),
]

# 6개 글: (user_id, board, title, body, days_ago, hours_ago, views, comments_count)
POSTS = [
    # 1. 질문 — PSA 기준
    ('a0000001-0000-0000-0000-000000000006', 'qna',
     'PSA 보낼 카드 고를 때 기준이 뭔가요?',
     '처음으로 PSA 보내보려고 하는데 막상 고르려니까 어렵네요.\n\n그냥 비싼 카드 위주로 보내는 게 맞는지,\n아니면 상태 좋은 카드만 골라야 하는지 고민입니다.\n\n특히 모서리 살짝 하얀 점 있는 카드도 PSA 10 가능성이 있는지 궁금해요.',
     6, 14, 287, 0),
    # 2. 질문 — 일판 vs 한글판
    ('a0000001-0000-0000-0000-000000000004', 'qna',
     '일판 카드가 한글판보다 더 잘 팔리나요?',
     '요즘 일본판 카드도 많이 보이던데\n한국에서는 한글판이 더 거래 잘 되는지, 일판도 수요가 있는지 궁금합니다.\n\n가격은 일판이 더 싸게 보이는 경우가 많아서\n직구해서 모으는 것도 괜찮아 보이네요.',
     5, 9, 196, 1),
    # 3. 질문 — 센터링
    ('a0000001-0000-0000-0000-000000000007', 'qna',
     'PSA 10 기대하고 샀는데 센터링이 애매하네요',
     '사진상으로는 괜찮아 보여서 샀는데 받아보니 좌우 센터링이 좀 차이 납니다.\n\n앞면 기준으로 왼쪽이 약간 좁고 오른쪽이 넓은 느낌인데\n이 정도면 PSA 10은 어렵다고 봐야 할까요?\n\n카드 상태는 표면이랑 모서리는 괜찮아 보입니다.',
     3, 19, 342, 2),
    # 4. 자유 — 보관
    ('a0000001-0000-0000-0000-000000000005', 'free',
     '카드 보관할 때 탑로더만 써도 괜찮나요?',
     '지금은 슬리브 끼우고 탑로더에만 넣어두고 있는데\n장기 보관하려면 원터치 케이스나 바인더가 더 나을까요?\n\n습기 때문에 실리카겔도 같이 넣어야 하는지 궁금합니다.',
     4, 11, 164, 1),
    # 5. 자유 — 해외 참고가
    ('a0000001-0000-0000-0000-000000000008', 'free',
     '카드 가격 볼 때 해외 참고가랑 국내 거래가 차이 많이 나나요?',
     '해외 사이트 가격 보면 생각보다 높은데\n국내 장터에서는 더 낮게 올라오는 경우도 있더라고요.\n\nTCGplayer나 Cardmarket 가격은 그냥 참고용으로만 봐야 하는 건가요?\n환율이랑 배송비까지 생각하면 헷갈립니다.',
     2, 7, 213, 0),
    # 6. 질문 — BGS vs PSA
    ('a0000001-0000-0000-0000-000000000009', 'qna',
     'BGS랑 PSA 중에 뭐가 더 나을까요?',
     '처음엔 무조건 PSA라고 생각했는데\nBGS 블랙라벨 얘기도 많아서 고민됩니다.\n\n포켓몬 카드는 한국에서 PSA가 더 잘 팔리는 편인가요?\n아니면 상태 정말 좋은 카드는 BGS도 괜찮을까요?',
     2, 4, 251, 2),
]

# 댓글: 각 글 인덱스별 [(user_id, body, days_ago_offset_from_post, hours_ago_offset)]
# offset = 글 작성 후 경과 (positive)
COMMENTS_BY_POST = {
    1: [  # 2번 글 (일판) — 1 댓글
        ('a0000001-0000-0000-0000-000000000002',  # 포카박스
         '카드 종류마다 달라요. 플레이 수요는 한글판이 편하고, 컬렉션 수요는 일판도 꽤 있습니다. SAR이나 인기 일러스트 카드는 일판도 잘 봅니다.',
         0, 5),  # 글 작성 5시간 후
    ],
    2: [  # 3번 글 (센터링) — 2 댓글
        ('a0000001-0000-0000-0000-000000000003',  # ddung
         '센터링만 애매하고 나머지가 좋으면 9는 기대해볼 수 있는데, 10은 카드마다 운도 좀 있는 것 같아요.',
         0, 3),
        ('a0000001-0000-0000-0000-000000000008',  # 카드덕후
         '스캔해서 비율 재보는 게 제일 정확합니다. 눈대중으로는 생각보다 차이가 커 보일 때도 있고요.',
         1, 2),
    ],
    3: [  # 4번 글 (탑로더) — 1 댓글
        ('a0000001-0000-0000-0000-000000000009',  # 박스깡중독
         '슬리브 + 탑로더면 기본 보관은 충분합니다. 다만 습기 많은 곳이면 밀폐 박스랑 실리카겔 같이 쓰는 게 좋아요.',
         0, 8),
    ],
    5: [  # 6번 글 (BGS) — 2 댓글
        ('a0000001-0000-0000-0000-000000000002',  # 포카박스
         '국내 포켓몬은 아직 PSA 선호가 더 강한 편입니다. 되팔 생각이면 PSA가 무난해요.',
         0, 2),
        ('a0000001-0000-0000-0000-000000000006',  # mintchoco
         'BGS는 블랙라벨 기대할 정도로 상태가 진짜 좋아야 매력이 있는 것 같습니다. 일반 9.5면 PSA 10이 더 편할 때도 있어요.',
         1, 1),
    ],
}

def main():
    print("[seed_board_batch2] 시드 시작")
    conn = psycopg2.connect(**PG); conn.autocommit = False
    cur = conn.cursor()

    # 1. auth.users 6명 (신규)
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

    # 3. 글 6개 + 댓글
    inserted_posts = 0
    inserted_comments = 0
    for idx, (user_id, board, title, body, d_ago, h_ago, views, cc) in enumerate(POSTS):
        # 중복 체크
        cur.execute("SELECT id FROM posts WHERE user_id = %s AND title = %s LIMIT 1", (user_id, title))
        existing = cur.fetchone()
        if existing:
            post_id = existing[0]
            print(f"  [{idx+1}] post exists, skip: {title[:30]}...")
            continue

        # 글 INSERT
        interval_expr = f"interval '{d_ago} days' + interval '{h_ago} hours'"
        cur.execute(f"""
            INSERT INTO posts (
                user_id, board, title, body, created_at, updated_at,
                is_pinned, views, likes, comments_count
            ) VALUES (
                %s, %s, %s, %s,
                now() - {interval_expr}, now() - {interval_expr},
                false, %s, 0, %s
            )
            RETURNING id
        """, (user_id, board, title, body, views, cc))
        post_id = cur.fetchone()[0]
        inserted_posts += 1
        print(f"  [{idx+1}] post inserted: {title[:30]}... (views={views}, cc={cc})")

        # 댓글
        for c_uid, c_body, c_d_off, c_h_off in COMMENTS_BY_POST.get(idx, []):
            # 댓글 작성 시각 = 글 작성 시각 + offset
            # = now() - (post_interval - comment_offset)
            # post_interval = d_ago days + h_ago hours
            # comment_offset = c_d_off days + c_h_off hours (글 작성 후 경과)
            # 댓글 시각 = now() - (d_ago - c_d_off) days - (h_ago - c_h_off) hours
            net_d = d_ago - c_d_off
            net_h = h_ago - c_h_off
            cur.execute(f"""
                INSERT INTO comments (post_id, user_id, body, created_at)
                VALUES (%s, %s, %s, now() - interval '{net_d} days' - interval '{net_h} hours')
            """, (post_id, c_uid, c_body))
            inserted_comments += 1

        # comments_count 동기화
        cur.execute("""
            UPDATE posts SET comments_count = (SELECT count(*) FROM comments WHERE post_id = %s)
             WHERE id = %s
        """, (post_id, post_id))

    # 4. batch1 글 views 보정 (PSA 50만원 글 — 시드 시점 views=0이라 부자연스러움)
    cur.execute("""
        UPDATE posts SET views = 318
         WHERE user_id = 'a0000001-0000-0000-0000-000000000001'
           AND title = 'PSA 처음 보내려는데 비용이 50만원 넘네요;;'
           AND views < 100
    """)
    print(f"  batch1 views fix: {cur.rowcount} row(s)")

    # 5. 일판 댓글 문구 수정 ("잘 봅니다" → "잘 팔립니다")
    cur.execute("""
        UPDATE comments
           SET body = replace(body, '일판도 잘 봅니다', '일판도 잘 팔립니다')
         WHERE body LIKE '%일판도 잘 봅니다%'
    """)
    print(f"  comment fix: {cur.rowcount} row(s)")

    conn.commit()
    cur.close(); conn.close()
    print(f"[seed_board_batch2] 완료: posts={inserted_posts}, comments={inserted_comments}")

if __name__ == "__main__":
    main()
