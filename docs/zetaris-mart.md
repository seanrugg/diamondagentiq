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

## Least privilege: a read-only agent user

The agents only read, so they don't need the administrator login. This
follows Zetaris's own guidance: administrators build, and a separate
non-administrator user reads. A Zetaris administrator does these steps in
the UI and sets the password themselves:

1. **Management → Roles**: create the role `diq_agent_read`.
2. **Management → Users**: create the agent's user, for example
   `diq-agent@example.com`, set its password, and assign it to
   `diq_agent_read`. It must not be an administrator.
3. **Management → Permissions**: expand `diq_agent_read` and tick **View**
   on Data Catalog and Virtual Data Mart. Leave every **Execute** box
   unticked, then **Save**.
4. **Access Control** (object-level data access, denied by default):
   - Open the `diamondagentiq_knowledge` mart → **Access Control** → assign
     `diq_agent_read` → **SELECT** → **Apply**.
   - Do the same for the `diq_pg` data source, ticking SELECT for all tables.
     Some answers still read `diq_pg` directly: drills, house rules, pitch
     rest tiers, and the model's `run_sql` tool.
5. In the app's `.env`, set `ZETARIS_USERNAME` and `ZETARIS_PASSWORD` to the
   agent user. Keep the administrator login out of the app's `.env`.
6. Setup scripts (`zetaris:register`, `zetaris:views`) still need the
   administrator. Variables exported in the shell override `.env`, so run
   them from a terminal where you exported the admin login, then close that
   terminal.
7. Check: `npm run check:zetaris` and `npm run check:data` should pass as
   the agent user. In the SQL Workspace, signed in as the agent user, a
   `DROP` or `CREATE` should be refused.

## Who can pitch Saturday? (a file joined to Postgres)

- **The file.** A coach's pitch log, `data/demo/pitch_log_synthetic.csv`
  (synthetic pitchers), is uploaded to **NDP File System → file-store**.
- **The table.** It's registered as `DIQ_FILES.pitch_log`: under
  **File Source & API → DIQ_FILES → Create Table**, choose File store, CSV,
  storage provider **NDP File System**, select the file, and set
  `inferSchema` to `true`.
- **The view.** `diq.pitcher_availability` joins the file to
  `diq_pg.pitch_rest_rules` by sanction, sport, age and pitch count. The view
  is also published in the `diamondagentiq_knowledge` mart.
- **The app.** The **Coach: who can pitch Saturday?** button calls
  `GET /pitchers?date=Saturday` (`src/agents/pitcherAvailability.ts`). It
  reads the mart, then the `diq` view, then the file table, in that order.
  Code recomputes each pitcher's rest days from the tiers, notes any
  disagreement with the view, and computes the earliest eligible date. No
  model is involved. Sample mode reads the bundled CSV.
