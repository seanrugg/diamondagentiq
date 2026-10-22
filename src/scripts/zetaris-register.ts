import { runSql } from "../adapters/zetaris.js";
import { config } from "../config.js";
import { trace } from "../trace.js";

function datasourceAlreadyExists(error: unknown): boolean {
  const message = error instanceof Error ? error.message : "";
  return /already exists|already registered|duplicate/i.test(message);
}

function createDatasourceSql(): string {
  const password = config.DIQ_PG_PASSWORD;
  if (password.includes('"')) {
    throw new Error("DIQ_PG_PASSWORD must not contain double quotes");
  }

  return `CREATE DATASOURCE diq_pg DESCRIBE BY "PostgreSQL" OPTIONS (jdbcdriver "org.postgresql.Driver", jdbcurl "jdbc:postgresql://diq-postgres:5432/diamondagentiq", username "diq", password "${password}", fetchsize "1000")`;
}

try {
  try {
    await runSql(createDatasourceSql());
    trace({
      agent_name: "data",
      action: "create_datasource diq_pg",
      input_summary: "create_datasource diq_pg",
      output_summary: "created",
      status: "ok",
    });
  } catch (error) {
    if (datasourceAlreadyExists(error)) {
      trace({
        agent_name: "data",
        action: "create_datasource diq_pg",
        input_summary: "create_datasource diq_pg",
        output_summary: "already exists, skipped",
        status: "ok",
      });
    } else {
      trace({
        agent_name: "data",
        action: "create_datasource diq_pg",
        input_summary: "create_datasource diq_pg",
        output_summary: "failed",
        status: "error",
      });
      throw new Error("Zetaris CREATE DATASOURCE diq_pg failed");
    }
  }

  const registered = await runSql("REGISTER DATASOURCE TABLES FROM diq_pg");
  trace({
    agent_name: "data",
    action: "register_datasource_tables",
    input_summary: "REGISTER DATASOURCE TABLES FROM diq_pg",
    output_summary: `registered=${JSON.stringify(registered).slice(0, 200)}`,
    status: "ok",
  });
} catch (error) {
  const message = error instanceof Error ? error.message : "unknown error";
  if (!/CREATE DATASOURCE/i.test(message)) {
    trace({
      agent_name: "data",
      action: "zetaris_register",
      input_summary: "register diq_pg",
      output_summary: message,
      status: "error",
    });
    console.error(message);
  } else {
    console.error("Zetaris CREATE DATASOURCE diq_pg failed");
  }
  process.exitCode = 1;
}
