import { randomUUID } from "node:crypto";
import { config } from "../config.js";
import { normalizeSql } from "./sql.js";
import { tokenNeedsRefresh } from "./zetaris-token.js";

const REQUEST_TIMEOUT_MS = 60_000;

export { normalizeSql };

let cachedLoginToken: string | undefined;

function stripTrailingSlash(url: string): string {
  return url.replace(/\/$/, "");
}

function isNotAllowedBody(body: string): boolean {
  try {
    const parsed = JSON.parse(body) as { msg?: unknown };
    return parsed.msg === "Not Allowed";
  } catch {
    return false;
  }
}

function shouldRefreshAndRetry(status: number, body: string): boolean {
  return status === 401 || (status === 400 && isNotAllowedBody(body));
}

async function login(): Promise<string> {
  const username = config.ZETARIS_USERNAME;
  const password = config.ZETARIS_PASSWORD;
  if (!username || !password) {
    throw new Error("Zetaris login requires ZETARIS_USERNAME and ZETARIS_PASSWORD");
  }

  const url = `${stripTrailingSlash(config.ZETARIS_BASE_URL)}/api/auth/login`;
  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Request-ID": randomUUID(),
    },
    body: JSON.stringify({ username, password }),
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });

  if (!response.ok) {
    throw new Error(`Zetaris login failed with status ${response.status}`);
  }

  const payload = (await response.json()) as { idToken?: unknown };
  if (typeof payload.idToken !== "string" || payload.idToken.length === 0) {
    throw new Error("Zetaris login did not return an idToken");
  }
  return payload.idToken;
}

export async function getToken(forceRefresh = false): Promise<string> {
  if (config.ZETARIS_AUTH_MODE === "apikey") {
    const apiKey = config.ZETARIS_API_KEY;
    if (!apiKey) {
      throw new Error("ZETARIS_API_KEY is required when ZETARIS_AUTH_MODE=apikey");
    }
    return apiKey;
  }

  if (!forceRefresh && cachedLoginToken && !tokenNeedsRefresh(cachedLoginToken)) {
    return cachedLoginToken;
  }

  cachedLoginToken = await login();
  return cachedLoginToken;
}

async function postSql(
  statement: string,
  queryId: string,
  forceRefresh: boolean,
): Promise<Response> {
  const token = await getToken(forceRefresh);
  const url = `${stripTrailingSlash(config.ZETARIS_REST_URL)}/sql-editor/sqls/run`;

  return fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      "X-Org-ID": config.ZETARIS_ORG_ID,
      "X-Request-ID": randomUUID(),
    },
    body: JSON.stringify({
      queryId,
      sql: statement,
      source: "SqlEditor",
      limit: 1000,
    }),
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
}

export async function runSql(sql: string): Promise<unknown> {
  const statement = normalizeSql(sql);
  const queryId = randomUUID();

  for (let attempt = 0; attempt < 2; attempt += 1) {
    const forceRefresh = attempt === 1;
    const response = await postSql(statement, queryId, forceRefresh);

    if (response.ok) {
      const payload = (await response.json()) as { data?: unknown };
      return payload.data;
    }

    const body = await response.text();
    if (attempt === 0 && shouldRefreshAndRetry(response.status, body)) {
      continue;
    }

    throw new Error(
      `Zetaris SQL request failed with status ${response.status}: ${body.slice(0, 300)}`,
    );
  }

  throw new Error("Zetaris SQL request failed");
}

/**
 * Normalize a Zetaris payload into an array of row objects with string (or
 * null) values. Zetaris returns values as strings, so nothing is parsed or
 * converted here — values are passed through as strings.
 *
 * Accepts:
 * - an array of row objects (passed through, values as string | null)
 * - { columns: string[], rows: unknown[][] } (columns zipped onto each row)
 * - a single row object (wrapped in an array)
 * - anything else (empty array)
 */
export function toRows(
  data: unknown,
): Array<Record<string, string | null>> {
  if (Array.isArray(data)) {
    return data.map((row) =>
      Array.isArray(row) ? toPositionalRow(row) : toRowObject(row),
    );
  }

  if (data !== null && typeof data === "object") {
    const object = data as Record<string, unknown>;
    if (Array.isArray(object.columns) && Array.isArray(object.rows)) {
      return object.rows.map((row) =>
        Object.fromEntries(
          object.columns.map((column, index) => [
            String(column),
            toCellValue((row as unknown[])[index]),
          ]),
        ),
      );
    }
    return [toRowObject(object)];
  }

  return [];
}

/**
 * Zetaris returns rows as positional arrays of strings (no column names in
 * the payload runSql exposes), so key each cell by its zero-based index.
 */
function toPositionalRow(row: unknown[]): Record<string, string | null> {
  return Object.fromEntries(
    row.map((value, index) => [String(index), toCellValue(value)]),
  );
}

function toRowObject(row: unknown): Record<string, string | null> {
  if (row === null || row === undefined || typeof row !== "object") {
    return {};
  }
  if (Array.isArray(row)) {
    return {};
  }
  const object = row as Record<string, unknown>;
  return Object.fromEntries(
    Object.entries(object).map(([key, value]) => [key, toCellValue(value)]),
  );
}

function toCellValue(value: unknown): string | null {
  if (value === null || value === undefined) {
    return null;
  }
  return String(value);
}
