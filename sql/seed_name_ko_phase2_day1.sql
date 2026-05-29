-- =============================================================
-- Phase 2 Day 1 — cards.name_ko 상위 20종 한국어 별칭 매핑
-- 실행: Supabase SQL Editor (Dashboard > SQL Editor > 새 query)
-- 작성: 2026-05-29
-- =============================================================
--
-- 적용 범위:
--   base form + 표준 접미사 (ex, V, VMAX, VSTAR, GX, EX)
--   변형 카드 제외 (Mega/Alolan/Galarian/Hisuian/Paldean/Mr./& 합체)
--
-- 안전:
--   - 백업 테이블 자동 생성 (롤백 가능)
--   - name_ko IS NULL 인 행만 UPDATE (기존 매핑 보존)
--   - regex로 변형 카드 제외 (^name($|\s+suffix$) 패턴)
--
-- 롤백:
--   UPDATE cards c SET name_ko = b.name_ko
--   FROM _backup_name_ko_20260529 b
--   WHERE c.slug = b.slug;
-- =============================================================


-- ==============================
-- STEP 1: 백업 테이블 생성
-- ==============================
CREATE TABLE IF NOT EXISTS _backup_name_ko_20260529 AS
  SELECT slug, name, name_ko FROM cards WHERE game='pokemon';

SELECT count(*) AS backup_row_count FROM _backup_name_ko_20260529;
-- 기대: 25,549 (현재 포켓몬 카드 총 수)


-- ==============================
-- STEP 2: Preview (영향 카드 수 미리 확인)
-- ==============================
SELECT
  CASE
    WHEN name ~ '^Charizard($|\s+(ex|V|VMAX|VSTAR|GX|EX)$)' THEN '리자몽 그룹'
    WHEN name ~ '^Pikachu($|\s+(ex|V|VMAX|VSTAR|GX|EX)$)'   THEN '피카츄 그룹'
    WHEN name ~ '^Mewtwo($|\s+(ex|V|VMAX|VSTAR|GX|EX)$)'    THEN '뮤츠 그룹'
    WHEN name ~ '^Mew($|\s+(ex|V|VMAX|VSTAR|GX|EX)$)'       THEN '뮤 그룹'
    WHEN name ~ '^Umbreon($|\s+(ex|V|VMAX|VSTAR|GX|EX)$)'   THEN '블래키 그룹'
    WHEN name ~ '^Eevee($|\s+(ex|V|VMAX|VSTAR|GX|EX)$)'     THEN '이브이 그룹'
    WHEN name ~ '^Sylveon($|\s+(ex|V|VMAX|VSTAR|GX|EX)$)'   THEN '님피아 그룹'
    WHEN name ~ '^Espeon($|\s+(ex|V|VMAX|VSTAR|GX|EX)$)'    THEN '에브이 그룹'
    WHEN name ~ '^Greninja($|\s+(ex|V|VMAX|VSTAR|GX|EX)$)'  THEN '개굴닌자 그룹'
    WHEN name ~ '^Charmander($|\s+(ex|V|VMAX|VSTAR|GX|EX)$)' THEN '파이리 그룹'
    WHEN name ~ '^Squirtle($|\s+(ex|V|VMAX|VSTAR|GX|EX)$)'  THEN '꼬부기 그룹'
    WHEN name ~ '^Bulbasaur($|\s+(ex|V|VMAX|VSTAR|GX|EX)$)' THEN '이상해씨 그룹'
    WHEN name ~ '^Lugia($|\s+(ex|V|VMAX|VSTAR|GX|EX)$)'     THEN '루기아 그룹'
    WHEN name ~ '^Rayquaza($|\s+(ex|V|VMAX|VSTAR|GX|EX)$)'  THEN '레쿠쟈 그룹'
    WHEN name ~ '^Garchomp($|\s+(ex|V|VMAX|VSTAR|GX|EX)$)'  THEN '한카리아스 그룹'
    WHEN name ~ '^Lucario($|\s+(ex|V|VMAX|VSTAR|GX|EX)$)'   THEN '루카리오 그룹'
    WHEN name ~ '^Zoroark($|\s+(ex|V|VMAX|VSTAR|GX|EX)$)'   THEN '조로아크 그룹'
    WHEN name ~ '^Tyranitar($|\s+(ex|V|VMAX|VSTAR|GX|EX)$)' THEN '마기라스 그룹'
    WHEN name ~ '^Gengar($|\s+(ex|V|VMAX|VSTAR|GX|EX)$)'    THEN '겐가 그룹'
    WHEN name ~ '^Snorlax($|\s+(ex|V|VMAX|VSTAR|GX|EX)$)'   THEN '잠만보 그룹'
  END AS ko_group,
  count(*) AS card_count
FROM cards
WHERE game='pokemon'
  AND name_ko IS NULL
  AND (
    name ~ '^(Charizard|Pikachu|Mewtwo|Mew|Umbreon|Eevee|Sylveon|Espeon|Greninja|Charmander|Squirtle|Bulbasaur|Lugia|Rayquaza|Garchomp|Lucario|Zoroark|Tyranitar|Gengar|Snorlax)($|\s+(ex|V|VMAX|VSTAR|GX|EX)$)'
  )
GROUP BY ko_group
ORDER BY card_count DESC;


-- ==============================
-- STEP 3: 실제 UPDATE 실행
-- ==============================

-- 리자몽 그룹
UPDATE cards SET name_ko =
  REGEXP_REPLACE(name, '^Charizard', '리자몽')
WHERE game='pokemon' AND name_ko IS NULL
  AND name ~ '^Charizard($|\s+(ex|V|VMAX|VSTAR|GX|EX)$)';

-- 피카츄 그룹
UPDATE cards SET name_ko =
  REGEXP_REPLACE(name, '^Pikachu', '피카츄')
WHERE game='pokemon' AND name_ko IS NULL
  AND name ~ '^Pikachu($|\s+(ex|V|VMAX|VSTAR|GX|EX)$)';

-- 뮤츠 그룹
UPDATE cards SET name_ko =
  REGEXP_REPLACE(name, '^Mewtwo', '뮤츠')
WHERE game='pokemon' AND name_ko IS NULL
  AND name ~ '^Mewtwo($|\s+(ex|V|VMAX|VSTAR|GX|EX)$)';

-- 뮤 그룹
UPDATE cards SET name_ko =
  REGEXP_REPLACE(name, '^Mew', '뮤')
WHERE game='pokemon' AND name_ko IS NULL
  AND name ~ '^Mew($|\s+(ex|V|VMAX|VSTAR|GX|EX)$)';

-- 블래키 그룹
UPDATE cards SET name_ko =
  REGEXP_REPLACE(name, '^Umbreon', '블래키')
WHERE game='pokemon' AND name_ko IS NULL
  AND name ~ '^Umbreon($|\s+(ex|V|VMAX|VSTAR|GX|EX)$)';

-- 이브이 그룹
UPDATE cards SET name_ko =
  REGEXP_REPLACE(name, '^Eevee', '이브이')
WHERE game='pokemon' AND name_ko IS NULL
  AND name ~ '^Eevee($|\s+(ex|V|VMAX|VSTAR|GX|EX)$)';

-- 님피아 그룹
UPDATE cards SET name_ko =
  REGEXP_REPLACE(name, '^Sylveon', '님피아')
WHERE game='pokemon' AND name_ko IS NULL
  AND name ~ '^Sylveon($|\s+(ex|V|VMAX|VSTAR|GX|EX)$)';

-- 에브이 그룹
UPDATE cards SET name_ko =
  REGEXP_REPLACE(name, '^Espeon', '에브이')
WHERE game='pokemon' AND name_ko IS NULL
  AND name ~ '^Espeon($|\s+(ex|V|VMAX|VSTAR|GX|EX)$)';

-- 개굴닌자 그룹
UPDATE cards SET name_ko =
  REGEXP_REPLACE(name, '^Greninja', '개굴닌자')
WHERE game='pokemon' AND name_ko IS NULL
  AND name ~ '^Greninja($|\s+(ex|V|VMAX|VSTAR|GX|EX)$)';

-- 파이리 그룹
UPDATE cards SET name_ko =
  REGEXP_REPLACE(name, '^Charmander', '파이리')
WHERE game='pokemon' AND name_ko IS NULL
  AND name ~ '^Charmander($|\s+(ex|V|VMAX|VSTAR|GX|EX)$)';

-- 꼬부기 그룹
UPDATE cards SET name_ko =
  REGEXP_REPLACE(name, '^Squirtle', '꼬부기')
WHERE game='pokemon' AND name_ko IS NULL
  AND name ~ '^Squirtle($|\s+(ex|V|VMAX|VSTAR|GX|EX)$)';

-- 이상해씨 그룹
UPDATE cards SET name_ko =
  REGEXP_REPLACE(name, '^Bulbasaur', '이상해씨')
WHERE game='pokemon' AND name_ko IS NULL
  AND name ~ '^Bulbasaur($|\s+(ex|V|VMAX|VSTAR|GX|EX)$)';

-- 루기아 그룹
UPDATE cards SET name_ko =
  REGEXP_REPLACE(name, '^Lugia', '루기아')
WHERE game='pokemon' AND name_ko IS NULL
  AND name ~ '^Lugia($|\s+(ex|V|VMAX|VSTAR|GX|EX)$)';

-- 레쿠쟈 그룹
UPDATE cards SET name_ko =
  REGEXP_REPLACE(name, '^Rayquaza', '레쿠쟈')
WHERE game='pokemon' AND name_ko IS NULL
  AND name ~ '^Rayquaza($|\s+(ex|V|VMAX|VSTAR|GX|EX)$)';

-- 한카리아스 그룹
UPDATE cards SET name_ko =
  REGEXP_REPLACE(name, '^Garchomp', '한카리아스')
WHERE game='pokemon' AND name_ko IS NULL
  AND name ~ '^Garchomp($|\s+(ex|V|VMAX|VSTAR|GX|EX)$)';

-- 루카리오 그룹
UPDATE cards SET name_ko =
  REGEXP_REPLACE(name, '^Lucario', '루카리오')
WHERE game='pokemon' AND name_ko IS NULL
  AND name ~ '^Lucario($|\s+(ex|V|VMAX|VSTAR|GX|EX)$)';

-- 조로아크 그룹
UPDATE cards SET name_ko =
  REGEXP_REPLACE(name, '^Zoroark', '조로아크')
WHERE game='pokemon' AND name_ko IS NULL
  AND name ~ '^Zoroark($|\s+(ex|V|VMAX|VSTAR|GX|EX)$)';

-- 마기라스 그룹
UPDATE cards SET name_ko =
  REGEXP_REPLACE(name, '^Tyranitar', '마기라스')
WHERE game='pokemon' AND name_ko IS NULL
  AND name ~ '^Tyranitar($|\s+(ex|V|VMAX|VSTAR|GX|EX)$)';

-- 겐가 그룹
UPDATE cards SET name_ko =
  REGEXP_REPLACE(name, '^Gengar', '겐가')
WHERE game='pokemon' AND name_ko IS NULL
  AND name ~ '^Gengar($|\s+(ex|V|VMAX|VSTAR|GX|EX)$)';

-- 잠만보 그룹
UPDATE cards SET name_ko =
  REGEXP_REPLACE(name, '^Snorlax', '잠만보')
WHERE game='pokemon' AND name_ko IS NULL
  AND name ~ '^Snorlax($|\s+(ex|V|VMAX|VSTAR|GX|EX)$)';


-- ==============================
-- STEP 4: 적용 결과 확인
-- ==============================
-- (A) 이번 실행으로 새로 매핑된 카드 수 (백업 기준, 가장 정확)
SELECT count(*) AS newly_mapped
FROM cards c
JOIN _backup_name_ko_20260529 b ON b.slug = c.slug
WHERE c.game='pokemon'
  AND b.name_ko IS NULL
  AND c.name_ko IS NOT NULL;

-- (B) 전체 누적 매핑 카드 수 (이번 실행 + 이전 매핑)
SELECT count(*) AS mapped_total
FROM cards
WHERE game='pokemon' AND name_ko IS NOT NULL;

-- (C) 그룹별 매핑 카드 수
SELECT name_ko, count(*) AS card_count
FROM cards
WHERE game='pokemon' AND name_ko IS NOT NULL
GROUP BY name_ko
ORDER BY card_count DESC, name_ko;

-- 샘플 5장 (라이브 확인용)
SELECT slug, name, name_ko, set_name, number
FROM cards
WHERE game='pokemon' AND name_ko IS NOT NULL
ORDER BY name
LIMIT 10;


-- ==============================
-- 변형 카드 확인 (자동 매핑 제외 — 수동 검수 필요)
-- ==============================
SELECT name, count(*) AS card_count
FROM cards
WHERE game='pokemon' AND name_ko IS NULL
  AND (
    name ~ '^(Mega|Alolan|Galarian|Hisuian|Paldean) (Charizard|Pikachu|Mewtwo|Umbreon|Eevee|Sylveon|Espeon|Greninja|Lucario|Gengar|Snorlax)'
    OR name LIKE '%''s %'  -- "Sabrina's Gengar" 같은 트레이너 소유
    OR name LIKE '% & %'   -- 합체 카드
    OR name LIKE 'Radiant %'
  )
GROUP BY name
ORDER BY card_count DESC
LIMIT 30;


-- =============================================================
-- 롤백 (필요 시)
-- =============================================================
-- UPDATE cards c SET name_ko = b.name_ko
-- FROM _backup_name_ko_20260529 b
-- WHERE c.slug = b.slug AND c.game='pokemon';
