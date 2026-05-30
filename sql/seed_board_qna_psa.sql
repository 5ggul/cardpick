-- =============================================================
-- 게시판 시드 — 질문글 1개 + 댓글 3개 (사용자 3명)
-- 실행: Supabase Dashboard > SQL Editor > 전체 붙여넣기 → Run
-- 작성: 2026-05-29
-- =============================================================

BEGIN;

-- ==============================
-- 1. 시드용 가짜 사용자 3명 (auth.users)
-- ==============================
-- 고정 UUID 사용 (재실행 시 ON CONFLICT로 중복 방지)
INSERT INTO auth.users (
  id, instance_id, aud, role, email,
  encrypted_password, email_confirmed_at,
  created_at, updated_at, raw_user_meta_data, raw_app_meta_data
)
VALUES
  ('a0000001-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'seed_yj02@cardpick.kr',
   '', now() - interval '30 days', now() - interval '30 days', now(),
   '{"name":"yj_02"}'::jsonb, '{"provider":"seed","providers":["seed"]}'::jsonb),
  ('a0000001-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'seed_pokabox@cardpick.kr',
   '', now() - interval '60 days', now() - interval '60 days', now(),
   '{"name":"포카박스"}'::jsonb, '{"provider":"seed","providers":["seed"]}'::jsonb),
  ('a0000001-0000-0000-0000-000000000003', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'seed_ddung@cardpick.kr',
   '', now() - interval '45 days', now() - interval '45 days', now(),
   '{"name":"ddung"}'::jsonb, '{"provider":"seed","providers":["seed"]}'::jsonb)
ON CONFLICT (id) DO NOTHING;

-- ==============================
-- 2. profiles (닉네임)
-- ==============================
INSERT INTO profiles (id, nickname, display_name, created_at, updated_at)
VALUES
  ('a0000001-0000-0000-0000-000000000001', 'yj_02',    'yj_02',
   now() - interval '30 days', now()),
  ('a0000001-0000-0000-0000-000000000002', '포카박스', '포카박스',
   now() - interval '60 days', now()),
  ('a0000001-0000-0000-0000-000000000003', 'ddung',    'ddung',
   now() - interval '45 days', now())
ON CONFLICT (id) DO UPDATE
  SET nickname = EXCLUDED.nickname,
      display_name = EXCLUDED.display_name,
      updated_at = now();

-- ==============================
-- 3. 글 1개 (yj_02 작성)
-- ==============================
WITH new_post AS (
  INSERT INTO posts (user_id, board, title, body, created_at, updated_at, is_pinned, views, likes, comments_count)
  VALUES (
    'a0000001-0000-0000-0000-000000000001',
    'qna',
    'PSA 처음 보내려는데 비용이 50만원 넘네요;;',
    '카드 10장 보내려는데 그레이딩 + 배송 + 보험 + 한국 대행료 합치니까 50만원 넘어가요. 이게 정상인가요?',
    now() - interval '4 days',
    now() - interval '4 days',
    false, 0, 0, 3
  )
  RETURNING id
)
-- 4. 댓글 3개
INSERT INTO comments (post_id, user_id, body, created_at)
SELECT new_post.id, c.user_id::uuid, c.body, c.created_at
FROM new_post
CROSS JOIN (VALUES
  ('a0000001-0000-0000-0000-000000000002',
   '신고가 따라 달라요. 10장에 50만원이면 일반적인 수준입니다. 카드픽 PSA 손익분기 계산기로 PSA 10 예상가 입력해보면 손해 안 보는지 바로 나옵니다.',
   now() - interval '4 days' + interval '2 hours'),
  ('a0000001-0000-0000-0000-000000000003',
   '처음이면 한국 대행이 안전해요. 5장 이상이면 직발도 검토해볼 만하고요.',
   now() - interval '3 days' + interval '5 hours'),
  ('a0000001-0000-0000-0000-000000000001',
   '감사합니다 계산기 돌려보고 결정할게요!',
   now() - interval '3 days' + interval '8 hours')
) AS c(user_id, body, created_at);

COMMIT;

-- ==============================
-- 검증
-- ==============================
SELECT 'seeded post' AS info, count(*) AS n
FROM posts WHERE user_id = 'a0000001-0000-0000-0000-000000000001';

SELECT 'seeded comments' AS info, count(*) AS n
FROM comments WHERE user_id IN (
  'a0000001-0000-0000-0000-000000000001',
  'a0000001-0000-0000-0000-000000000002',
  'a0000001-0000-0000-0000-000000000003'
);

-- ==============================
-- 롤백 (필요 시)
-- ==============================
-- DELETE FROM comments WHERE user_id IN ('a0000001-0000-0000-0000-000000000001','a0000001-0000-0000-0000-000000000002','a0000001-0000-0000-0000-000000000003');
-- DELETE FROM posts WHERE user_id = 'a0000001-0000-0000-0000-000000000001';
-- DELETE FROM profiles WHERE id IN ('a0000001-0000-0000-0000-000000000001','a0000001-0000-0000-0000-000000000002','a0000001-0000-0000-0000-000000000003');
-- DELETE FROM auth.users WHERE id IN ('a0000001-0000-0000-0000-000000000001','a0000001-0000-0000-0000-000000000002','a0000001-0000-0000-0000-000000000003');
