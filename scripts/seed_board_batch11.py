#!/usr/bin/env python3
"""게시판 시드 11차: 며칠간 글 없던 공백 메우기. 신규 주제 3개(장마철 습기 관리 / 진열장 들인 썰 / 취미 지출 현타) + 신규 유저 3명(033~035).
기존 1~10차 주제와 안 겹침. 비카드성 일상 주제(진열장·지출) 포함. 닉네임·UID 기존(~032)과 중복 없음.
likes 0 유지, 조회수 현실적(28~52), 댓글 신규+기존 닉 혼합. 제목 중복 체크로 멱등.
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

# 신규 3명 (기존 032까지와 안 겹침: 033~035)
USERS = [
    ('a0000001-0000-0000-0000-000000000033', '장마철고민',   'seed_humidity@cardpick.kr',  '20 days'),
    ('a0000001-0000-0000-0000-000000000034', '진열장로망',   'seed_display@cardpick.kr',   '12 days'),
    ('a0000001-0000-0000-0000-000000000035', '취미한도초과', 'seed_spending@cardpick.kr',  '9 days'),
]

# 글 3개: (user_id, board, title, body, hours_ago, views, cc)
POSTS = [
    ('a0000001-0000-0000-0000-000000000033', 'qna',
     '장마철인데 카드 습기 어떻게들 관리하세요?',
     '요 며칠 비 오고 습해지니까 모아둔 카드들 괜찮나 자꾸 신경 쓰이네요.\n'
     '평소엔 슬리브에 탑로더 정도만 해뒀는데, 이 시기엔 그걸로 충분한가 싶어서요.\n\n'
     '서랍에 제습제 같이 넣어두는 분도 있다던데, 다들 장마철엔 따로 신경 쓰시는 게 있나요? 방습함까지 가야 하나 고민이에요.',
     5, 28, 2),
    ('a0000001-0000-0000-0000-000000000034', 'free',
     '카드 진열장 들였는데 방이 좁아졌어요 ㅎㅎ',
     '계속 박스에만 쌓아두다가 큰맘 먹고 작은 진열장 하나 들였어요.\n'
     '좋아하는 카드 몇 장 세워두니까 볼 때마다 기분 좋긴 한데, 안 그래도 좁은 방이 더 좁아진 느낌이네요 ㅎㅎ\n\n'
     '다들 컬렉션 어떻게 두세요? 그냥 바인더로 보관하는 게 공간엔 낫겠다 싶다가도, 세워두고 보는 맛이 또 있어서 고민이에요.',
     26, 41, 2),
    ('a0000001-0000-0000-0000-000000000035', 'free',
     '이번 달 취미에 쓴 돈 세어보다가 흠칫했네요',
     '문득 이번 달에 취미로 얼마 썼나 한번 더해봤는데 생각보다 금액이 커서 좀 놀랐어요.\n'
     '한 번에 크게 쓴 건 아닌데 조금씩 산 게 쌓이니까 만만치 않더라고요.\n\n'
     '다들 취미 지출은 따로 예산 정해두고 하시나요? 즐기는 건 좋은데 가끔 현타 와서요. 어떻게들 조절하시는지 궁금합니다.',
     44, 52, 1),
]

# 댓글: 글 인덱스 → (작성자 UID, 본문, hours_offset_from_post). 신규 + 기존 닉 혼합.
COMMENTS = {
    0: [  # 장마철 습기
        ('a0000001-0000-0000-0000-000000000021',  # collec_kim (기존)
         '저는 장마철엔 지퍼백에 카드 슬리브째 넣고, 그 안에 작은 제습제 하나 같이 둬요. 서랍 안쪽이 의외로 습해서요. 방습함까지는 아끼는 슬랩 몇 장만 따로 넣어두는 정도면 충분하더라고요.',
         2),
        ('a0000001-0000-0000-0000-000000000033',  # 장마철고민 (작성자)
         '지퍼백에 제습제 같이 두는 거 바로 따라 해야겠어요. 전부 방습함 갈까 고민했는데 마음 좀 놓이네요. 감사합니다.',
         3),
    ],
    1: [  # 진열장
        ('a0000001-0000-0000-0000-000000000016',  # dh_collect (기존)
         '세워두는 맛 진짜 무시 못 하죠 ㅎㅎ 대신 진열장 둘 때 직사광선 드는 자리만 피하시는 게 좋아요. 햇빛 오래 받으면 색이 좀 바래더라고요. 저는 평소 보는 건 진열, 나머진 바인더로 반반 합니다.',
         3),
        ('a0000001-0000-0000-0000-000000000034',  # 진열장로망 (작성자)
         '아 햇빛은 생각 못 했네요. 자리 다시 봐야겠어요. 반반 보관 좋은 것 같아요 ㅎㅎ',
         5),
    ],
    2: [  # 지출 현타
        ('a0000001-0000-0000-0000-000000000021',  # collec_kim (기존)
         '저도 조금씩 산 게 쌓여서 놀란 적 많아요 ㅎㅎ 저는 한 달 쓸 금액만 정해두고 그 안에서만 사려고 해요. 그러면 살 때 한 번 더 고민하게 되더라고요.',
         6),
    ],
}

def main():
    print("[seed_board_batch11] 시작")
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
    print(f"[seed_board_batch11] 완료: posts={ins_p}, comments={ins_c}")

if __name__ == "__main__":
    main()
