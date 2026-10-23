import { describe, expect, it } from "vitest";
import { columnsFromPayload, selectColumnNames, toRows } from "../src/adapters/rows.js";

describe("toRows", () => {
  it("keys positional rows by index when no column names are given", () => {
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

  it("keys positional rows by the given column names", () => {
    expect(toRows([["little_league", "4"]], ["sanction", "rest_days"])).toEqual([
      { sanction: "little_league", rest_days: "4" },
    ]);
  });

  it("passes through an array of row objects", () => {
    expect(toRows([{ id: "1", name: "diq" }, { id: "2", note: null }])).toEqual([
      { id: "1", name: "diq" },
      { id: "2", note: null },
    ]);
  });

  it("zips a { columns, rows } shape", () => {
    expect(toRows({ columns: ["id", "name"], rows: [["1", "diq"], ["2", null]] })).toEqual([
      { id: "1", name: "diq" },
      { id: "2", name: null },
    ]);
  });

  it("wraps a single row object and ignores other shapes", () => {
    expect(toRows({ id: "1" })).toEqual([{ id: "1" }]);
    expect(toRows(null)).toEqual([]);
    expect(toRows("nope")).toEqual([]);
    expect(toRows(42)).toEqual([]);
  });
});

describe("columnsFromPayload", () => {
  it.each([
    [{ data: [], columns: ["a", "b"] }],
    [{ data: [], columnNames: ["a", "b"] }],
    [{ data: [], header: [{ name: "a" }, { name: "b" }] }],
    [{ data: [], schema: [{ columnName: "a" }, { columnName: "b" }] }],
    [{ data: [], metadata: { fields: [{ label: "a" }, { label: "b" }] } }],
  ])("finds names in %j", (payload) => {
    expect(columnsFromPayload(payload)).toEqual(["a", "b"]);
  });

  it("returns null when the payload has no names", () => {
    expect(columnsFromPayload({ data: [["x"]] })).toBeNull();
    expect(columnsFromPayload({ data: [], schema: "public" })).toBeNull();
    expect(columnsFromPayload(null)).toBeNull();
  });
});

describe("selectColumnNames", () => {
  it("strips table prefixes", () => {
    expect(
      selectColumnNames("SELECT pr.sanction, pr.rest_days FROM diq_pg.pitch_rest_rules pr"),
    ).toEqual(["sanction", "rest_days"]);
  });

  it("uses AS aliases, bare aliases and quoted names", () => {
    expect(
      selectColumnNames(
        'SELECT count(*) AS n, upper(topic) t, f.fact_key k, "Weird Name" FROM diq_pg.rules_facts f',
      ),
    ).toEqual(["n", "t", "k", "Weird Name"]);
  });

  it("ignores commas inside functions and strings", () => {
    expect(
      selectColumnNames(
        "SELECT coalesce(rule_ref, 'n/a, none') AS ref, sport FROM diq_pg.rules_facts",
      ),
    ).toEqual(["ref", "sport"]);
  });

  it("handles DISTINCT and an unaliased expression", () => {
    expect(selectColumnNames("SELECT DISTINCT sanction, count(*) FROM diq_pg.rules_facts GROUP BY sanction")).toEqual([
      "sanction",
      "count(*)",
    ]);
  });

  it("returns null for star selects", () => {
    expect(selectColumnNames("SELECT * FROM diq_pg.games")).toBeNull();
    expect(selectColumnNames("SELECT r.*, h.id FROM diq_pg.rules_facts r JOIN diq_pg.house_rules h ON r.id = h.id")).toBeNull();
  });

  it("does not stop at a FROM inside a subquery", () => {
    expect(
      selectColumnNames(
        "SELECT sanction, (SELECT max(rest_days) FROM diq_pg.pitch_rest_rules) AS max_rest FROM diq_pg.rules_facts",
      ),
    ).toEqual(["sanction", "max_rest"]);
  });
});
