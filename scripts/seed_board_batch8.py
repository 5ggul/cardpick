#!/usr/bin/env python3
"""게시판 시드 8차 — 신규 주제 2개 (첫 입문 박스 고민 / 카드 시세 급등 체감) + 신규 유저 2명(027~028).
기존 1~7차 주제(관세·입문박스·PSA재제출·SAR시세·센터링·박스깡·모서리그레이딩·카드샵빈티지·한글판일판·이중슬리빙·첫그레이딩후기)와 안 겹침.
유저 ID·닉네임 모두 기존(~026)과 중복 없음. 댓글은 신규 + 기존 닉 혼합. psycopg2 직접 연결. 제목 중복 체크로 멱등.
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

# 신규 2명 (기존 026까지와 안 겹침: 027~028)
USERS = [
    ('a0000001-0000-0000-0000-000000000027', '덱입문중',     'seed_deckintro@cardpick.kr', '21 days'),
    ('a0000001-0000-0000-0000-000000000028', 'price_watch',  'seed_pricewatch@cardpick.kr', '47 days'),
]

# 글 2개: (user_id, board, title, body, hours_ago, views, cc)
POSTS = [
    ('a0000001-0000-0000-0000-000000000027', 'qna',
     '입문용으로 박스 사는 게 나을까요, 싱글로 모으는 게 나을까요',
     '얼마 전부터 포켓몬 카드에 관심이 생겨서 이제 막 시작하려는 단계입니다.\n'
     '처음엔 박스를 통째로 사서 뜯는 재미로 시작할지, 아니면 원하는 카드만 싱글로 사 모을지 고민이에요.\n\n'
     '박스는 뜯는 재미는 있는데 원하는 카드가 안 나오면 손해 같고, 싱글은 확실한 대신 재미는 좀 덜할 것 같고요.\n'
     '입문자 기준으로 어느 쪽을 추천하시나요? 둘 다 해보신 분들 의견 궁금합니다.',
     5, 44, 2),
    ('a0000001-0000-0000-0000-000000000028', 'free',
     '요즘 인기 카드 시세 체감상 좀 오른 것 같지 않나요',
     '최근 들어 관심 있게 보던 카드 몇 개 시세를 다시 보니 예전보다 오른 느낌이에요.\n'
     '신상 발매 시즌이라 그런가 싶기도 하고, 그냥 제 착각인지도 모르겠네요.\n\n'
     '한두 건 호가만 보면 헷갈려서, 요즘은 흐름을 같이 보려고 하는데도 판단이 쉽지 않더라고요.\n'
     '다들 시세 볼 때 한 시점 가격이랑 흐름 중에 뭘 더 참고하시나요?',
     8, 37, 2),
]

# 댓글: 글 인덱스 → (작성자 UID, 본문, hours_offset_from_post). 신규 + 기존 닉 혼합.
COMMENTS = {
    0: [  # 박스 vs 싱글 입문
        ('a0000001-0000-0000-0000-000000000016',  # dh_collect (기존)
         '둘 다 해본 입장에선, 갖고 싶은 특정 카드가 분명하면 싱글이 돈·시간 다 아껴요. 박스는 "이 세트 전체를 즐기고 싶다" 싶을 때 뜯는 재미로 사는 거고요. 입문이면 우선 싱글로 원하는 카드 몇 장 사보고, 마음에 드는 세트가 생기면 그때 박스 한 통 가보는 순서를 추천해요.',
         2),
        ('a0000001-0000-0000-0000-000000000027',  # 덱입문중 (신규)
         '아 그렇게 순서를 잡으면 되겠네요. 일단 원하는 카드부터 싱글로 사봐야겠어요. 감사합니다.',
         4),
    ],
    1: [  # 시세 체감 상승
        ('a0000001-0000-0000-0000-000000000021',  # collec_kim (기존)
         '신상 시즌엔 관심이 몰려서 실제로 출렁이는 경우가 많아요. 다만 한두 건 호가는 튀기 쉬워서, 저는 표본이 좀 쌓인 흐름 위주로 봅니다. 한 시점 가격은 "지금 이 정도 호가구나" 참고만 하고, 살지 말지는 흐름 보고 정하는 편이에요.',
         3),
        ('a0000001-0000-0000-0000-000000000028',  # price_watch (신규, 작성자 본인 추가 코멘트)
         '맞아요. 단발 호가에 휘둘리지 않으려고 흐름 위주로 보는 습관 들이는 중입니다.',
         5),
    ],
}

def main():
    print("[seed_board_batch8] 시작")
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
    print(f"[seed_board_batch8] 완료: posts={ins_p}, comments={ins_c}")

if __name__ == "__main__":
    main()
