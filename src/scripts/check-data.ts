import { runSql } from "../adapters/zetaris.js";
import { trace } from "../trace.js";

async function runCheck(label: string, sql: string): Promise<unknown> {
  const rows = await runSql(sql);
  trace({
    agent_name: "data",
    action: label,
    input_summary: sql,
    output_summary: JSON.stringify(rows).slice(0, 200),
    status: "ok",
  });
  return rows;
}

try {
  const facts = await runCheck(
    "count_rules_facts",
    "SELECT count(*) FROM diq_pg.rules_facts",
  );
  const drills = await runCheck(
    "count_drills",
    "SELECT count(*) FROM diq_pg.drills",
  );
  const joined = await runCheck(
    "join_pitch_rest_house_rules",
    "SELECT pr.sanction, pr.sport, pr.age_min, pr.age_max, pr.pitches_min, pr.pitches_max, pr.rest_days, hr.event_name, hr.topic FROM diq_pg.pitch_rest_rules pr JOIN diq_pg.house_rules hr ON pr.sanction = hr.sanction AND pr.sport = hr.sport",
  );

  console.log("diq_pg.rules_facts count:", facts);
  console.log("diq_pg.drills count:", drills);
  console.log("pitch_rest_rules ⋈ house_rules:", joined);
} catch (error) {
  const message = error instanceof Error ? error.message : "unknown error";
  trace({
    agent_name: "data",
    action: "check_data",
    input_summary: "counts and join",
    output_summary: message,
    status: "error",
  });
  process.exitCode = 1;
  console.error(message);
}
