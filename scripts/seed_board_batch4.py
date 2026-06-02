#!/usr/bin/env python3
"""게시판 시드 4차 — 신규 주제 2개 (직구 관세 / 입문 첫 박스) + 신규 유저 4명.
기존 13명 닉네임·9개 주제와 안 겹침. psycopg2 직접 연결 (RLS 우회).
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

# 신규 4명 (기존 13명과 안 겹침)
USERS = [
    ('a0000001-0000-0000-0000-000000000014', 'yuna_pc',    'seed_yunapc@cardpick.kr',   '22 days'),
    ('a0000001-0000-0000-0000-000000000015', '카드초보링', 'seed_chobo@cardpick.kr',    '12 days'),
    ('a0000001-0000-0000-0000-000000000016', 'dh_collect', 'seed_dhcol@cardpick.kr',    '48 days'),
    ('a0000001-0000-0000-0000-000000000017', '짱구카드',   'seed_jjanggu@cardpick.kr',  '37 days'),
]

# 글 2개: (user_id, board, title, body, hours_ago, views, cc)
POSTS = [
    ('a0000001-0000-0000-0000-000000000014', 'qna',
     '일본 메루카리 직구했는데 관세 6만원대 나왔어요 정상인가요?',
     '메루카리에서 SAR 한 장 28만원 정도에 샀는데\n'
     '한국 들어올 때 관세 + 부가세로 6만원 넘게 나왔네요.\n\n'
     '150달러 넘으면 과세된다는 건 알았는데 생각보다 많이 나와서요.\n'
     '이 정도면 정상 범위인가요? 다음엔 어떻게 사야 덜 나올까요?\n\n'
     '계산기 돌려보니 비슷하게 나오긴 하더라고요.',
     2, 41, 1),
    ('a0000001-0000-0000-0000-000000000015', 'free',
     '입문인데 첫 박스 151이랑 최신 팩 중에 뭐가 나을까요?',
     '포켓몬 카드 이제 막 시작하려는 입문자입니다.\n'
     '151이 인기 많다고 들었는데 지금 사기엔 좀 비싸고,\n'
     '최신 팩은 그래도 정가에 가깝게 구할 수 있더라고요.\n\n'
     '수집이 목적이고 나중에 가치도 조금 생각하는데\n'
     '첫 박스로 뭐가 무난할까요? 조언 부탁드려요.',
     4, 27, 2),
]

# 댓글: 글 인덱스 → (댓글 작성자 UID, 본문, hours_offset_from_post)
COMMENTS = {
    0: [  # 관세
        ('a0000001-0000-0000-0000-000000000016',
         '28만원이면 200달러 넘으니까 일본은 150달러 한도라 전체 과세 맞아요. 관세 + 부가세 합치면 13~18% 정도라 6만원대면 정상 범위입니다. 줄이려면 한 번에 150달러 이하로 나눠 사거나 도착일을 분산하는 방법밖에 없어요.',
         3),
    ],
    1: [  # 입문 첫 박스
        ('a0000001-0000-0000-0000-000000000017',
         '수집 목적이면 본인이 좋아하는 포켓몬 나오는 팩이 제일 무난해요. 151은 가치 면에선 좋은데 지금 프리미엄 붙어서 입문 첫 박스로는 부담될 수 있어요. 최신 팩 정가로 한 박스 까보고 재미 붙으면 그때 151 단품으로 노려도 됩니다.',
         1),
        ('a0000001-0000-0000-0000-000000000008',  # 카드덕후 (기존 닉 재등장 — 자연스러움)
         '저도 입문 때 최신 팩부터 시작했는데 후회 없어요. 박스깡 재미가 입문엔 더 크더라고요. 151은 천천히.',
         5),
    ],
}

def main():
    print("[seed_board_batch4] 시작")
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
    print(f"[seed_board_batch4] 완료: posts={ins_p}, comments={ins_c}")

if __name__ == "__main__":
    main()
