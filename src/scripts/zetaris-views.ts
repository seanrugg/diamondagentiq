/**
 * Create the diq schemastore container and the four knowledge views in
 * Zetaris (idempotent), then count rows through each view and, when
 * ZETARIS_KNOWLEDGE_MART is set, through the data mart.
 */
import { runSql } from "../adapters/zetaris.js";
import { config } from "../config.js";
import { createViewSql, MART_VIEW_SQL, VIEW_CONTAINER } from "../data/martViews.js";
import { MART_VIEWS } from "../data/knowledgeMart.js";

const exists = (error: unknown) => /already exists|duplicate/i.test(error instanceof Error ? error.message : String(error));

async function step(label: string, sql: string): Promise<void> {
  try {
    await runSql(sql);
    console.log(`created  ${label}`);
  } catch (error) {
    if (!exists(error)) throw error;
    console.log(`exists   ${label}`);
  }
}

function count(result: unknown): string {
  const data = (result as { data?: unknown[][] })?.data ?? result;
  return Array.isArray(data) && Array.isArray(data[0]) ? String(data[0][0]) : JSON.stringify(data).slice(0, 60);
}

await step(`container ${VIEW_CONTAINER}`, `CREATE SCHEMASTORE CONTAINER ${VIEW_CONTAINER}`);
for (const view of Object.keys(MART_VIEW_SQL)) await step(`view ${VIEW_CONTAINER}.${view}`, createViewSql(view));

for (const view of MART_VIEWS) {
  console.log(`${VIEW_CONTAINER}.${view}: ${count(await runSql(`SELECT COUNT(*) AS n FROM ${VIEW_CONTAINER}.${view}`))} rows`);
}
const mart = config.ZETARIS_KNOWLEDGE_MART;
if (mart) {
  for (const view of MART_VIEWS) {
    const started = Date.now();
    const n = count(await runSql(`SELECT COUNT(*) AS n FROM ${mart}.${view}`));
    console.log(`${mart}.${view}: ${n} rows (${Date.now() - started} ms)`);
  }
} else {
  console.log("ZETARIS_KNOWLEDGE_MART is not set: the agents read diq_pg directly.");
}
