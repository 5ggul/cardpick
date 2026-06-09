#!/usr/bin/env python3
"""게시판 특정 시드 댓글 1건 삭제 + 해당 글 comments_count 재계산.
사용자 요청으로 batch6 '동네 카드샵' 글의 카드덕후(008) 댓글 제거.
정확한 (user_id, body) 일치 1건만 삭제 — 안전 범위.
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

UID = 'a0000001-0000-0000-0000-000000000008'
BODY = '오프라인 샵에서 옛날 카드 건지는 맛이 진짜죠. 가끔 시세보다 싸게 나와 있는 것도 있어서 종종 둘러봅니다. 어떤 카드 건지셨는지 궁금하네요.'

def main():
    conn = psycopg2.connect(**PG); conn.autocommit = False
    cur = conn.cursor()
    cur.execute("SELECT id, post_id FROM comments WHERE user_id=%s AND body=%s", (UID, BODY))
    rows = cur.fetchall()
    print(f"[board_delete_comment] 일치 댓글: {len(rows)}건")
    post_ids = set()
    for cid, pid in rows:
        cur.execute("DELETE FROM comments WHERE id=%s", (cid,))
        post_ids.add(pid)
    for pid in post_ids:
        cur.execute("UPDATE posts SET comments_count=(SELECT count(*) FROM comments WHERE post_id=%s) WHERE id=%s", (pid, pid))
    conn.commit(); cur.close(); conn.close()
    print(f"[board_delete_comment] 삭제 {len(rows)}건, 글 {len(post_ids)}개 카운트 갱신")

if __name__ == "__main__":
    main()
