import { beforeEach, describe, expect, it, vi } from "vitest";

const runAgentRows = vi.fn();
vi.mock("../src/adapters/dataTools.js", () => ({ runAgentRows }));
vi.mock("../src/trace.js", () => ({ trace: vi.fn() }));
const config = { SAMPLE_MODE: false, ZETARIS_KNOWLEDGE_MART: "diamondagentiq_knowledge" as string | undefined };
vi.mock("../src/config.js", () => ({ config }));

const { martOrBaseRows, resetKnowledgeMart } = await import("../src/data/knowledgeMart.js");
const { prepareSql } = await vi.importActual<typeof import("../src/adapters/dataTools.js")>("../src/adapters/dataTools.js");

const mart = (m: string) => `SELECT f.fact_code FROM ${m}.cited_rules f`;
const base = "SELECT f.fact_code FROM diq_pg.rules_facts f";

describe("martOrBaseRows", () => {
  beforeEach(() => {
    runAgentRows.mockReset();
    resetKnowledgeMart();
    config.SAMPLE_MODE = false;
    config.ZETARIS_KNOWLEDGE_MART = "diamondagentiq_knowledge";
  });

  it("reads the mart, scoped to the mart's views, when one is configured", async () => {
    runAgentRows.mockResolvedValueOnce([{ fact_code: "F001" }]);
    const rows = await martOrBaseRows("cited_rules", mart, base);
    expect(rows).toEqual([{ fact_code: "F001" }]);
    expect(runAgentRows).toHaveBeenCalledTimes(1);
    const [sql, scope] = runAgentRows.mock.calls[0] ?? [];
    expect(sql).toBe("SELECT f.fact_code FROM diamondagentiq_knowledge.cited_rules f");
    expect(scope).toEqual({ schema: "diamondagentiq_knowledge", tables: expect.arrayContaining(["cited_rules"]) });
  });

  it("falls back to diq_pg on a mart failure and stays there", async () => {
    runAgentRows.mockRejectedValueOnce(new Error("Table not found")).mockResolvedValue([{ fact_code: "F002" }]);
    expect(await martOrBaseRows("cited_rules", mart, base)).toEqual([{ fact_code: "F002" }]);
    expect(runAgentRows.mock.calls[1]).toEqual([base]);
    await martOrBaseRows("cited_rules", mart, base);
    expect(runAgentRows.mock.calls[2]).toEqual([base]);
  });

  it("uses diq_pg when no mart is configured or in sample mode", async () => {
    runAgentRows.mockResolvedValue([]);
    config.ZETARIS_KNOWLEDGE_MART = undefined;
    await martOrBaseRows("cited_rules", mart, base);
    config.ZETARIS_KNOWLEDGE_MART = "diamondagentiq_knowledge";
    config.SAMPLE_MODE = true;
    await martOrBaseRows("cited_rules", mart, base);
    expect(runAgentRows.mock.calls).toEqual([[base], [base]]);
  });
});

describe("prepareSql with a mart scope", () => {
  const scope = { schema: "diamondagentiq_knowledge", tables: ["cited_rules"] };

  it("allows the mart's views and keeps diq_pg as the default", () => {
    expect(prepareSql(mart("diamondagentiq_knowledge"), scope)).toContain("diamondagentiq_knowledge.cited_rules");
    expect(() => prepareSql(mart("diamondagentiq_knowledge"))).toThrow(/diq_pg schema/);
  });

  it("rejects diq_pg tables, other views and writes inside a mart scope", () => {
    expect(() => prepareSql(base, scope)).toThrow(/diamondagentiq_knowledge schema/);
    expect(() => prepareSql("SELECT x FROM diamondagentiq_knowledge.other_view", scope)).toThrow(/not in the allowed/);
    expect(() => prepareSql("DROP VIEW diamondagentiq_knowledge.cited_rules", scope)).toThrow(/Only SELECT/);
  });
});

describe("mart view definitions", async () => {
  const { MART_VIEW_SQL, createViewSql } = await import("../src/data/martViews.js");
  const { MART_VIEWS } = await import("../src/data/knowledgeMart.js");

  it("defines exactly the views the agents read, each as one read-only SELECT", () => {
    expect(Object.keys(MART_VIEW_SQL).sort()).toEqual([...MART_VIEWS].sort());
    for (const view of MART_VIEWS) {
      expect(prepareSql(MART_VIEW_SQL[view] ?? "")).toMatch(/^SELECT /);
      expect(MART_VIEW_SQL[view]).toContain("AS source_url");
      expect(createViewSql(view)).toMatch(new RegExp(`^CREATE SCHEMASTORE VIEW ${view} WITH CONTAINER diq AS \\(SELECT `));
    }
  });
});
