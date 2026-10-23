import { describe, expect, it } from "vitest";
import { normalizeSql } from "../src/adapters/sql.js";
import { toRows } from "../src/adapters/zetaris.js";
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

describe("toRows", () => {
  it("normalizes Zetaris's real shape: an array of string-array rows", () => {
    // Mirror of the real runSql output shape (synthetic values only):
    // [["little_league","baseball","9","10","1","20","0","Fall Classic 12U","pitch_rest"], ...]
    expect(
      toRows([
        ["1", "diq_pg_rule", null],
        ["2", "pitch_rest", "3"],
      ]),
    ).toEqual([
      { "0": "1", "1": "diq_pg_rule", "2": null },
      { "0": "2", "1": "pitch_rest", "2": "3" },
    ]);
  });

  it("passes through an array of row objects (values as string | null)", () => {
    expect(
      toRows([{ id: "1", name: "diq" }, { id: "2", note: null }]),
    ).toEqual([{ id: "1", name: "diq" }, { id: "2", note: null }]);
  });

  it("zips a { columns, rows } shape", () => {
    expect(
      toRows({ columns: ["id", "name"], rows: [["1", "diq"], ["2", null]] }),
    ).toEqual([{ id: "1", name: "diq" }, { id: "2", name: null }]);
  });

  it("wraps a single row object", () => {
    expect(toRows({ id: "1", name: "diq" })).toEqual([{ id: "1", name: "diq" }]);
  });

  it("returns an empty array for other shapes", () => {
    expect(toRows(null)).toEqual([]);
    expect(toRows("nope")).toEqual([]);
    expect(toRows(42)).toEqual([]);
  });
});
