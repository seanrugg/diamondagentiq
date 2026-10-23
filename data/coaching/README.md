# Coaching knowledge

The teaching layer DiamondAgentIQ draws on. Every answer, rulings included,
carries a life lesson from here. Loaded with `npm run rules:load`; read only
through Zetaris.

| File | Table | What it holds |
|---|---|---|
| `lessons.csv` | `coaching_lessons` | Philosophy: the principle, the life lesson beyond the diamond, and what it means for a player, coach, parent and umpire. Tags (snake_case, `;`-separated) say which moments bring it up. Not age-specific. |
| `situations.csv` | `coaching_situations` | Strategy for a game state (bases, outs, count): how the offense and defense should react, common mistakes. `rule_fact_codes` link to the rules facts that say where the rule applies. |
| `stories.csv` | `coaching_stories` | Real coaching moments, told in the coach's words and shown to the reader as written. Linked to lessons and situations. |
| `insights.csv` | `coaching_insights` | Practical coaching tips by topic, age and audience (plate coverage, two-strike approach, parent support, bat weight check). |

Rules for every row:

- Our own words. Each row cites a `source_id` in `data/rules/rule_sources.csv`.
  `DIQ-SME` is the team's experience-based guidance; it is never cited as a rule.
- `verified=false` until a person checks the wording. Answers then say the
  guidance comes from draft coaching notes, and confidence is lowered.
- Stories are anonymized: no player, team, league, place or year. The repo is public.
- Anything about the strike zone or another judgment call is framed as the
  umpire's call: adjust to it, never argue it.

The philosophy every coaching answer follows is in `src/agents/philosophy.ts`.

## Adding material

1. Tell Claude the lesson, situation or story in plain words (or add a row yourself).
2. Review the draft row; when the wording is right, set `verified=true` and `verified_by`.
3. `npm run rules:build` (tests fail if `data/rules.sql` is out of date), then `npm run rules:load`.
4. Add a question to `data/evals/questions.json` that this material should improve, and run `npm run eval`.
