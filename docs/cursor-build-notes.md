# Development notes: Cursor-assisted build

We built the early infrastructure for DiamondAgentIQ in Cursor until our Cursor credits ran out. (The organizers had already dropped the Cursor requirement, since no credits were provided to teams.) Cursor delivered five work items. No agents were built in this phase. The work covered the foundation, the integrations and the data layer that later agents depend on.

## 1. Project foundation

- Node 22 + TypeScript scaffold (package, tsconfig, vitest, `.nvmrc`, `.env.example`, folder structure for agents, calculators, schemas, data and web).
- Zod-validated config. Startup errors name the missing or invalid fields but never print secret values.
- SQL adapter that allows one statement per call, strips a trailing semicolon, rejects multiple statements and times out after 60s.
- LLM adapter for Ollama or Meterless through the OpenAI SDK (120s timeout, optional tool use).
- JSONL tracing to `logs/` and stdout.
- Health-check scripts: `check:zetaris` and `check:llm`.

## 2. H-MEM vendoring

- H-MEM and its conformance suite are vendored at pinned commit `1742dec` and documented in `VENDOR.md`.
- The vendored tests pass (10/10).

## 3. Zetaris error reporting

- Failed Zetaris SQL requests throw an error with the HTTP status and the first 300 characters of the response body.

## 4. Zetaris login-token authentication

- The local Zetaris bundle rejects API tokens, so `ZETARIS_AUTH_MODE` now defaults to `login`. `apikey` mode is still supported.
- `getToken()` logs in, caches the JWT and refreshes it 60s before it expires.
- A 401, or a 400 with `"Not Allowed"`, triggers one token refresh and one retry.
- Tokens and passwords are never logged.
- 7 unit tests cover JWT expiry decoding and the refresh logic, with no network calls.

## 5. DiamondAgentIQ data layer

- Postgres 16 (`diq-postgres`) on host port 5433, joined to the `zetaris_default` Docker network so Zetaris can reach it.
- Schema covering:
  - rules facts and pitch-rest rules
  - house rules
  - drills
  - synthetic GameChanger-style game data
  - pitcher appearances
  - a hash-chained, signed ruling log
- Seed data. At the time, every rule value was a draft marked `verified=false`, and every summary was in our own words with no rulebook quotations. (On 25 Oct 2026 our umpire reviewed every rule and coaching row; see the README.)
  - Little League pitch-rest tiers for 10U–14U.
  - A note that USA Softball has no official pitch-count rest chart.
  - Paraphrased call types for obstruction, interference, infield fly, uncaught third strike and softball look-back.
  - A synthetic "Fall Classic 12U" house rule that conflicts with the sanctioning body's rest rule.
  - Eight drills and one synthetic 12U pitcher.
- Scripts: `db:up`, `db:reset`, `zetaris:register` (it traces only the datasource name, never the statement containing the password) and `check:data`.

## Principles applied throughout

- **No secrets in logs or traces:** API keys, tokens and passwords never appear in output.
- **Tested before relying on it:** the vendored H-MEM suite and the new unit tests run without live services.
- **Rule content is draft until verified:** all rule data is labeled for human verification against official sources.
