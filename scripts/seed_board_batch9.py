#!/usr/bin/env python3
"""게시판 시드 9차 — 신규 주제 2개 (장기 보관 색바램·자외선 / 첫 중고 거래 후기) + 신규 유저 2명(029~030).
기존 1~8차 주제와 안 겹침. 유저 ID·닉네임 모두 기존(~028)과 중복 없음. 댓글은 신규 + 기존 닉 혼합.
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

# 신규 2명 (기존 028까지와 안 겹침: 029~030)
USERS = [
    ('a0000001-0000-0000-0000-000000000029', '보관고민',     'seed_keepcare@cardpick.kr',  '38 days'),
    ('a0000001-0000-0000-0000-000000000030', '첫거래완료',   'seed_firsttrade@cardpick.kr', '12 days'),
]

# 글 2개: (user_id, board, title, body, hours_ago, views, cc)
POSTS = [
    ('a0000001-0000-0000-0000-000000000029', 'qna',
     '카드 오래 두니 색이 바래는 느낌인데 장기 보관 어떻게 하세요?',
     '몇 년 전에 모아둔 카드를 오랜만에 꺼내봤는데, 예전보다 색이 살짝 바랜 것 같은 느낌이 들어요.\n'
     '창가 근처 책장에 슬리브만 끼워서 세워뒀었는데 그게 문제였나 싶기도 하고요.\n\n'
     '장기 보관할 때 햇빛이나 습도 같은 거 다들 어떻게 관리하시나요?\n'
     '바인더가 나은지, 탑로더+박스로 빛 안 들게 두는 게 나은지 궁금합니다.',
     6, 52, 2),
    ('a0000001-0000-0000-0000-000000000030', 'free',
     '처음으로 카드 중고로 팔아봤는데 후기 남깁니다',
     '안 쓰는 중복 카드 몇 장을 처음으로 중고로 정리해봤어요.\n'
     '시세를 미리 확인하고 적당한 선에서 내놨더니 생각보다 금방 거래가 됐네요.\n\n'
     '처음이라 택배 포장이 제일 신경 쓰였는데, 슬리브+탑로더+완충재로 단단히 싸서 보냈습니다.\n'
     '거래 전에 시세부터 잡고 들어가니 마음이 편하더라고요. 다들 첫 거래 어떠셨나요?',
     9, 40, 2),
]

# 댓글: 글 인덱스 → (작성자 UID, 본문, hours_offset_from_post). 신규 + 기존 닉 혼합.
COMMENTS = {
    0: [  # 장기 보관 색바램
        ('a0000001-0000-0000-0000-000000000016',  # dh_collect (기존)
         '직사광선이 색바램(탈색)의 가장 큰 적이에요. 창가는 피하고 서랍이나 빛 안 드는 박스에 두는 게 안전합니다. 습도도 너무 높으면 휨·곰팡이 위험이라 제습제 한두 개 같이 넣어두면 좋아요. 자주 볼 카드는 바인더, 장기 보관은 탑로더+불투명 박스 조합을 많이 씁니다.',
         2),
        ('a0000001-0000-0000-0000-000000000022',  # 각진모서리 (기존)
         '맞아요. 저도 창가에 뒀다가 한 장 바래서 그 뒤로 전부 서랍행입니다. 빛만 차단해도 체감 차이 커요.',
         4),
    ],
    1: [  # 첫 중고 거래 후기
        ('a0000001-0000-0000-0000-000000000028',  # price_watch (기존)
         '시세 먼저 잡고 들어가는 거 정말 중요하죠. 포장도 잘 하셨네요. 받는 분도 상태 그대로 받으면 후기 좋게 남겨주셔서 다음 거래도 수월해집니다.',
         3),
        ('a0000001-0000-0000-0000-000000000030',  # 첫거래완료 (작성자 본인 추가)
         '맞아요, 포장 칭찬받으니 뿌듯하더라고요. 다음엔 좀 더 정리해서 내놔보려고요.',
         5),
    ],
}

def main():
    print("[seed_board_batch9] 시작")
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
    print(f"[seed_board_batch9] 완료: posts={ins_p}, comments={ins_c}")

if __name__ == "__main__":
    main()
