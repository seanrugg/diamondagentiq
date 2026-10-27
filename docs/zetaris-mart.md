# Zetaris knowledge views and data mart

The agents can read their rules and coaching content from a Zetaris Virtual
Data Mart instead of joining the `diq_pg` tables themselves. It's off by
default, and the app falls back to `diq_pg` if the mart can't be read.

## What's in Zetaris

| Object | Kind | What it holds |
|---|---|---|
| `diq` | Schemastore container | The four views below |
| `diq.cited_rules` | View | `rules_facts` joined to `rule_sources`: each fact with its source title, URL and edition |
| `diq.situation_playbook` | View | `coaching_situations` with source |
| `diq.lesson_library` | View | `coaching_lessons` with source |
| `diq.coaching_tips` | View | `coaching_insights` with source |
| `diamondagentiq_knowledge` | Virtual Data Mart | The four views, published as one governed data product |

## Set it up

1. Create the container and views (safe to re-run): `npm run zetaris:views`.
2. In the Zetaris UI, go to **Data Product → Virtual Data Mart → +**. Name the mart
   `diamondagentiq_knowledge`, then drag the four `diq` views from
   **Data Explorer → View → diq** onto the canvas and click **Save**.
3. In `.env`, set `ZETARIS_KNOWLEDGE_MART=diamondagentiq_knowledge`.
4. Run `npm run zetaris:views` again. It counts rows through each view and
   through the mart, and prints how long each mart query takes.

## How the app uses it

- `src/data/knowledgeMart.ts` runs the mart query when a mart is set. It
  uses the original `diq_pg` query when no mart is set, in `SAMPLE_MODE`, or
  after any mart failure. After a failure it stays on `diq_pg` until the
  server restarts.
- Mart queries go through the same read-only checks as every other agent
  query: one SELECT, no writes, and only the mart's four views
  (`prepareSql` with a mart scope).
- The model's `run_sql` tool is unchanged and stays on `diq_pg`.
- The "Behind this answer" panel names the mart when a run read from it.
