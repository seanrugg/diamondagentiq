-- Add the coaching insights table to an existing diq-postgres volume.
-- Idempotent. A fresh volume gets the same table from data/schema.sql.
-- Applied by `npm run rules:load`.

CREATE TABLE IF NOT EXISTS coaching_insights (
  insight_code TEXT PRIMARY KEY,
  topic TEXT NOT NULL,
  sport TEXT NOT NULL CHECK (sport IN ('baseball', 'softball', 'both')),
  age_min INTEGER,
  age_max INTEGER,
  audience TEXT NOT NULL CHECK (audience IN ('all', 'player', 'parent', 'coach', 'umpire')),
  situation TEXT NOT NULL,
  insight TEXT NOT NULL,
  why TEXT,
  try_this TEXT,
  source_id TEXT NOT NULL REFERENCES rule_sources (source_id),
  verified BOOLEAN NOT NULL DEFAULT FALSE,
  verified_by TEXT,
  verify_note TEXT
);
