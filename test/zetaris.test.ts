import { describe, expect, it } from "vitest";
import { normalizeSql } from "../src/adapters/sql.js";
import {
  decodeJwtExp,
  TOKEN_REFRESH_SKEW_MS,
  tokenNeedsRefresh,
} from "../src/adapters/zetaris-token.js";

function jwtWithExp(exp: number): string {
  const header = Buffer.from(
    JSON.stringify({ alg: "none", typ: "JWT" }),
  ).toString("base64url");
  const payload = Buffer.from(JSON.stringify({ exp })).toString("base64url");
  return `${header}.${payload}.sig`;
}

describe("normalizeSql", () => {
  it("strips a trailing semicolon", () => {
    expect(normalizeSql("SELECT 1;")).toBe("SELECT 1");
  });

  it("rejects multiple statements", () => {
    expect(() => normalizeSql("SELECT 1; SELECT 2")).toThrow(
      /Multiple SQL statements/,
    );
  });
});

describe("Zetaris JWT expiry", () => {
  const nowMs = 1_700_000_000_000;

  it("decodes the exp claim from a JWT payload", () => {
    const exp = Math.floor(nowMs / 1000) + 3600;
    expect(decodeJwtExp(jwtWithExp(exp))).toBe(exp);
  });

  it("does not refresh when more than 60 seconds remain", () => {
    const exp = Math.floor(nowMs / 1000) + 61;
    expect(tokenNeedsRefresh(jwtWithExp(exp), nowMs)).toBe(false);
  });

  it("refreshes 60 seconds before expiry", () => {
    const exp = Math.floor((nowMs + TOKEN_REFRESH_SKEW_MS) / 1000);
    expect(tokenNeedsRefresh(jwtWithExp(exp), nowMs)).toBe(true);
  });

  it("refreshes an already expired token", () => {
    const exp = Math.floor(nowMs / 1000) - 1;
    expect(tokenNeedsRefresh(jwtWithExp(exp), nowMs)).toBe(true);
  });

  it("treats a token without exp as needing refresh", () => {
    const header = Buffer.from(JSON.stringify({ alg: "none" })).toString(
      "base64url",
    );
    const payload = Buffer.from(JSON.stringify({ sub: "user" })).toString(
      "base64url",
    );
    expect(tokenNeedsRefresh(`${header}.${payload}.sig`, nowMs)).toBe(true);
    expect(decodeJwtExp("not-a-jwt")).toBeUndefined();
  });
});
