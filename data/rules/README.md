# Rules knowledge base (draft)

These CSVs are the source of truth for rule facts. A loader turns them into the `rule_sources`, `rules_facts` and `pitch_rest_rules` tables, so Zetaris can query them.

| File | What it holds |
|---|---|
| `rule_sources.csv` | One row per source document or page: sanction, title, URL, edition or date, access type, and how we may use it |
| `rules_facts.csv` | One row per fact: sanction, division, ages, topic, `fact_key`, value, `rule_ref`, `call_type`, a summary in our own words, and the source |
| `pitch_rest_rules.csv` | Pitch-count rest tiers (pitches to calendar days of rest) by sanction and age |
| `gaps.csv` | Known missing or unreadable sources, by priority |

## Rules for this data

- **Summaries are our own wording.** Never paste rulebook text.
- **`rule_ref` is only what the cited source prints.** We never invent or guess rule numbers. If the source gives none, `rule_ref` says so.
- **Every row starts `verified=false`.** A row becomes `true` only after a person checks it against the source or the current rulebook and puts their initials in `verified_by`.
- **`call_type`:** `rule` means the rulebook decides; `judgment` means the umpire decides; `mixed` means judgment decides whether it happened and the rule sets the penalty or award.
- **Guidelines aren't rules.** Pitch Smart rows use `sanction=pitch_smart` and bind only where a league adopts them.
- **Full rulebooks stay outside the repo** (`~/hackathon/sources/`), including the free USSSA fastpitch PDF. Paid rulebooks are for verification only.
- Rows were retrieved on 2026-10-22. Editions and page dates are in each row.

## Updating

1. Edit the CSV, or fold in corrections from the review workbook.
2. Re-run the loader, then `npm run check:data`.
3. Commit the CSV change on its own, with the reviewer's initials in the message.
