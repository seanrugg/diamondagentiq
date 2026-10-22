# AGENTS.md — DiamondAgentIQ

Instructions for any coding agent working in this repo (Cursor Agent, Claude Code, or others). Read this file fully before making changes.

## What this project is

DiamondAgentIQ is a team of AI agents that helps parents, coaches and umpires understand baseball and softball rulings. It separates umpire **judgment** from **rule application**, cites the applicable rules (sport, sanction, age group, house/tournament rules), and turns each situation into a **teachable moment** with an **improvement plan**. A post-game mode reviews a box score and play-by-play and suggests practice priorities.

Built for the Open Agent Hackathon 2026. The sponsor integrations described below are required. Don't remove or bypass them.

## Stack

- Node 22 (`.nvmrc`) + TypeScript (ESM, strict), run with `tsx`
- `openai` SDK behind one `generator` (`src/adapters/llm.ts`)
- `zod` for config, request/response and agent-output validation
- `vitest` for tests
- Postgres 16 in `docker-compose.yml` (`diq-postgres`, host port **5433**)
- Zetaris (local Docker bundle, separate folder) as the data access layer
- Meterless H-MEM reference implementation, vendored in `vendor/hmem` (pinned commit, Apache-2.0)

## Commands

```bash
nvm use
npm install
npm test                 # unit tests (no network)
npm run test:hmem        # vendored H-MEM conformance tests
npm run db:up            # start diq-postgres
npm run zetaris:register # register diq_pg in Zetaris (idempotent)
npm run check:zetaris    # SELECT 1 through Zetaris
npm run check:data       # counts + a join through Zetaris
npm run check:llm        # model reply + tool-call test via the configured provider
```

Run `npm test` after every change. Run the relevant `check:*` script after touching an adapter.

## Architecture (follow it)

```
src/
  config.ts            zod-validated env; never print secret values
  trace.ts             JSONL traces -> logs/ and stdout
  adapters/
    llm.ts             generator(): providers "meterless" (Nightshift) | "ollama"
    zetaris.ts         runSql(): one statement per call, login-token auth
    zetaris-token.ts   JWT exp decoding + refresh logic
    dataTools.ts       read-only run_sql tool for agents (allowlisted tables)
  agents/              one file per agent
  calculators/         deterministic rule math (pitch rest, game stats)
  schemas/             zod schemas for request/response contracts
  orchestrator.ts      runs the agent team; owns the critique/retry loop
vendor/hmem/           Meterless H-MEM reference — DO NOT EDIT
```

Agents (planned): ContextAgent, CallTypeAgent, RulesAgent, CriticAgent, CoachingAgent, DevelopmentAgent, GameReviewAgent.

Model routing (pin by model ID, through Meterless Nightshift):
- Context, Rules, Coaching, GameReview → `nvidia/nemotron-3.5-super-vl-120b-a12b`
- CallType, Critic, Development → `nvidia/nemotron-3.5-lightning-30b-a3b`

## Hard rules

1. **No secrets in code, logs, traces, tests, commits or output.** Read them from `.env` through `src/config.ts`. Never print `.env` values. `.env` is gitignored; only `.env.example` (placeholders) is committed.
2. **All model calls go through `generator()`.** Never instantiate an SDK client elsewhere. Never hardcode a model or endpoint.
3. **All data comes through Zetaris** (`runSql` / `dataTools`). Agents never connect to Postgres directly. One SQL statement per call. The agent SQL tool is read-only (SELECT only) and allowlisted.
4. **Deterministic math is done in code, never by the model** (pitch-count rest days, stat totals). The model decides *what* to compute; calculators compute it.
5. **No hardcoded or replayed outputs.** Never map known inputs to saved answers. `output_examples/` is written by runs, never read by the app. Sample mode runs real logic on bundled data.
6. **Validate every model output with zod.** On invalid JSON, retry once with the validation error, then fail with a structured error.
7. **Trace every agent step** with `trace.ts`: run_id, agent_name, action, input/output summary, model, provider, status. Log the model's `reasoning` field and the Meterless receipt (`meterless.compute_receipt.v1`) into traces, never into user-facing answers.
8. **Never edit `vendor/hmem`.** Wrap it in `src/adapters/hmem.ts`.
9. **Bound every loop:** max 4 tool calls per agent turn, max 2 critic retries per request, timeouts on every network call.
10. **Keep changes small.** One feature per change, with tests. Don't refactor unrelated code.

## Domain guardrails (product behavior)

- Never rule on a judgment call from a description. Explain why it's the umpire's call.
- Always reinforce the umpire as the on-field authority.
- This is a learning tool, not a mid-game replay or protest generator.
- Never invent rule numbers or quote rulebooks. `rules_facts.summary` is our own wording. Cite `source_url` and the edition.
- If a fact used has `verified = false`, say the answer is based on draft data and lower confidence.
- Protest and appeal rights vary by sanction. Check the data; never generalize.
- All player data is synthetic. Drills must be age-appropriate and safety-conscious; no medical advice.

## Known gotchas

- **Zetaris rejects API tokens on the local bundle** ("Api token is not allowed"). Default to `ZETARIS_AUTH_MODE=login` (POST `/api/auth/login` → `idToken`).
- **`tsx --env-file` does not override variables already exported in the shell.** If config looks stale, open a new terminal or `unset` the variables.
- **Trim env values.** Trailing spaces have silently broken provider selection before.
- **Nightshift requires headers** `meterless-app: diamondagentiq` and `meterless-scope: user`, plus `Authorization: Bearer <runtime key>`.
- **Zetaris REST returns values as strings.** Convert before comparing.
- Postgres is on **5433** on the host; inside Docker, Zetaris reaches it as `diq-postgres:5432`.

## Commits

- Small, descriptive messages (e.g., `RulesAgent: fetch house rules and detect conflicts`).
- Check `git status` before committing; `.env` must never appear.
- Keep tool attribution honest: Cursor's agent adds its own trailer. When code was generated by Claude Code on local Nemotron, add `Assisted-by: Claude Code (Ollama, nemotron-3.5-super)` to the commit message.
