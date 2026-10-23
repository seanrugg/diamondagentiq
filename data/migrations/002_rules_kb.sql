-- Upgrade an existing diq-postgres volume to the rules knowledge-base schema.
-- Idempotent: safe to run more than once. A fresh volume gets the same shape
-- from data/schema.sql, so this is only needed for databases created earlier.
-- Applied by `npm run rules:load` inside the same transaction as the data.

CREATE TABLE IF NOT EXISTS rule_sources (
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

ALTER TABLE rules_facts ADD COLUMN IF NOT EXISTS fact_code TEXT;
ALTER TABLE rules_facts ADD COLUMN IF NOT EXISTS source_id TEXT;
ALTER TABLE rules_facts ADD COLUMN IF NOT EXISTS division TEXT;
ALTER TABLE rules_facts ADD COLUMN IF NOT EXISTS rule_ref TEXT;
ALTER TABLE rules_facts ADD COLUMN IF NOT EXISTS call_type TEXT;
ALTER TABLE rules_facts ADD COLUMN IF NOT EXISTS verified_by TEXT;
ALTER TABLE rules_facts ADD COLUMN IF NOT EXISTS retrieved_on DATE;
ALTER TABLE rules_facts ADD COLUMN IF NOT EXISTS verify_note TEXT;

ALTER TABLE rules_facts DROP CONSTRAINT IF EXISTS rules_facts_sport_check;
ALTER TABLE rules_facts ADD CONSTRAINT rules_facts_sport_check
  CHECK (sport IN ('baseball', 'softball', 'both'));

ALTER TABLE rules_facts DROP CONSTRAINT IF EXISTS rules_facts_call_type_check;
ALTER TABLE rules_facts ADD CONSTRAINT rules_facts_call_type_check
  CHECK (call_type IN ('rule', 'judgment', 'mixed'));

ALTER TABLE rules_facts DROP CONSTRAINT IF EXISTS rules_facts_fact_code_key;
ALTER TABLE rules_facts ADD CONSTRAINT rules_facts_fact_code_key UNIQUE (fact_code);

ALTER TABLE rules_facts DROP CONSTRAINT IF EXISTS rules_facts_source_id_fkey;
ALTER TABLE rules_facts ADD CONSTRAINT rules_facts_source_id_fkey
  FOREIGN KEY (source_id) REFERENCES rule_sources (source_id);

ALTER TABLE pitch_rest_rules ADD COLUMN IF NOT EXISTS source_id TEXT;
ALTER TABLE pitch_rest_rules DROP CONSTRAINT IF EXISTS pitch_rest_rules_source_id_fkey;
ALTER TABLE pitch_rest_rules ADD CONSTRAINT pitch_rest_rules_source_id_fkey
  FOREIGN KEY (source_id) REFERENCES rule_sources (source_id);
