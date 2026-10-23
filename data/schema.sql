-- DiamondAgentIQ schema. Rule summaries in this database are our own words,
-- never copied rulebook text. Seeded rule values are drafts to verify.

-- One row per source document or page the facts are drawn from.
CREATE TABLE rule_sources (
  source_id TEXT PRIMARY KEY,
  sanction TEXT NOT NULL,
  sport TEXT NOT NULL,
  title TEXT NOT NULL,
  url TEXT NOT NULL,
  edition TEXT,
  access TEXT,
  use_note TEXT,
  retrieved_on DATE
);

CREATE TABLE rules_facts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  fact_code TEXT UNIQUE,
  source_id TEXT REFERENCES rule_sources (source_id),
  sport TEXT NOT NULL CONSTRAINT rules_facts_sport_check CHECK (sport IN ('baseball', 'softball', 'both')),
  division TEXT,
  sanction TEXT NOT NULL,
  age_min INTEGER,
  age_max INTEGER,
  edition TEXT,
  topic TEXT NOT NULL,
  fact_key TEXT NOT NULL,
  fact_value TEXT,
  unit TEXT,
  rule_ref TEXT,
  call_type TEXT CHECK (call_type IN ('rule', 'judgment', 'mixed')),
  summary TEXT NOT NULL,
  source_url TEXT,
  verified BOOLEAN NOT NULL DEFAULT FALSE,
  verified_by TEXT,
  retrieved_on DATE,
  verify_note TEXT,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE pitch_rest_rules (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  sanction TEXT NOT NULL,
  sport TEXT NOT NULL CHECK (sport IN ('baseball', 'softball')),
  age_min INTEGER NOT NULL,
  age_max INTEGER NOT NULL,
  pitches_min INTEGER NOT NULL,
  pitches_max INTEGER NOT NULL,
  rest_days INTEGER NOT NULL,
  edition TEXT,
  source_url TEXT,
  verified BOOLEAN NOT NULL DEFAULT FALSE,
  source_id TEXT REFERENCES rule_sources (source_id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE house_rules (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_name TEXT NOT NULL,
  sanction TEXT,
  sport TEXT CHECK (sport IN ('baseball', 'softball')),
  age_group TEXT,
  topic TEXT NOT NULL,
  rule_text TEXT NOT NULL,
  source_file TEXT,
  section TEXT,
  overrides_fact_key TEXT,
  synthetic BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE drills (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  skill TEXT NOT NULL,
  title TEXT NOT NULL,
  description TEXT NOT NULL,
  age_min INTEGER,
  age_max INTEGER,
  setting TEXT NOT NULL CHECK (setting IN ('individual', 'team', 'home')),
  equipment TEXT,
  safety_notes TEXT,
  reviewed BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE games (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  home_team TEXT NOT NULL,
  away_team TEXT NOT NULL,
  game_date DATE NOT NULL,
  venue TEXT,
  age_group TEXT,
  sanction TEXT,
  sport TEXT CHECK (sport IN ('baseball', 'softball')),
  synthetic BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE box_scores (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  game_id UUID NOT NULL REFERENCES games (id) ON DELETE CASCADE,
  team TEXT NOT NULL,
  player_name TEXT NOT NULL,
  inning INTEGER,
  batting_order INTEGER,
  pa INTEGER,
  ab INTEGER,
  h INTEGER,
  r INTEGER,
  rbi INTEGER,
  k INTEGER,
  bb INTEGER,
  pitches INTEGER,
  innings_pitched NUMERIC(4, 1),
  synthetic BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE play_by_play (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  game_id UUID NOT NULL REFERENCES games (id) ON DELETE CASCADE,
  inning INTEGER NOT NULL,
  half TEXT NOT NULL CHECK (half IN ('top', 'bottom')),
  batter TEXT,
  pitcher TEXT,
  pitch_count INTEGER,
  event TEXT,
  result TEXT,
  description TEXT,
  synthetic BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE pitcher_appearances (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  game_id UUID NOT NULL REFERENCES games (id) ON DELETE CASCADE,
  pitcher_name TEXT NOT NULL,
  team TEXT NOT NULL,
  pitches INTEGER NOT NULL,
  game_date DATE NOT NULL,
  synthetic BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE ruling_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  question TEXT NOT NULL,
  role TEXT,
  call_type TEXT,
  answer_json JSONB,
  prev_hash TEXT,
  hash TEXT,
  signature TEXT,
  public_key_id TEXT
);
