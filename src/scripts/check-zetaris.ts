import { runSql } from "../adapters/zetaris.js";
import { trace } from "../trace.js";

try {
  const rows = await runSql("SELECT 1");
  trace({
    agent_name: "check",
    action: "zetaris_select_1",
    input_summary: "SELECT 1",
    output_summary: `rows=${JSON.stringify(rows).slice(0, 200)}`,
    status: "ok",
  });
  console.log(rows);
} catch (error) {
  const message = error instanceof Error ? error.message : "unknown error";
  trace({
    agent_name: "check",
    action: "zetaris_select_1",
    input_summary: "SELECT 1",
    output_summary: message,
    status: "error",
  });
  process.exitCode = 1;
  console.error(message);
}
