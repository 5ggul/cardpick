#!/usr/bin/env python3
"""게시판 시드 7차 — 신규 주제 2개 (이중 슬리빙 필요성 / 첫 그레이딩 결과 후기) + 신규 유저 2명(025~026).
기존 1~6차 주제(관세·입문박스·PSA재제출·SAR시세·센터링·박스깡·모서리그레이딩·카드샵빈티지·한글판일판)와 안 겹침.
유저 ID·닉네임 모두 기존과 중복 없음. 댓글은 신규 + 기존 닉 혼합. psycopg2 직접 연결. 제목 중복 체크로 멱등.
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

# 신규 2명 (기존 024까지와 안 겹침: 025~026)
USERS = [
    ('a0000001-0000-0000-0000-000000000025', 'sleeve_note',  'seed_sleevenote@cardpick.kr', '27 days'),
    ('a0000001-0000-0000-0000-000000000026', '첫그레이딩',   'seed_firstgrade@cardpick.kr', '14 days'),
]

# 글 2개: (user_id, board, title, body, hours_ago, views, cc)
POSTS = [
    ('a0000001-0000-0000-0000-000000000025', 'qna',
     '이중 슬리브 꼭 해야 하나요? 한 겹이면 부족할까요',
     '아끼는 카드 몇 장 보관하려고 슬리브 알아보는 중인데요.\n'
     '검색하다 보니 안쪽에 페니 슬리브 끼우고 그 위에 일반 슬리브를 또 씌우는 이중 슬리빙 얘기가 많더라고요.\n\n'
     '한 겹만 씌워도 충분할 것 같은데, 이중까지 하는 게 정말 의미가 있나요?\n'
     '카드를 자주 꺼내 보는 편이면 오히려 넣다 빼다 하면서 더 상하지 않을까 걱정도 됩니다.\n'
     '실제로 이중 슬리빙 하시는 분들 어떤지 궁금해요.',
     4, 41, 2),
    ('a0000001-0000-0000-0000-000000000026', 'free',
     '처음으로 그레이딩 결과 받아봤습니다 (후기)',
     '입문하고 처음으로 카드 한 장 그레이딩 보냈는데 드디어 결과가 왔네요.\n'
     '솔직히 보내기 전엔 등급 잘 나올까 엄청 떨렸는데, 막상 케이스에 담겨서 오니까 기분이 또 새롭습니다.\n\n'
     '센터링이 생각보다 점수에 크게 작용하는 것 같더라고요. 다음엔 보내기 전에 더 꼼꼼히 골라야겠어요.\n'
     '처음이라 과정이 막막했는데 결과지 보면서 하나씩 이해하는 재미가 있네요. 다들 첫 그레이딩 어떠셨나요?',
     6, 35, 2),
]

# 댓글: 글 인덱스 → (작성자 UID, 본문, hours_offset_from_post). 신규 + 기존 닉 혼합.
COMMENTS = {
    0: [  # 이중 슬리빙
        ('a0000001-0000-0000-0000-000000000021',  # collec_kim (기존)
         '고가 카드나 장기 보관용이면 이중 슬리빙이 확실히 안심돼요. 안쪽 페니로 표면 보호하고 바깥 슬리브로 모서리를 받쳐주거든요. 다만 자주 꺼내 보는 카드면 말씀처럼 마찰이 생길 수 있어서, 그런 건 한 겹 + 탑로더 조합이 더 편하더라고요.',
         2),
        ('a0000001-0000-0000-0000-000000000026',  # 첫그레이딩 (신규)
         '저는 보여줄 일 많은 카드는 한 겹, 서랍에 박아두는 건 이중으로 나눠서 해요. 용도별로 다르게 가는 게 답인 듯합니다.',
         3),
    ],
    1: [  # 첫 그레이딩 후기
        ('a0000001-0000-0000-0000-000000000022',  # 각진모서리 (기존)
         '첫 결과 받으면 그 맛에 또 보내게 되더라고요 ㅎㅎ 센터링은 진짜 미리 자로 재보거나 눈으로 좌우 여백 비교만 해도 실패를 많이 줄일 수 있어요. 축하드립니다.',
         2),
        ('a0000001-0000-0000-0000-000000000025',  # sleeve_note (신규)
         '후기 잘 봤습니다. 저도 곧 첫 그레이딩 보낼 예정이라 떨리는데 글 보니까 용기 나네요.',
         4),
    ],
}

def main():
    print("[seed_board_batch7] 시작")
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
    print(f"[seed_board_batch7] 완료: posts={ins_p}, comments={ins_c}")

if __name__ == "__main__":
    main()
