/**
 * Reads from the Zetaris Virtual Data Mart (ZETARIS_KNOWLEDGE_MART) with a
 * fallback to the diq_pg tables.
 *
 * The mart holds four views built in Zetaris (see docs/zetaris-mart.md):
 * cited_rules, situation_playbook, lesson_library and coaching_tips. Each one
 * joins a knowledge table to rule_sources, so one mart query replaces a join.
 *
 * Safety: the mart is off unless configured and is never used in SAMPLE_MODE.
 * If a mart query fails once (mart missing, view renamed, Zetaris error), the
 * mart is switched off for the rest of the process and every read goes back
 * to the original diq_pg query, so the answer path never depends on it.
 */
import { runAgentRows } from "../adapters/dataTools.js";
import type { Row } from "../adapters/rows.js";
import { trace } from "../trace.js";

/** Views in the mart. The model's run_sql tool stays on diq_pg; only these app reads use the mart. */
export const MART_VIEWS = ["cited_rules", "situation_playbook", "lesson_library", "coaching_tips"] as const;

export type MartView = (typeof MART_VIEWS)[number];

let martFailed = false;

/** The configured mart name, or null when reads should go to diq_pg. */
export async function knowledgeMart(): Promise<string | null> {
  if (martFailed) return null;
  try {
    // Loaded lazily so modules that never read the mart don't need a full environment.
    const { config } = await import("../config.js");
    if (config.SAMPLE_MODE) return null;
    return config.ZETARIS_KNOWLEDGE_MART ?? null;
  } catch {
    return null;
  }
}

/** For tests: forget an earlier mart failure. */
export function resetKnowledgeMart(): void {
  martFailed = false;
}

/**
 * Run `martSql(mart)` against the mart when one is configured, else (or on
 * failure) run `baseSql`. Both must return the same column names.
 */
export async function martOrBaseRows(
  view: MartView,
  martSql: (mart: string) => string,
  baseSql: string,
): Promise<Row[]> {
  const mart = await knowledgeMart();
  if (!mart) return runAgentRows(baseSql);
  try {
    return await runAgentRows(martSql(mart), { schema: mart, tables: MART_VIEWS });
  } catch (error) {
    martFailed = true;
    trace({
      agent_name: "dataTools",
      action: "mart_fallback",
      input_summary: `${mart}.${view}`,
      output_summary: `Mart read failed; reading diq_pg until the server restarts: ${error instanceof Error ? error.message : String(error)}`,
      status: "error",
    });
    return runAgentRows(baseSql);
  }
}
