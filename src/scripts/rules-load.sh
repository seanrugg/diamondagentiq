#!/usr/bin/env bash
# npm run rules:load
# Rebuilds data/rules.sql from the CSVs, upgrades the schema if needed, and
# replaces rule_sources, rules_facts and pitch_rest_rules in one transaction.
# Other tables (house rules, drills, games, ruling log) are left untouched.
# Admin script: agents never touch Postgres directly; they read via Zetaris.
set -euo pipefail

if ! docker inspect -f '{{.State.Running}}' diq-postgres 2>/dev/null | grep -q true; then
  echo "diq-postgres is not running. Start it with: npm run db:up" >&2
  exit 1
fi

npx tsx src/scripts/build-rules-sql.ts

{
  cat data/migrations/002_rules_kb.sql
  echo "DELETE FROM rules_facts;"
  echo "DELETE FROM pitch_rest_rules;"
  echo "DELETE FROM rule_sources;"
  cat data/rules.sql
} | docker exec -i diq-postgres psql -q -v ON_ERROR_STOP=1 --single-transaction -U diq -d diamondagentiq

docker exec diq-postgres psql -At -U diq -d diamondagentiq -c \
  "SELECT 'rule_sources ' || count(*) FROM rule_sources UNION ALL SELECT 'rules_facts ' || count(*) FROM rules_facts UNION ALL SELECT 'pitch_rest_rules ' || count(*) FROM pitch_rest_rules"
