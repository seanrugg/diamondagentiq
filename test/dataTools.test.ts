import { describe, expect, it, afterEach, vi } from "vitest";
import { prepareSql, runAgentSql, run_sql } from "../src/adapters/dataTools.js";
import { runSql } from "../src/adapters/zetaris.js";

vi.mock("../src/adapters/zetaris.js", () => ({
  runSql: vi.fn(),
}));

const mockedRunSql = runSql as unknown as ReturnType<typeof vi.fn>;

describe("run_sql tool definition", () => {
  it("is an OpenAI function tool named run_sql", () => {
    expect(run_sql.type).toBe("function");
    expect((run_sql as { function: { name: string } }).function.name).toBe(
      "run_sql",
    );
  });
});

describe("prepareSql: SELECT only", () => {
  it.each(["INSERT", "UPDATE", "DELETE", "CREATE", "DROP", "ALTER", "GRANT"])(
    "rejects %s statements",
    (keyword) => {
      expect(() => prepareSql(`${keyword} foo`)).toThrow(
        /Only SELECT statements are allowed/,
      );
    },
  );

  it("rejects empty statements", () => {
    expect(() => prepareSql("")).toThrow(/SQL statement is empty/);
  });

  it("rejects multiple statements", () => {
    expect(() =>
      prepareSql("SELECT 1; SELECT 2"),
    ).toThrow(/Multiple SQL statements are not allowed/);
  });

  it("does not false-positive on a write keyword inside a string literal", () => {
    const result = prepareSql("SELECT * FROM diq_pg.rules_facts WHERE note = 'UPDATE'");
    expect(result).toContain("LIMIT 200");
  });
});

describe("prepareSql: table allowlist (diq_pg schema)", () => {
  it("allows a bare allowlisted table", () => {
    expect(prepareSql("SELECT * FROM rules_facts")).toContain("LIMIT 200");
  });

  it("allows diq_pg-prefixed allowlisted tables", () => {
    expect(
      prepareSql("SELECT * FROM diq_pg.pitch_rest_rules"),
    ).toContain("LIMIT 200");
  });

  it("allows multiple allowlisted tables via JOIN", () => {
    const sql = prepareSql(
      "SELECT r.*, h.* FROM diq_pg.rules_facts r JOIN diq_pg.house_rules h ON r.id = h.rule_id",
    );
    expect(sql).toContain("LIMIT 200");
  });

  it.each([
    "SELECT * FROM public.rules_facts",
    "SELECT * FROM other_schema.pitch_rest_rules",
  ])("rejects non-diq_pg schema: %s", (sql) => {
    expect(() => prepareSql(sql)).toThrow(/Only the diq_pg schema is allowed/);
  });

  it.each([
    "SELECT * FROM diq_pg.unknown_table",
    "SELECT * FROM unknown_table",
  ])("rejects non-allowlisted table: %s", (sql) => {
    expect(() => prepareSql(sql)).toThrow(/is not in the allowed table list/);
  });
});

describe("prepareSql: LIMIT handling", () => {
  it("adds LIMIT 200 when missing", () => {
    expect(prepareSql("SELECT * FROM diq_pg.games")).toBe(
      "SELECT * FROM diq_pg.games LIMIT 200",
    );
  });

  it("keeps a limit at or below 200", () => {
    expect(prepareSql("SELECT * FROM diq_pg.games LIMIT 50")).toBe(
      "SELECT * FROM diq_pg.games LIMIT 50",
    );
    expect(prepareSql("SELECT * FROM diq_pg.games LIMIT 200")).toBe(
      "SELECT * FROM diq_pg.games LIMIT 200",
    );
  });

  it("caps a limit above 200 at 200", () => {
    expect(prepareSql("SELECT * FROM diq_pg.games LIMIT 5000")).toBe(
      "SELECT * FROM diq_pg.games LIMIT 200",
    );
  });

  it("is case-insensitive for LIMIT", () => {
    expect(prepareSql("SELECT * FROM diq_pg.games limit 999")).toBe(
      "SELECT * FROM diq_pg.games LIMIT 200",
    );
  });
});

describe("runAgentSql", () => {
  afterEach(() => {
    mockedRunSql.mockReset();
  });

  it("runs the prepared SQL through Zetaris and returns its result", async () => {
    mockedRunSql.mockResolvedValue([{ id: "1" }]);
    const result = await runAgentSql("SELECT * FROM diq_pg.games");
    expect(mockedRunSql).toHaveBeenCalledTimes(1);
    expect(mockedRunSql).toHaveBeenCalledWith(
      "SELECT * FROM diq_pg.games LIMIT 200",
    );
    expect(result).toEqual([{ id: "1" }]);
  });

  it("throws before calling Zetaris when SQL is disallowed", async () => {
    await expect(runAgentSql("DROP TABLE diq_pg.games")).rejects.toThrow(
      /Only SELECT statements are allowed/,
    );
    expect(mockedRunSql).not.toHaveBeenCalled();
  });
});
