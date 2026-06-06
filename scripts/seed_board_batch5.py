#!/usr/bin/env python3
"""게시판 시드 5차 — 신규 주제 2개 (PSA 센터링 질문 / 최신 팩 개봉 후기) + 신규 유저 3명.
기존 17명 닉네임·11개 주제와 안 겹침. 댓글은 신규 + 기존 닉 혼합(자연스러움).
psycopg2 직접 연결 (RLS 우회). 제목 중복 체크로 멱등 — seed-board job 재실행해도 중복 INSERT 없음.
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

# 신규 3명 (기존 17명과 안 겹침: 018~020)
USERS = [
    ('a0000001-0000-0000-0000-000000000018', '센터링장인',  'seed_center@cardpick.kr',  '29 days'),
    ('a0000001-0000-0000-0000-000000000019', 'mint_box',    'seed_mintbox@cardpick.kr', '16 days'),
    ('a0000001-0000-0000-0000-000000000020', 'pkm_jun',     'seed_pkmjun@cardpick.kr',  '54 days'),
]

# 글 2개: (user_id, board, title, body, hours_ago, views, cc)
POSTS = [
    ('a0000001-0000-0000-0000-000000000018', 'qna',
     'PSA 처음 보내는데 이 카드 센터링 10 나올까요?',
     '그레이딩 한 번도 안 해봤는데 아끼는 카드 하나 보내볼까 고민 중이에요.\n'
     '앞면은 위아래 여백이 거의 비슷한데 좌우가 살짝 한쪽으로 쏠려 보이고,\n'
     '뒷면은 눈으로 봤을 때 꽤 가운데 맞는 것 같아요.\n\n'
     '모서리랑 표면은 깨끗한 편인데, 이 정도 센터링이면 10 노려볼 만한가요?\n'
     '아니면 9 정도로 보고 보내는 게 맞을까요? 경험자분들 의견 궁금합니다.',
     3, 53, 2),
    ('a0000001-0000-0000-0000-000000000019', 'free',
     '최신 팩 한 박스 까봤는데 SAR 떴네요 (오랜만에 운 좋음)',
     '진짜 오랜만에 한 박스 통으로 까봤는데\n'
     '마지막 팩에서 SAR 한 장 나와서 기분 좋네요.\n\n'
     '평소엔 단품으로만 사다가 가끔 박스깡 하면 이 맛에 하는 것 같아요.\n'
     '그동안 박스깡 손익은 거의 본전치기였는데 오늘은 운이 좋았습니다.\n'
     '다들 요즘 박스 까서 잘 나오시나요?',
     6, 38, 2),
]

# 댓글: 글 인덱스 → (작성자 UID, 본문, hours_offset_from_post)
COMMENTS = {
    0: [  # PSA 센터링
        ('a0000001-0000-0000-0000-000000000020',
         'PSA는 앞면 센터링을 제일 크게 봐요. 좌우가 눈에 띄게 쏠리면 10은 어렵고 9가 현실적인 경우가 많아요. 모서리·표면이 깨끗하면 9는 충분히 노려볼 만합니다. 빛에 비춰서 긁힘이랑 화이트닝부터 다시 확인해보세요.',
         2),
        ('a0000001-0000-0000-0000-000000000010',  # 기존 닉 재등장 (자연스러움)
         '저도 첫 제출 때 센터링 좋아 보였는데 9 받았어요. 눈으로는 괜찮아 보여도 측정하면 다른 경우 많더라고요. 아끼는 카드면 기대치는 9로 두고 보내는 게 마음 편합니다.',
         4),
    ],
    1: [  # 박스깡 SAR
        ('a0000001-0000-0000-0000-000000000008',  # 카드덕후 (기존)
         '오 축하해요. 마지막 팩에서 터지면 그 맛이 진짜죠. 무슨 SAR 나왔는지 궁금하네요.',
         2),
        ('a0000001-0000-0000-0000-000000000020',
         '박스깡은 본전만 해도 잘한 거라던데 SAR까지 떴으면 오늘 대박이네요. 부럽습니다.',
         5),
    ],
}

def main():
    print("[seed_board_batch5] 시작")
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
    print(f"[seed_board_batch5] 완료: posts={ins_p}, comments={ins_c}")

if __name__ == "__main__":
    main()
