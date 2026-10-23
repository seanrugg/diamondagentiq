-- Add the lessons, situations and stories tables to an existing diq-postgres volume.
-- Idempotent. A fresh volume gets the same tables from data/schema.sql.
-- Applied by `npm run rules:load`.

CREATE TABLE IF NOT EXISTS coaching_lessons (
  lesson_code TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  principle TEXT NOT NULL,
  life_lesson TEXT NOT NULL,
  for_player TEXT,
  for_coach TEXT,
  for_parent TEXT,
  for_umpire TEXT,
  tags TEXT,
  source_id TEXT NOT NULL REFERENCES rule_sources (source_id),
  verified BOOLEAN NOT NULL DEFAULT FALSE,
  verified_by TEXT,
  verify_note TEXT
);

CREATE TABLE IF NOT EXISTS coaching_situations (
  situation_code TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  topic TEXT NOT NULL,
  bases TEXT,
  outs TEXT,
  pitch_count_state TEXT,
  rule_fact_codes TEXT,
  offense TEXT NOT NULL,
  defense TEXT NOT NULL,
  common_mistakes TEXT,
  lesson_codes TEXT,
  source_id TEXT NOT NULL REFERENCES rule_sources (source_id),
  verified BOOLEAN NOT NULL DEFAULT FALSE,
  verified_by TEXT,
  verify_note TEXT
);

CREATE TABLE IF NOT EXISTS coaching_stories (
  story_code TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  story TEXT NOT NULL,
  lesson_codes TEXT,
  situation_codes TEXT,
  source_id TEXT NOT NULL REFERENCES rule_sources (source_id),
  verified BOOLEAN NOT NULL DEFAULT FALSE,
  verified_by TEXT,
  verify_note TEXT
);
