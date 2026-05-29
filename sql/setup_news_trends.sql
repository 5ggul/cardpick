-- =============================================================
-- Phase 1 + 2: 뉴스 + 트렌드 인프라
-- 실행: Supabase Dashboard > SQL Editor > 전체 붙여넣기 → Run
-- 작성: 2026-05-29
-- =============================================================

-- ==============================
-- Phase 1: drop_events 테이블 (PokéBeach RSS 등 뉴스/응모/발매)
-- ==============================
CREATE TABLE IF NOT EXISTS drop_events (
  id BIGSERIAL PRIMARY KEY,
  source_id TEXT UNIQUE NOT NULL,     -- 출처 unique ID (RSS guid 또는 link hash)
  source_name TEXT NOT NULL,          -- 'pokebeach', 'manual', etc
  title TEXT NOT NULL,
  title_ko TEXT,                       -- 운영자가 나중에 한국어 보강 가능 (현재는 NULL OK)
  summary TEXT,                        -- 원문 summary (1~2 문장)
  source_url TEXT NOT NULL,            -- 원문 링크
  image_url TEXT,                      -- 외부 이미지 (자체 호스팅 X)
  category TEXT NOT NULL DEFAULT 'news', -- news / release / lottery / event / promo
  tags TEXT[],                         -- ['new_set', 'promo', 'event', 'japan', 'english']
  country TEXT,                        -- 'GLOBAL' / 'KR' / 'JP' / 'US'
  published_at TIMESTAMPTZ NOT NULL,
  fetched_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  status TEXT NOT NULL DEFAULT 'active', -- active / hidden / archived
  needs_review BOOLEAN DEFAULT false
);

CREATE INDEX IF NOT EXISTS idx_drop_events_published_at ON drop_events(published_at DESC);
CREATE INDEX IF NOT EXISTS idx_drop_events_status ON drop_events(status) WHERE status = 'active';
CREATE INDEX IF NOT EXISTS idx_drop_events_category ON drop_events(category);


-- ==============================
-- Phase 2: search_trends 테이블 (네이버 데이터랩 트렌드)
-- ==============================
CREATE TABLE IF NOT EXISTS search_trends (
  id BIGSERIAL PRIMARY KEY,
  keyword TEXT NOT NULL,
  date DATE NOT NULL,              -- 트렌드 기준일
  ratio NUMERIC(8,2),              -- 네이버 데이터랩 ratio (0~100)
  rank INT,                        -- 그 날짜의 순위
  period_days INT NOT NULL DEFAULT 7, -- 집계 기간 (7/30일)
  fetched_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(keyword, date, period_days)
);

CREATE INDEX IF NOT EXISTS idx_search_trends_date ON search_trends(date DESC);
CREATE INDEX IF NOT EXISTS idx_search_trends_keyword ON search_trends(keyword);


-- ==============================
-- RLS 정책 (공개 읽기)
-- ==============================
ALTER TABLE drop_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE search_trends ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "public_read_drop_events" ON drop_events;
CREATE POLICY "public_read_drop_events" ON drop_events
  FOR SELECT USING (status = 'active');

DROP POLICY IF EXISTS "public_read_search_trends" ON search_trends;
CREATE POLICY "public_read_search_trends" ON search_trends
  FOR SELECT USING (true);


-- ==============================
-- 검증
-- ==============================
SELECT 'drop_events created' AS status, count(*) AS row_count FROM drop_events;
SELECT 'search_trends created' AS status, count(*) AS row_count FROM search_trends;

-- PostgREST schema reload (API 즉시 노출)
NOTIFY pgrst, 'reload schema';
