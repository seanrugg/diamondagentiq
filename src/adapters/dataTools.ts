/**
 * Read-only SQL tool for agents.
 *
 * Allows a single SELECT statement against the diq_pg schema, restricted to an
 * allowlist of tables. All data access goes through Zetaris (runSql); agents
 * never connect to Postgres directly. Every call is traced, and the SQL itself
 * is safe to log (it contains no secrets).
 */

import { normalizeSql } from "./sql.js";
import { selectColumnNames, toRows, type Row } from "./rows.js";
import { runSql, runSqlDetailed } from "./zetaris.js";
import { trace } from "../trace.js";
import type { TraceStatus } from "../trace.js";
import type { ChatCompletionTool } from "openai/resources/chat/completions";

export const ALLOWED_TABLES = [
  "rule_sources",
  "rules_facts",
  "pitch_rest_rules",
  "house_rules",
  "drills",
  "coaching_insights",
  "coaching_lessons",
  "coaching_situations",
  "coaching_stories",
  "pitcher_appearances",
  "games",
  "box_scores",
  "play_by_play",
] as const;

export type AllowedTable = (typeof ALLOWED_TABLES)[number];

/** Which schema and tables a statement may reference. */
export type SqlScope = { schema: string; tables: readonly string[] };

export const DIQ_PG_SCOPE: SqlScope = { schema: "diq_pg", tables: ALLOWED_TABLES };

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

function isAllowedTable(table: string, scope: SqlScope): boolean {
  return scope.tables.some((t) => t === table.toLowerCase());
}

function validateTables(sql: string, scope: SqlScope): void {
  for (const ref of extractTableRefs(sql)) {
    if (ref.schema !== undefined) {
      if (ref.schema.toLowerCase() !== scope.schema.toLowerCase()) {
        throw new Error(
          `Only the ${scope.schema} schema is allowed; referenced schema "${ref.schema}"`,
        );
      }
      if (!isAllowedTable(ref.table, scope)) {
        throw new Error(
          `Table "${ref.table}" is not in the allowed table list`,
        );
      }
    } else if (!isAllowedTable(ref.table, scope)) {
      throw new Error(
        `Table "${ref.table}" is not in the allowed table list`,
      );
    }
  }
}

// Clause keywords that end a table source list introduced by FROM or JOIN.
const SOURCE_LIST_END_KEYWORDS = [
  "WHERE",
  "ON",
  "GROUP",
  "ORDER",
  "LIMIT",
  "OFFSET",
  "HAVING",
  "FETCH",
  "FOR",
  "UNION",
  "INTERSECT",
  "EXCEPT",
  "FROM",
  "JOIN",
];

const sourceListEndPattern = new RegExp(
  `\\b(${SOURCE_LIST_END_KEYWORDS.join("|")})\\b`,
  "i",
);

/**
 * The raw table source text introduced by each FROM or JOIN, in statement
 * order. Comma-separated lists are kept intact so they can be rejected
 * explicitly (agents must use explicit JOINs instead).
 */
function extractSourceLists(sql: string): string[] {
  const lists: string[] = [];
  for (const match of sql.matchAll(/\b(FROM|JOIN)\b/gi)) {
    const start = match.index! + match[0].length;
    const rest = sql.slice(start);
    const endMatch = rest.match(sourceListEndPattern);
    const end = endMatch ? endMatch.index! : rest.length;
    lists.push(rest.slice(0, end).trim());
  }
  return lists;
}

function hasTopLevelComma(text: string): boolean {
  let depth = 0;
  let inString = false;
  let escape = false;
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    if (escape) {
      escape = false;
    } else if (inString) {
      if (ch === "\\") {
        escape = true;
      } else if (ch === "'") {
        inString = false;
      }
    } else if (ch === "'") {
      inString = true;
    } else if (ch === "(") {
      depth += 1;
    } else if (ch === ")") {
      if (depth > 0) depth -= 1;
    } else if (ch === "," && depth === 0) {
      return true;
    }
  }
  return false;
}

/**
 * Reject comma-separated table lists in FROM/JOIN source lists. Agents must
 * reference each table with its own FROM/JOIN (explicit JOIN) so every table
 * is individually checked against the allowlist.
 */
function rejectCommaSeparatedSources(sql: string): void {
  for (const sourceList of extractSourceLists(sql)) {
    if (hasTopLevelComma(sourceList)) {
      throw new Error(
        "Comma-separated table lists are not allowed; use an explicit JOIN",
      );
    }
  }
}

/**
 * Table aliases declared in FROM/JOIN sources (e.g. "diq_pg.rules_facts r"
 * declares alias "r"), so that alias.column references in SELECT/WHERE are
 * not mistaken for schema-qualified table references.
 */
function extractTableAliases(sql: string): Set<string> {
  const aliases = new Set<string>();
  for (const sourceList of extractSourceLists(sql)) {
    for (const source of sourceList.split(",")) {
      const trimmed = source.trim();
      if (!trimmed || trimmed.startsWith("(")) {
        continue;
      }
      const asMatch = trimmed.match(/\bAS\s+([a-zA-Z_][\w]*)\s*$/i);
      if (asMatch) {
        aliases.add(asMatch[1].toLowerCase());
        continue;
      }
      const tokens = trimmed.split(/\s+/);
      // Only multi-token sources declare an alias (e.g. "diq_pg.rules_facts r");
      // a bare table name is not an alias.
      if (tokens.length > 1) {
        const last = tokens[tokens.length - 1];
        if (/^[a-zA-Z_][\w]*$/.test(last)) {
          aliases.add(last.toLowerCase());
        }
      }
    }
  }
  return aliases;
}

const schemaQualifiedPattern = /\b([a-zA-Z_][\w]*)\.([a-zA-Z_][\w]*)/gi;

/**
 * Reject any schema-qualified reference (schema.table) anywhere in the
 * statement whose schema is not diq_pg, not just references after FROM/JOIN.
 * Table aliases (alias.column) are not treated as schema-qualified.
 */
function rejectNonDiqPgSchemas(sql: string, scope: SqlScope): void {
  const stripped = stripStringLiterals(sql);
  const aliases = extractTableAliases(sql);
  for (const match of stripped.matchAll(schemaQualifiedPattern)) {
    const schema = match[1].toLowerCase();
    if (schema !== scope.schema.toLowerCase() && !aliases.has(schema)) {
      throw new Error(
        `Only the ${scope.schema} schema is allowed; referenced schema "${match[1]}"`,
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
export function prepareSql(sql: string, scope: SqlScope = DIQ_PG_SCOPE): string {
  const statement = normalizeSql(sql); // throws on empty / multiple statements

  const firstToken = statement.trim().split(/\s+/)[0];
  if (firstToken?.toUpperCase() !== "SELECT") {
    throw new Error("Only SELECT statements are allowed");
  }

  if (isWriteKeywordPresent(statement)) {
    throw new Error("Write statements are not allowed");
  }

  rejectCommaSeparatedSources(statement);
  validateTables(statement, scope);
  rejectNonDiqPgSchemas(statement, scope);

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

/**
 * Run an agent SELECT and return rows keyed by real column names.
 *
 * Column names come from the Zetaris response metadata when present;
 * otherwise from the statement's SELECT list. SELECT * is rejected when the
 * response carries no names, because positional values could be misread
 * (e.g. rest_days taken for pitches_max).
 */
export async function runAgentRows(sql: string, scope: SqlScope = DIQ_PG_SCOPE): Promise<Row[]> {
  const finalSql = prepareSql(sql, scope);
  const derived = selectColumnNames(finalSql);
  const result = await runSqlDetailed(finalSql);
  const columns = result.columns ?? derived;

  if (!columns) {
    const message =
      "runAgentRows needs explicit column names: list the columns instead of SELECT *";
    trace({ agent_name: "dataTools", action: "run_sql_rows", input_summary: finalSql, output_summary: message, status: "error" });
    throw new Error(message);
  }

  const rows = toRows(result.data, columns);
  const width = Array.isArray(result.data) && Array.isArray(result.data[0]) ? result.data[0].length : columns.length;
  if (width !== columns.length) {
    const message = `Column count mismatch: expected ${columns.length} (${columns.join(", ")}), got ${width}`;
    trace({ agent_name: "dataTools", action: "run_sql_rows", input_summary: finalSql, output_summary: message, status: "error" });
    throw new Error(message);
  }

  trace({
    agent_name: "dataTools",
    action: "run_sql_rows",
    input_summary: finalSql,
    output_summary: `${rows.length} rows; columns from ${result.columns ? "metadata" : "select list"}`,
    status: "ok",
  });
  return rows;
}
