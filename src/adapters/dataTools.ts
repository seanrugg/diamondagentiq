/**
 * Read-only SQL tool for agents.
 *
 * Allows a single SELECT statement against the diq_pg schema, restricted to an
 * allowlist of tables. All data access goes through Zetaris (runSql); agents
 * never connect to Postgres directly. Every call is traced, and the SQL itself
 * is safe to log (it contains no secrets).
 */

import { normalizeSql } from "./sql.js";
import { runSql } from "./zetaris.js";
import { trace } from "../trace.js";
import type { TraceStatus } from "../trace.js";
import type { ChatCompletionTool } from "openai/resources/chat/completions";

export const ALLOWED_TABLES = [
  "rules_facts",
  "pitch_rest_rules",
  "house_rules",
  "drills",
  "pitcher_appearances",
  "games",
  "box_scores",
  "play_by_play",
] as const;

export type AllowedTable = (typeof ALLOWED_TABLES)[number];

const DEFAULT_LIMIT = 200;
const MAX_LIMIT = 200;

const WRITE_KEYWORDS = [
  "INSERT",
  "UPDATE",
  "DELETE",
  "CREATE",
  "DROP",
  "ALTER",
  "GRANT",
  "TRUNCATE",
  "MERGE",
];

// Table references immediately after FROM or JOIN, optionally schema-prefixed:
//   FROM diq_pg.rules_facts  -> schema=diq_pg, table=rules_facts
//   FROM rules_facts          -> table=rules_facts (schema defaults to diq_pg)
const tableRefPattern = /\b(?:FROM|JOIN)\s+([a-zA-Z_][\w]*)(?:\.([a-zA-Z_][\w]*))?/gi;

export const run_sql: ChatCompletionTool = {
  type: "function",
  function: {
    name: "run_sql",
    description:
      "Run a single read-only SELECT query against the diq_pg database. Only tables in the project allowlist may be referenced; writes and multiple statements are rejected.",
    parameters: {
      type: "object",
      properties: {
        sql: {
          type: "string",
          description: "A single SELECT statement. No writes, no multiple statements.",
        },
      },
      required: ["sql"],
      additionalProperties: false,
    },
  },
};

function stripStringLiterals(sql: string): string {
  return sql
    .replace(/'([^'\\]|\\.)*'/g, "")
    .replace(/"([^"\\]|\\.)*"/g, "");
}

function isWriteKeywordPresent(sql: string): boolean {
  const stripped = stripStringLiterals(sql);
  return WRITE_KEYWORDS.some((kw) => new RegExp(`\\b${kw}\\b`, "i").test(stripped));
}

function extractTableRefs(sql: string): Array<{ schema?: string; table: string }> {
  const refs: Array<{ schema?: string; table: string }> = [];
  for (const match of sql.matchAll(tableRefPattern)) {
    const schemaOrTable = match[1];
    const maybeTable = match[2];
    if (maybeTable !== undefined) {
      refs.push({ schema: schemaOrTable, table: maybeTable });
    } else {
      refs.push({ table: schemaOrTable });
    }
  }
  return refs;
}

function isAllowedTable(table: string): boolean {
  return ALLOWED_TABLES.some((t) => t === table.toLowerCase());
}

function validateTables(sql: string): void {
  for (const ref of extractTableRefs(sql)) {
    if (ref.schema !== undefined) {
      if (ref.schema.toLowerCase() !== "diq_pg") {
        throw new Error(
          `Only the diq_pg schema is allowed; referenced schema "${ref.schema}"`,
        );
      }
      if (!isAllowedTable(ref.table)) {
        throw new Error(
          `Table "${ref.table}" is not in the allowed table list`,
        );
      }
    } else if (!isAllowedTable(ref.table)) {
      throw new Error(
        `Table "${ref.table}" is not in the allowed table list`,
      );
    }
  }
}

function enforceLimit(sql: string): string {
  const limitMatch = sql.match(/LIMIT\s+(\d+)/i);
  if (!limitMatch) {
    return `${sql} LIMIT ${DEFAULT_LIMIT}`;
  }
  const limit = Number(limitMatch[1]);
  if (limit > MAX_LIMIT) {
    return sql.replace(/LIMIT\s+\d+/i, `LIMIT ${MAX_LIMIT}`);
  }
  return sql;
}

/**
 * Validate and prepare a SQL statement for agent execution. Throws on any
 * policy violation (non-SELECT, disallowed table/schema, multiple statements,
 * empty statement). Returns the final SQL with LIMIT enforced.
 */
export function prepareSql(sql: string): string {
  const statement = normalizeSql(sql); // throws on empty / multiple statements

  const firstToken = statement.trim().split(/\s+/)[0];
  if (firstToken?.toUpperCase() !== "SELECT") {
    throw new Error("Only SELECT statements are allowed");
  }

  if (isWriteKeywordPresent(statement)) {
    throw new Error("Write statements are not allowed");
  }

  validateTables(statement);

  return enforceLimit(statement);
}

export async function runAgentSql(sql: string): Promise<unknown> {
  const agentName = "dataTools";
  const action = "run_sql";

  let finalSql: string;
  try {
    finalSql = prepareSql(sql);
  } catch (error) {
    trace({
      agent_name: agentName,
      action,
      input_summary: sql,
      output_summary: error instanceof Error ? error.message : String(error),
      status: "error",
    });
    throw error;
  }

  try {
    const result = await runSql(finalSql);
    trace({
      agent_name: agentName,
      action,
      input_summary: finalSql,
      output_summary: "ok",
      status: "ok",
    });
    return result;
  } catch (error) {
    trace({
      agent_name: agentName,
      action,
      input_summary: finalSql,
      output_summary: error instanceof Error ? error.message : String(error),
      status: "error",
    });
    throw error;
  }
}
