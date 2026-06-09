#!/usr/bin/env python3
"""게시판 시드 6차 — 신규 주제 3개 (모서리 눌림 그레이딩 / 카드샵 빈티지 발견 / 한글판·일판 섞어 수집) + 신규 유저 4명.
기존 1~5차 주제(관세·입문박스·PSA재제출·SAR시세·센터링·박스깡)와 안 겹침. 댓글은 신규 + 기존 닉 혼합.
psycopg2 직접 연결. 제목 중복 체크로 멱등.
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

# 신규 4명 (기존 20명과 안 겹침: 021~024)
USERS = [
    ('a0000001-0000-0000-0000-000000000021', 'collec_kim',   'seed_colleckim@cardpick.kr', '33 days'),
    ('a0000001-0000-0000-0000-000000000022', '각진모서리',   'seed_corner@cardpick.kr',    '19 days'),
    ('a0000001-0000-0000-0000-000000000023', 'jp_hunter',    'seed_jphunter@cardpick.kr',  '61 days'),
    ('a0000001-0000-0000-0000-000000000024', '포린이일기',   'seed_porini@cardpick.kr',    '9 days'),
]

# 글 3개: (user_id, board, title, body, hours_ago, views, cc)
POSTS = [
    ('a0000001-0000-0000-0000-000000000022', 'qna',
     '카드 모서리가 살짝 눌렸는데 그레이딩 보낼 가치 있을까요?',
     '아끼는 카드인데 모서리 한 곳이 아주 살짝 눌린 자국이 있어요.\n'
     '눈으로 자세히 봐야 보일 정도인데, 표면이랑 센터링은 깨끗한 편입니다.\n\n'
     '이 정도면 그레이딩 보내는 게 의미가 있을까요?\n'
     '아니면 모서리 때문에 높은 등급은 어차피 안 나와서 그냥 보관만 하는 게 나을까요?\n'
     '경험 있으신 분들 의견 궁금합니다.',
     3, 47, 2),
    ('a0000001-0000-0000-0000-000000000021', 'free',
     '동네 카드샵 갔다가 옛날 카드 발견했어요',
     '오랜만에 동네 카드샵 구경 갔는데 구석 박스에서 예전 카드들이 좀 나오더라고요.\n'
     '요즘 신상만 보다가 옛날 일러스트 보니까 또 색다르고 좋네요.\n\n'
     '온라인으로만 사다가 오프라인 샵 둘러보는 재미도 쏠쏠한 것 같아요.\n'
     '다들 오프라인 카드샵 자주 가시나요?',
     7, 33, 0),
    ('a0000001-0000-0000-0000-000000000023', 'qna',
     '한글판이랑 일판 섞어서 모으는데 나중에 가치 차이 클까요?',
     '입문할 때 한글판으로 시작했는데, 일판 일러스트가 마음에 드는 게 많아서\n'
     '요즘은 둘 다 섞어서 모으고 있어요.\n\n'
     '나중에 되팔거나 가치 생각하면 한 가지로 통일하는 게 나을까요?\n'
     '아니면 그냥 취향대로 섞어도 상관없을까요? 판본별 수요 차이가 궁금합니다.',
     5, 39, 2),
]

# 댓글: 글 인덱스 → (작성자 UID, 본문, hours_offset_from_post)
COMMENTS = {
    0: [  # 모서리 그레이딩
        ('a0000001-0000-0000-0000-000000000020',
         '모서리 눌림은 코너 점수에서 깎여서 PSA 10은 현실적으로 어려워요. 다만 표면·센터링이 좋으면 9는 노려볼 만합니다. 카드 가치가 높은 편이면 9도 의미 있고, 저가 카드면 그레이딩비가 아까울 수 있으니 카드 시세 먼저 보고 정하세요.',
         2),
        ('a0000001-0000-0000-0000-000000000024',
         '저도 딱 그 고민 중이었는데 도움 되네요. 빛에 비춰서 눌린 부분 깊이부터 다시 봐야겠어요.',
         4),
    ],
    1: [],  # 카드샵 빈티지 — 댓글 없음 (사용자 요청으로 제거)
    2: [  # 한글판 일판
        ('a0000001-0000-0000-0000-000000000016',  # dh_collect (기존)
         '되팔이나 글로벌 수요까지 보면 일판·영문이 거래가 더 활발한 편이에요. 한글판은 국내 중심이라 시장이 상대적으로 작고요. 다만 같은 카드도 레어도·상태에 따라 다르니 한 가지로 단정하긴 어렵습니다.',
         2),
        ('a0000001-0000-0000-0000-000000000010',  # 기존
         '수집이 목적이면 그냥 마음에 드는 판으로 모으는 게 오래 가더라고요. 저는 일러스트 기준으로 섞어서 모으는데 후회 없어요.',
         4),
    ],
}

def main():
    print("[seed_board_batch6] 시작")
    conn = psycopg2.connect(**PG); conn.autocommit = False
    cur = conn.cursor()

    for uid, nick, email, age in USERS:
        cur.execute("""
            INSERT INTO auth.users (id, instance_id, aud, role, email,
                encrypted_password, email_confirmed_at, created_at, updated_at,
                raw_user_meta_data, raw_app_meta_data)
            VALUES (%s, '00000000-0000-0000-0000-000000000000', 'authenticated','authenticated', %s,
                '', now() - interval %s, now() - interval %s, now(),
                ('{"name":"' || %s || '"}')::jsonb, '{"provider":"seed","providers":["seed"]}'::jsonb)
            ON CONFLICT (id) DO NOTHING
        """, (uid, email, age, age, nick))
    print(f"  auth.users upserted: {len(USERS)}")

    for uid, nick, email, age in USERS:
        cur.execute("""
            INSERT INTO profiles (id, nickname, display_name, created_at, updated_at)
            VALUES (%s, %s, %s, now() - interval %s, now())
            ON CONFLICT (id) DO UPDATE SET nickname=EXCLUDED.nickname, display_name=EXCLUDED.display_name, updated_at=now()
        """, (uid, nick, nick, age))
    print(f"  profiles upserted: {len(USERS)}")

    ins_p = ins_c = 0
    for idx, (user_id, board, title, body, h_ago, views, cc) in enumerate(POSTS):
        cur.execute("SELECT id FROM posts WHERE user_id=%s AND title=%s LIMIT 1", (user_id, title))
        if cur.fetchone():
            print(f"  [{idx+1}] exists skip"); continue
        cur.execute(f"""
            INSERT INTO posts (user_id, board, title, body, created_at, updated_at, is_pinned, views, likes, comments_count)
            VALUES (%s,%s,%s,%s, now() - interval '{h_ago} hours', now() - interval '{h_ago} hours', false, %s, 0, %s)
            RETURNING id
        """, (user_id, board, title, body, views, cc))
        post_id = cur.fetchone()[0]; ins_p += 1
        print(f"  [{idx+1}] inserted ({h_ago}h ago): {title[:35]}")
        for c_uid, c_body, c_h_off in COMMENTS.get(idx, []):
            net_h = max(0, h_ago - c_h_off)
            cur.execute(f"""
                INSERT INTO comments (post_id, user_id, body, created_at)
                VALUES (%s,%s,%s, now() - interval '{net_h} hours')
            """, (post_id, c_uid, c_body))
            ins_c += 1
        cur.execute("UPDATE posts SET comments_count=(SELECT count(*) FROM comments WHERE post_id=%s) WHERE id=%s", (post_id, post_id))

    conn.commit(); cur.close(); conn.close()
    print(f"[seed_board_batch6] 완료: posts={ins_p}, comments={ins_c}")

if __name__ == "__main__":
    main()
