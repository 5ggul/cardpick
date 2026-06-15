#!/usr/bin/env python3
"""게시판 시드 10차 — 신규 주제 2개 (PSA 예상등급 추정기 써본 후기 / 가품 의심돼서 체크해본 경험) + 신규 유저 2명(031~032).
기존 1~9차 주제와 안 겹침. 유저 ID·닉네임 모두 기존(~030)과 중복 없음. 댓글은 신규 + 기존 닉 혼합.
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

# 신규 2명 (기존 030까지와 안 겹침: 031~032)
USERS = [
    ('a0000001-0000-0000-0000-000000000031', '등급궁금',     'seed_gradecurious@cardpick.kr', '24 days'),
    ('a0000001-0000-0000-0000-000000000032', '의심많은편',   'seed_suspicious@cardpick.kr',   '16 days'),
]

# 글 2개: (user_id, board, title, body, hours_ago, views, cc)
POSTS = [
    ('a0000001-0000-0000-0000-000000000031', 'qna',
     '그레이딩 보내기 전에 예상 등급 미리 가늠해보는 분 계신가요',
     '아끼는 카드를 PSA 보낼지 고민 중인데, 비용도 있고 해서 보내기 전에 등급이 대충 어느 정도 나올지 미리 알고 싶더라고요.\n'
     '센터링은 그럭저럭인데 모서리 한 곳이 살짝 무딘 느낌이라 10은 어렵고 9 정도려나 싶기도 하고요.\n\n'
     '다들 보내기 전에 어떻게 가늠하세요? 그냥 감으로 보내시는지, 아니면 따로 점검하시는지 궁금합니다.',
     4, 46, 2),
    ('a0000001-0000-0000-0000-000000000032', 'free',
     '중고로 산 카드 가품 의심돼서 한참 들여다본 썰',
     '저번에 시세보다 조금 싸게 올라온 카드를 덥석 샀는데, 받고 나서 왠지 인쇄가 좀 흐릿한 느낌이라 계속 신경 쓰이더라고요.\n'
     '확대해서 보고, 어두운 데서 빛도 비춰보고 한참을 들여다봤네요.\n\n'
     '결국 정품으로 결론 내긴 했는데, 싸다고 덥석 사면 안 되겠다 싶었어요. 다들 의심될 때 어떤 거부터 확인하세요?',
     7, 38, 2),
]

# 댓글: 글 인덱스 → (작성자 UID, 본문, hours_offset_from_post). 신규 + 기존 닉 혼합.
COMMENTS = {
    0: [  # 그레이딩 예상등급
        ('a0000001-0000-0000-0000-000000000021',  # collec_kim (기존)
         '저는 보내기 전에 센터링·모서리·표면 네 군데를 따로 보고 가장 약한 쪽으로 등급을 잡아요. 한 곳이라도 무디면 10은 잘 안 나오더라고요. 비용 생각하면 9도 이득인 카드인지 시세부터 보고 정하는 편입니다.',
         2),
        ('a0000001-0000-0000-0000-000000000031',  # 등급궁금 (작성자)
         '아 가장 약한 쪽으로 잡는다는 게 와닿네요. 모서리가 걸리면 그쪽 기준으로 보수적으로 생각해야겠어요. 감사합니다.',
         3),
    ],
    1: [  # 가품 의심 썰
        ('a0000001-0000-0000-0000-000000000016',  # dh_collect (기존)
         '저는 의심되면 제일 먼저 빛 비춰보고, 그다음 확대해서 인쇄 점 패턴 봐요. 정품 한 장 옆에 두고 같은 부분 비교하는 게 제일 확실하더라고요. 싸게 나온 매물은 일단 한 번 더 의심하는 게 맞는 것 같습니다.',
         2),
        ('a0000001-0000-0000-0000-000000000032',  # 의심많은편 (작성자)
         '정품 옆에 두고 비교가 답이네요. 다음부턴 한 장 기준으로 두고 봐야겠어요.',
         4),
    ],
}

def main():
    print("[seed_board_batch10] 시작")
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
    print(f"[seed_board_batch10] 완료: posts={ins_p}, comments={ins_c}")

if __name__ == "__main__":
    main()
