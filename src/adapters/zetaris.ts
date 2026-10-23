import { randomUUID } from "node:crypto";
import { config } from "../config.js";
import { columnsFromPayload, toRows } from "./rows.js";
import { normalizeSql } from "./sql.js";
import { tokenNeedsRefresh } from "./zetaris-token.js";

const REQUEST_TIMEOUT_MS = 60_000;

export { normalizeSql, toRows };

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

export type SqlResult = {
  /** The payload's data field: Zetaris returns rows as positional string arrays. */
  data: unknown;
  /** Column names from response metadata, or null if the response has none. */
  columns: string[] | null;
  /** Top-level keys of the response (names only, never values), for diagnostics. */
  payloadKeys: string[];
};

/** Run one statement and return the rows plus any column metadata. */
export async function runSqlDetailed(sql: string): Promise<SqlResult> {
  const statement = normalizeSql(sql);
  if (config.SAMPLE_MODE) {
    // No Zetaris available: run the same SQL on the bundled tables (src/adapters/sampleData.ts).
    const { sampleSql } = await import("./sampleData.js");
    const result = await sampleSql(statement);
    return { data: result.data, columns: result.columns, payloadKeys: ["sample_mode"] };
  }
  const queryId = randomUUID();

  for (let attempt = 0; attempt < 2; attempt += 1) {
    const forceRefresh = attempt === 1;
    const response = await postSql(statement, queryId, forceRefresh);

    if (response.ok) {
      const payload = (await response.json()) as Record<string, unknown> | null;
      const record = payload ?? {};
      return {
        data: record.data,
        columns: columnsFromPayload(record),
        payloadKeys: Object.keys(record),
      };
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

/** Run one statement and return the payload's data field (positional rows). */
export async function runSql(sql: string): Promise<unknown> {
  return (await runSqlDetailed(sql)).data;
}
