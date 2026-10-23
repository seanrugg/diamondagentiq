/**
 * npm run check:data
 * Counts and one cross-source join, all through Zetaris (diq_pg), printed with
 * real column names. Prints response key names (never values) for diagnostics.
 */
import { runAgentRows } from "../adapters/dataTools.js";
import { runSqlDetailed } from "../adapters/zetaris.js";
import { trace } from "../trace.js";

const TABLES = [
  "rule_sources",
  "rules_facts",
  "pitch_rest_rules",
  "house_rules",
  "drills",
  "games",
  "box_scores",
  "play_by_play",
  "pitcher_appearances",
];

try {
  const probe = await runSqlDetailed("SELECT count(*) AS n FROM diq_pg.rule_sources");
  console.log("Zetaris response keys:", probe.payloadKeys.join(", "));
  console.log(
    "Column names from:",
    probe.columns ? `response metadata (${probe.columns.join(", ")})` : "SELECT list (no metadata in response)",
  );

  console.log("\nRow counts:");
  for (const table of TABLES) {
    const [row] = await runAgentRows(`SELECT count(*) AS n FROM diq_pg.${table}`);
    console.log(`  ${table.padEnd(20)} ${row?.n ?? "?"}`);
  }

  console.log("\nrules_facts by call_type:");
  for (const row of await runAgentRows(
    "SELECT call_type, count(*) AS n FROM diq_pg.rules_facts GROUP BY call_type ORDER BY call_type",
  )) {
    console.log(`  ${String(row.call_type).padEnd(10)} ${row.n}`);
  }

  console.log("\nJoin: Little League protest facts with their sources");
  const joined = await runAgentRows(
    "SELECT f.sanction, f.fact_key, f.rule_ref, s.edition, s.url FROM diq_pg.rules_facts f JOIN diq_pg.rule_sources s ON f.source_id = s.source_id WHERE f.sanction = 'little_league' AND f.topic = 'protest' ORDER BY f.fact_key",
  );
  console.table(joined);
} catch (error) {
  const message = error instanceof Error ? error.message : "unknown error";
  trace({
    agent_name: "data",
    action: "check_data",
    input_summary: "counts, call_type, join",
    output_summary: message,
    status: "error",
  });
  process.exitCode = 1;
  console.error(message);
}
