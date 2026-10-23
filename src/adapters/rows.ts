/**
 * Pure helpers for turning Zetaris SQL payloads into named row objects.
 *
 * No config, no network: safe to import from unit tests without a .env.
 *
 * Zetaris's /sql-editor/sqls/run response carries the rows as positional
 * arrays of strings. Column names may arrive in response metadata; when they
 * don't, they are derived from the SELECT list of the statement that was run.
 */

export type Row = Record<string, string | null>;

/**
 * Normalize a Zetaris payload into row objects with string (or null) values.
 * Values are never parsed or converted; Zetaris returns strings.
 *
 * Accepts:
 * - an array of positional rows (keyed by `columns` when given, else "0","1",...)
 * - an array of row objects (passed through)
 * - { columns: string[], rows: unknown[][] }
 * - a single row object (wrapped in an array)
 * - anything else (empty array)
 */
export function toRows(data: unknown, columns?: readonly string[] | null): Row[] {
  if (Array.isArray(data)) {
    return data.map((row) =>
      Array.isArray(row) ? toPositionalRow(row, columns) : toRowObject(row),
    );
  }

  if (data !== null && typeof data === "object") {
    const object = data as Record<string, unknown>;
    if (Array.isArray(object.columns) && Array.isArray(object.rows)) {
      const names = object.columns.map((column) => String(column));
      return object.rows.map((row) =>
        Array.isArray(row) ? toPositionalRow(row, names) : toRowObject(row),
      );
    }
    return [toRowObject(object)];
  }

  return [];
}

function toPositionalRow(row: unknown[], columns?: readonly string[] | null): Row {
  return Object.fromEntries(
    row.map((value, index) => [columns?.[index] ?? String(index), toCellValue(value)]),
  );
}

function toRowObject(row: unknown): Row {
  if (row === null || row === undefined || typeof row !== "object" || Array.isArray(row)) {
    return {};
  }
  return Object.fromEntries(
    Object.entries(row as Record<string, unknown>).map(([key, value]) => [
      key,
      toCellValue(value),
    ]),
  );
}

function toCellValue(value: unknown): string | null {
  if (value === null || value === undefined) {
    return null;
  }
  return String(value);
}

const METADATA_KEYS = [
  "columns",
  "columnNames",
  "column_names",
  "header",
  "headers",
  "fields",
  "schema",
] as const;

function namesFrom(list: unknown): string[] | null {
  if (!Array.isArray(list) || list.length === 0) {
    return null;
  }
  const names: string[] = [];
  for (const item of list) {
    if (typeof item === "string") {
      names.push(item);
      continue;
    }
    if (item !== null && typeof item === "object") {
      const record = item as Record<string, unknown>;
      const name = record.name ?? record.columnName ?? record.column_name ?? record.label;
      if (typeof name === "string") {
        names.push(name);
        continue;
      }
    }
    return null;
  }
  return names;
}

/**
 * Look for column names in a Zetaris response payload. Returns null when the
 * payload carries none (callers then fall back to selectColumnNames).
 */
export function columnsFromPayload(payload: unknown): string[] | null {
  if (payload === null || typeof payload !== "object") {
    return null;
  }
  const record = payload as Record<string, unknown>;
  for (const key of METADATA_KEYS) {
    const names = namesFrom(record[key]);
    if (names) {
      return names;
    }
  }
  for (const nested of ["meta", "metadata", "result"]) {
    const inner = record[nested];
    if (inner !== null && typeof inner === "object") {
      const names = columnsFromPayload(inner);
      if (names) {
        return names;
      }
    }
  }
  return null;
}

/** Split on commas that are not inside parentheses or quotes. */
function splitTopLevel(text: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let quote: string | null = null;
  let current = "";
  for (const ch of text) {
    if (quote) {
      current += ch;
      if (ch === quote) quote = null;
      continue;
    }
    if (ch === "'" || ch === '"') {
      quote = ch;
    } else if (ch === "(") {
      depth += 1;
    } else if (ch === ")") {
      depth -= 1;
    } else if (ch === "," && depth === 0) {
      parts.push(current.trim());
      current = "";
      continue;
    }
    current += ch;
  }
  if (current.trim()) parts.push(current.trim());
  return parts;
}

/** Index of the top-level FROM keyword (not inside parentheses or quotes). */
function topLevelFromIndex(sql: string): number {
  let depth = 0;
  let quote: string | null = null;
  for (let i = 0; i < sql.length; i += 1) {
    const ch = sql[i] as string;
    if (quote) {
      if (ch === quote) quote = null;
      continue;
    }
    if (ch === "'" || ch === '"') {
      quote = ch;
    } else if (ch === "(") {
      depth += 1;
    } else if (ch === ")") {
      depth -= 1;
    } else if (depth === 0 && /\bfrom\b/i.test(sql.slice(i, i + 5)) && /\s/.test(sql[i - 1] ?? " ")) {
      return i;
    }
  }
  return -1;
}

function unquote(name: string): string {
  return name.replace(/^"(.*)"$/, "$1");
}

/**
 * Derive output column names from a SELECT list. Returns null if the list
 * contains a star (the names can't be known without metadata).
 *
 *   "SELECT pr.sanction, count(*) AS n, upper(topic) t FROM ..." -> ["sanction","n","t"]
 */
export function selectColumnNames(sql: string): string[] | null {
  const match = /^\s*select\s+(distinct\s+)?/i.exec(sql);
  if (!match) {
    return null;
  }
  const afterSelect = sql.slice(match[0].length);
  const fromIndex = topLevelFromIndex(afterSelect);
  const list = fromIndex === -1 ? afterSelect : afterSelect.slice(0, fromIndex);

  const names: string[] = [];
  for (const item of splitTopLevel(list)) {
    if (/(^|\.)\*$/.test(item)) {
      return null;
    }
    const asAlias = /\s+as\s+("[^"]+"|[A-Za-z_]\w*)\s*$/i.exec(item);
    if (asAlias?.[1]) {
      names.push(unquote(asAlias[1]));
      continue;
    }
    const bareAlias = /\)\s+("[^"]+"|[A-Za-z_]\w*)\s*$/.exec(item);
    if (bareAlias?.[1]) {
      names.push(unquote(bareAlias[1]));
      continue;
    }
    const columnAlias = /^(?:[A-Za-z_]\w*\.)*[A-Za-z_]\w*\s+("[^"]+"|[A-Za-z_]\w*)$/.exec(item);
    if (columnAlias?.[1]) {
      names.push(unquote(columnAlias[1]));
      continue;
    }
    const column = /^(?:[A-Za-z_]\w*\.)*("[^"]+"|[A-Za-z_]\w*)$/.exec(item);
    if (column?.[1]) {
      names.push(unquote(column[1]));
      continue;
    }
    names.push(item.toLowerCase());
  }
  return names;
}
