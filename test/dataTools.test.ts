import { describe, expect, it, afterEach, vi } from "vitest";
import { prepareSql, runAgentRows, runAgentSql, run_sql } from "../src/adapters/dataTools.js";
import { runSql, runSqlDetailed } from "../src/adapters/zetaris.js";

vi.mock("../src/adapters/zetaris.js", () => ({
  runSql: vi.fn(),
  runSqlDetailed: vi.fn(),
}));

const mockedRunSql = runSql as unknown as ReturnType<typeof vi.fn>;
const mockedRunSqlDetailed = runSqlDetailed as unknown as ReturnType<typeof vi.fn>;

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

  it("allows joining rules_facts to rule_sources", () => {
    const sql = prepareSql(
      "SELECT f.fact_key, s.url FROM diq_pg.rules_facts f JOIN diq_pg.rule_sources s ON f.source_id = s.source_id",
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

describe("prepareSql: comma-separated table lists", () => {
  it("rejects a comma-separated FROM list", () => {
    expect(() =>
      prepareSql("SELECT * FROM diq_pg.rules_facts, other.secret"),
    ).toThrow(/use an explicit JOIN/);
  });

  it("rejects comma-separated allowlisted tables too", () => {
    expect(() =>
      prepareSql("SELECT * FROM rules_facts, house_rules"),
    ).toThrow(/use an explicit JOIN/);
  });

  it("does not reject commas inside string literals or subqueries", () => {
    const result = prepareSql(
      "SELECT * FROM diq_pg.rules_facts WHERE note = 'a, b'",
    );
    expect(result).toContain("LIMIT 200");
  });
});

describe("prepareSql: schema-qualified references anywhere", () => {
  it("rejects a non-diq_pg schema after FROM", () => {
    expect(() =>
      prepareSql("SELECT * FROM other_schema.pitch_rest_rules"),
    ).toThrow(/Only the diq_pg schema is allowed/);
  });

  it("rejects a non-diq_pg schema in a subquery", () => {
    expect(() =>
      prepareSql(
        "SELECT * FROM diq_pg.rules_facts WHERE id IN (SELECT id FROM other.secret)",
      ),
    ).toThrow(/Only the diq_pg schema is allowed/);
  });

  it("rejects a non-diq_pg schema-qualified reference in SELECT", () => {
    expect(() =>
      prepareSql("SELECT other.secret.col FROM diq_pg.rules_facts"),
    ).toThrow(/Only the diq_pg schema is allowed/);
  });

  it("still allows diq_pg-qualified tables and aliased columns", () => {
    const sql = prepareSql(
      "SELECT r.*, h.* FROM diq_pg.rules_facts r JOIN diq_pg.house_rules h ON r.id = h.rule_id",
    );
    expect(sql).toContain("LIMIT 200");
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

  it("runAgentRows names columns from the SELECT list when metadata is absent", async () => {
    mockedRunSqlDetailed.mockResolvedValue({
      data: [["little_league", "4"]],
      columns: null,
      payloadKeys: ["data"],
    });
    const rows = await runAgentRows(
      "SELECT pr.sanction, pr.rest_days FROM diq_pg.pitch_rest_rules pr",
    );
    expect(mockedRunSqlDetailed).toHaveBeenCalledWith(
      "SELECT pr.sanction, pr.rest_days FROM diq_pg.pitch_rest_rules pr LIMIT 200",
    );
    expect(rows).toEqual([{ sanction: "little_league", rest_days: "4" }]);
  });

  it("runAgentRows prefers column names from response metadata", async () => {
    mockedRunSqlDetailed.mockResolvedValue({
      data: [["1"]],
      columns: ["n"],
      payloadKeys: ["data", "columns"],
    });
    expect(await runAgentRows("SELECT count(*) FROM diq_pg.games")).toEqual([{ n: "1" }]);
  });

  it("runAgentRows rejects SELECT * when names are unknown", async () => {
    mockedRunSqlDetailed.mockResolvedValue({ data: [["1"]], columns: null, payloadKeys: ["data"] });
    await expect(runAgentRows("SELECT * FROM diq_pg.games")).rejects.toThrow(
      /explicit column names/,
    );
  });

  it("runAgentRows rejects a column-count mismatch", async () => {
    mockedRunSqlDetailed.mockResolvedValue({ data: [["a", "b", "c"]], columns: null, payloadKeys: ["data"] });
    await expect(
      runAgentRows("SELECT sanction, sport FROM diq_pg.pitch_rest_rules"),
    ).rejects.toThrow(/Column count mismatch/);
  });
});

describe("prepareSql: DevelopmentAgent queries", () => {
  it("accepts the coaching_insights join and the drills lookup", () => {
    const insights = prepareSql(
      "SELECT c.insight_code, c.topic, c.verified, s.url FROM diq_pg.coaching_insights c JOIN diq_pg.rule_sources s ON c.source_id = s.source_id WHERE c.sport IN ('both', 'baseball') AND (c.age_min IS NULL OR c.age_min <= 10) AND (c.age_max IS NULL OR c.age_max >= 10)",
    );
    expect(insights).toContain("coaching_insights");
    expect(prepareSql("SELECT d.id, d.title FROM diq_pg.drills d WHERE (d.age_min IS NULL OR d.age_min <= 10)")).toContain("drills");
  });
});
