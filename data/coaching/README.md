# Coaching insights

`insights.csv` is the coaching knowledge DiamondAgentIQ teaches from on
development, equipment and general questions (a tough strikeout, confidence,
practice, bats). It loads into the `coaching_insights` table with
`npm run rules:load` and is read only through Zetaris.

- Our own words. Each row cites a `source_id` in `data/rules/rule_sources.csv`.
  `DIQ-SME` is the team's own experience-based guidance (youth coach, travel
  parent, youth umpire). It is never cited as a rule.
- `verified=false` until a person checks the wording. The app then says the
  guidance comes from draft coaching notes and lowers confidence.
- `audience` is `all`, `player`, `parent`, `coach` or `umpire`. `topic` is snake_case.
- Insights are preparation and support advice. Anything about the strike zone
  stays framed as the umpire's judgment: adjust to it, never argue it.

The philosophy every coaching answer follows is in `src/agents/philosophy.ts`.

Edit the CSV, then run `npm run rules:build` (tests fail if `data/rules.sql`
is out of date) and `npm run rules:load`.
