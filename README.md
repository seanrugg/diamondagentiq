# DiamondAgentIQ

Open Agent Hackathon 2026 project: a TypeScript foundation for diamond-intelligence agents over Zetaris, with a pluggable local LLM (Ollama or Meterless Nightshift).

## Prerequisites

- Node 22 (`nvm use` reads `.nvmrc`)
- Docker, with Zetaris already running so the external network `zetaris_default` exists
- Zetaris running locally (UI on port 3000, REST API on 8888)
- Either [Ollama](https://ollama.com) with an OpenAI-compatible `/v1` endpoint, or Meterless Nightshift

## Setup

```bash
nvm use
cp .env.example .env
# fill in ZETARIS_USERNAME and ZETARIS_PASSWORD (login mode),
# or ZETARIS_API_KEY if ZETARIS_AUTH_MODE=apikey.
# Set DIQ_PG_PASSWORD. If using Meterless, also set METERLESS_RUNTIME_TOKEN.
npm install
```

### Data layer

Postgres is published on host port **5433** (container 5432) so it does not collide with a local Postgres on 5432. The container joins `zetaris_default` as hostname `diq-postgres`.

Rule rows in `data/seed.sql` are **drafts** (`verified=false`). Summaries are our own words, not rulebook quotations. Confirm every value against the governing body's current official rules before using it.

```bash
npm run db:up              # start diq-postgres and wait until healthy
npm run zetaris:register   # CREATE DATASOURCE diq_pg (skipped if it exists), then REGISTER tables
npm run check:data         # counts on rules_facts and drills, plus pitch_rest_rules ⋈ house_rules
```

`npm run db:reset` prints a warning, deletes the named volume, and recreates the database from `data/schema.sql` and `data/seed.sql`.

Set `LLM_PROVIDER` to `ollama` or `meterless`. Leave `SAMPLE_MODE=false` unless a later agent pass enables sample data.

### Zetaris auth

The local Zetaris bundle rejects API tokens (`Api token is not allowed`) and accepts a login token from `POST /api/auth/login`. That is why `ZETARIS_AUTH_MODE=login` is the default: the adapter posts username/password to `{ZETARIS_BASE_URL}/api/auth/login`, caches `idToken` in memory, and refreshes it 60 seconds before the JWT `exp`.

Set `ZETARIS_AUTH_MODE=apikey` only when the REST API accepts `ZETARIS_API_KEY` as a bearer token. SQL still goes to `{ZETARIS_REST_URL}/sql-editor/sqls/run` in both modes.

## Checks

```bash
npm run check:zetaris   # SELECT 1 via the Zetaris adapter
npm run check:llm       # model replies "ready", then a run_sql tool-call probe
npm run test:hmem       # vendored Meterless H-MEM reference tests
```

Unit tests (SQL sanitizer and JWT refresh): `npm test`.

## Third-party components

This repo vendors the [Meterless H-MEM](https://github.com/meterless/meterless) reference and conformance suites (`engines/hmem/reference`, `engines/hmem/conformance`) at commit `1742dec56a66e58eef9dda2d2b865823758ca8cd`, licensed Apache-2.0. See `VENDOR.md`.
