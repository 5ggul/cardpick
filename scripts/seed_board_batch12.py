#!/usr/bin/env python3
"""게시판 시드 12차: 신규 주제 4개(중복 카드 정리 / 본가 옛날 카드 발견 / 노리던 카드 영입 자랑 / 프로모 카드 구하는 법) + 신규 유저 4명(036~039).
기존 1~11차 주제·닉네임·UID와 중복 없음. 카드+일상 혼합. likes 0, 조회수 현실적(24~47), 댓글 신규+기존(016·021) 혼합. 제목 중복 체크로 멱등.
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

# 신규 4명 (기존 035까지와 안 겹침: 036~039)
USERS = [
    ('a0000001-0000-0000-0000-000000000036', '중복정리',   'seed_dupes@cardpick.kr',     '18 days'),
    ('a0000001-0000-0000-0000-000000000037', '추억소환',   'seed_nostalgia@cardpick.kr', '11 days'),
    ('a0000001-0000-0000-0000-000000000038', '드디어영입', 'seed_grail@cardpick.kr',     '7 days'),
    ('a0000001-0000-0000-0000-000000000039', '프로모궁금', 'seed_promo@cardpick.kr',     '5 days'),
]

# 글 4개: (user_id, board, title, body, hours_ago, views, cc)
POSTS = [
    ('a0000001-0000-0000-0000-000000000036', 'qna',
     '카드 중복되는 거 다들 어떻게 정리하세요?',
     '모으다 보니 같은 카드가 자꾸 중복으로 쌓이네요.\n'
     '팩 까다 보면 어쩔 수 없이 겹치는데, 따로 팔자니 한두 장이라 애매하고 그냥 두자니 자리만 차지하고요.\n\n'
     '다들 중복 카드는 어떻게 처리하세요? 모아뒀다 한 번에 정리하시는지, 아니면 그때그때 교환·판매하시는지 궁금합니다.',
     6, 31, 2),
    ('a0000001-0000-0000-0000-000000000037', 'free',
     '본가 갔다가 초등학교 때 모은 카드 상자 발견했네요',
     '오랜만에 본가 정리하다가 초등학교 때 모은 카드 상자가 나왔어요.\n'
     '그때는 그냥 책상에 막 쌓아두고 손으로 마구 만졌던 터라 상태는 엉망인데, 꺼내보니까 추억이 새록새록하더라고요.\n\n'
     '지금 같으면 슬리브에 곱게 넣었을 텐데 싶어서 좀 아쉽기도 하고요. 다들 어릴 때 모은 카드 아직 가지고 계신가요?',
     22, 44, 2),
    ('a0000001-0000-0000-0000-000000000038', 'free',
     '한참 노리던 카드 드디어 손에 넣었습니다',
     '몇 달 동안 시세만 보면서 타이밍 재던 카드를 드디어 적당한 가격에 데려왔어요.\n'
     '살까 말까 계속 고민하다가 이번엔 놓치면 안 되겠다 싶어서 질렀는데, 받고 나니까 역시 잘했다 싶네요.\n\n'
     '기분 좋아서 자랑 한번 해봅니다. 다들 오래 노리다 영입한 카드 있으신가요?',
     38, 47, 1),
    ('a0000001-0000-0000-0000-000000000039', 'qna',
     '프로모 카드는 대회 안 나가면 못 구하나요?',
     '프로모 카드 중에 디자인 예쁜 게 많던데, 이런 건 보통 어디서 구하는 건가요?\n'
     '대회나 이벤트 한정으로만 풀리는 건지, 아니면 나중에 일반 구매로도 살 수 있는 건지 헷갈리더라고요.\n\n'
     '대회를 안 나가는 입장이라 구할 방법이 있는지 궁금합니다. 경험 있으신 분 조언 부탁드려요.',
     50, 29, 1),
]

# 댓글: 글 인덱스 → (작성자 UID, 본문, hours_offset). 신규 + 기존(016 dh_collect, 021 collec_kim) 혼합.
COMMENTS = {
    0: [  # 중복 정리
        ('a0000001-0000-0000-0000-000000000021',  # collec_kim
         '저는 중복은 따로 한 박스에 모아뒀다가 어느 정도 쌓이면 한 번에 정리해요. 상태 좋은 건 교환용으로 빼두고, 나머지는 묶음으로 넘기는 편입니다. 한두 장씩 팔면 배송비가 더 아까워서요.',
         2),
        ('a0000001-0000-0000-0000-000000000036',  # 중복정리 (작성자)
         '묶음으로 정리하는 게 답이네요. 저도 일단 한 박스에 모아두는 걸로 시작해야겠어요. 감사합니다.',
         4),
    ],
    1: [  # 옛날 카드
        ('a0000001-0000-0000-0000-000000000016',  # dh_collect
         '그 시절엔 다들 그렇게 막 다뤘죠 ㅎㅎ 저도 본가에 한 무더기 있는데 상태는 기대 안 합니다. 그래도 그때 카드 보면 추억이라 못 버리겠더라고요. 상태 괜찮은 것만 골라서 슬리브에 옮겨두시는 거 추천해요.',
         3),
        ('a0000001-0000-0000-0000-000000000037',  # 추억소환 (작성자)
         '맞아요 못 버리겠어요 ㅎㅎ 그래도 괜찮은 것만 골라서 슬리브에 옮겨둬야겠네요. 감사합니다.',
         6),
    ],
    2: [  # 영입 자랑
        ('a0000001-0000-0000-0000-000000000021',  # collec_kim
         '오래 노리다 손에 넣으면 그 맛이 또 다르죠 축하드려요 ㅎㅎ 저도 타이밍 재다가 놓친 적이 많아서, 이번에 지르신 거 잘하신 것 같습니다.',
         8),
    ],
    3: [  # 프로모
        ('a0000001-0000-0000-0000-000000000016',  # dh_collect
         '프로모도 종류가 다양해요. 대회·이벤트 한정도 있지만, 정발 상품에 동봉되거나 나중에 일반 유통되는 것도 있어서 카드마다 달라요. 원하는 프로모 이름으로 검색해서 어느 경로로 풀린 건지 먼저 확인하시는 게 좋습니다.',
         3),
    ],
}

def main():
    print("[seed_board_batch12] 시작")
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
    print(f"[seed_board_batch12] 완료: posts={ins_p}, comments={ins_c}")

if __name__ == "__main__":
    main()
