import { beforeEach, describe, expect, it, vi } from "vitest";
import { generator } from "../src/adapters/llm.js";
import { runAgentRows } from "../src/adapters/dataTools.js";
import { MAX_TOOL_CALLS, rulesAgent } from "../src/agents/rulesAgent.js";
import type { ContextOutput } from "../src/agents/contextAgent.js";
import type { SituationRequest } from "../src/schemas/situation.js";

vi.mock("../src/adapters/llm.js", () => ({ generator: vi.fn() }));
vi.mock("../src/adapters/zetaris.js", () => ({ runSql: vi.fn(), runSqlDetailed: vi.fn() }));
vi.mock("../src/adapters/dataTools.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../src/adapters/dataTools.js")>()),
  runAgentRows: vi.fn(),
}));

const mockedGenerator = generator as unknown as ReturnType<typeof vi.fn>;
const mockedRows = runAgentRows as unknown as ReturnType<typeof vi.fn>;

const HOUSE_ID = "00000000-0000-4000-8000-0000000000aa";
const TODAY = "2026-10-18"; // a Sunday

const request: SituationRequest = {
  question: "My 12U pitcher threw 68 pitches Friday. Can she pitch Sunday?",
  role: "coach",
  sport: "baseball",
  sanction: "little_league",
  age: 12,
  event_name: "Fall Classic 12U",
};

const context: ContextOutput = {
  sport: "baseball",
  sanction: "little_league",
  age: 12,
  topic: "pitch rest eligibility",
  entities: { pitches: 68, last_pitched_date: "Friday", game_date: "Sunday" },
  missing_facts: [],
};

// Draft Little League 11-12 tiers, as Zetaris returns them (strings).
const tiers = [
  ["1", "20", "0"],
  ["21", "35", "1"],
  ["36", "50", "2"],
  ["51", "65", "3"],
  ["66", "85", "4"],
].map(([min, max, rest]) => ({
  age_min: "11",
  age_max: "12",
  pitches_min: min ?? "",
  pitches_max: max ?? "",
  rest_days: rest ?? "",
  source_id: "LL-PITCH",
  verified: "false",
}));

/** Fake Zetaris: answers by what the SQL asks for. */
function fakeDb(sql: string) {
  if (/JOIN diq_pg\.rule_sources/.test(sql)) {
    return [{ fact_code: "F010", rule_ref: "Regulation VI", verified: "false", url: "https://www.littleleague.org/playing-rules/pitch-count/", edition: "2026" }];
  }
  if (/FROM diq_pg\.rule_sources WHERE source_id/.test(sql)) {
    return [{ source_id: "LL-PITCH", url: "https://www.littleleague.org/playing-rules/pitch-count/", edition: "2026" }];
  }
  if (/FROM diq_pg\.pitch_rest_rules/.test(sql)) {
    return /sanction = 'little_league'/.test(sql) ? tiers : [];
  }
  if (/FROM diq_pg\.house_rules WHERE id IN/.test(sql)) {
    return [{ id: HOUSE_ID, event_name: "Fall Classic 12U", section: "Pitching rest", source_file: "synthetic://fall-classic-12u/house-rules.txt", synthetic: "true" }];
  }
  if (/FROM diq_pg\.house_rules/.test(sql)) {
    return [{ id: HOUSE_ID, event_name: "Fall Classic 12U", rule_text: "After 21+ pitches add one extra calendar day of rest." }];
  }
  if (/FROM diq_pg\.rules_facts/.test(sql)) {
    return [{ fact_code: "F010", topic: "pitch_rest", fact_key: "three_consecutive_days", summary: "No three days in a row.", call_type: "rule" }];
  }
  return [];
}

const toolCall = (sql: string, id = "call_1") => ({
  content: null,
  toolCalls: [{ id, type: "function", function: { name: "run_sql", arguments: JSON.stringify({ sql }) } }],
  reasoning: "thinking",
  model: "test-model",
  provider: "meterless" as const,
});
const answer = (value: unknown) => ({
  content: typeof value === "string" ? value : JSON.stringify(value),
  toolCalls: [],
  reasoning: null,
  model: "test-model",
  provider: "meterless" as const,
});

const FACTS_SQL = "SELECT fact_code, topic, fact_key, summary, call_type FROM diq_pg.rules_facts WHERE sanction = 'little_league' AND topic = 'pitch_rest'";
const HOUSE_SQL = "SELECT id, event_name, rule_text FROM diq_pg.house_rules WHERE event_name = 'Fall Classic 12U'";

const goodAnswer = {
  facts_used: [{ table: "rules_facts", id: "F010" }, { table: "house_rules", id: HOUSE_ID }],
  applies_pitch_rest: true,
  house_rule_adjustment: { house_rule_id: HOUSE_ID, kind: "add_days", min_pitches: 21, days: 1 },
  summary: "Little League sets rest days by pitch count; the Fall Classic adds a day.",
  call_type_hint: "rule",
  missing_facts: [],
};

beforeEach(() => {
  mockedGenerator.mockReset();
  mockedRows.mockReset();
  mockedRows.mockImplementation(async (sql: string) => fakeDb(sql));
});

describe("rulesAgent", () => {
  it("applies the stricter house rule: 68 pitches Friday -> eligible Thursday, not Sunday", async () => {
    mockedGenerator
      .mockResolvedValueOnce(toolCall(FACTS_SQL))
      .mockResolvedValueOnce(toolCall(HOUSE_SQL, "call_2"))
      .mockResolvedValueOnce(
        answer({
          ...goodAnswer,
          missing_facts: [
            "sanction pitch-count rest-day thresholds for 68 pitches (ages 11-12)",
            "Exact calendar dates for Friday and Sunday",
            "whether she also caught today",
          ],
        }),
      );

    const result = await rulesAgent(request, context, TODAY);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.computation).toMatchObject({
      pitches: 68,
      last_pitched_date: "2026-10-16",
      game_date: "2026-10-18",
      sanction_rest_days: 4,
      rest_days: 5,
      governing: "house_rule",
      conflict: true,
      house_rule_id: HOUSE_ID,
      earliest_eligible_date: "2026-10-22",
      eligible_on_game_date: false,
    });
    expect(result.draft_data).toBe(true);
    expect(result.sources.map((s) => s.table)).toEqual(["rules_facts", "house_rules", "pitch_rest_rules"]);
    expect(result.missing_facts).toEqual(["whether she also caught today"]);
    expect(result.sources.find((s) => s.table === "house_rules")?.synthetic).toBe(true);
    expect(mockedGenerator.mock.calls[0]?.[1]).toMatchObject({ tier: "super", tools: [expect.objectContaining({ type: "function" })] });
  });

  it("uses the sanction chart alone when there is no house rule", async () => {
    mockedGenerator
      .mockResolvedValueOnce(toolCall(FACTS_SQL))
      .mockResolvedValueOnce(answer({ ...goodAnswer, facts_used: [{ table: "rules_facts", id: "F010" }], house_rule_adjustment: null }));

    const result = await rulesAgent({ ...request, event_name: undefined }, context, TODAY);

    expect(result.ok && result.computation).toMatchObject({
      rest_days: 4,
      governing: "sanction",
      conflict: false,
      house_rule_id: null,
      earliest_eligible_date: "2026-10-21",
      eligible_on_game_date: false,
    });
  });

  it("rejects a citation no query returned, then accepts the corrected answer", async () => {
    mockedGenerator
      .mockResolvedValueOnce(toolCall(FACTS_SQL))
      .mockResolvedValueOnce(answer({ ...goodAnswer, facts_used: [{ table: "rules_facts", id: "F999" }], house_rule_adjustment: null }))
      .mockResolvedValueOnce(answer({ ...goodAnswer, facts_used: [{ table: "rules_facts", id: "F010" }], house_rule_adjustment: null }));

    const result = await rulesAgent(request, context, TODAY);

    expect(result.ok).toBe(true);
    const retryMessages = mockedGenerator.mock.calls[2]?.[0] as Array<{ role: string; content: string }>;
    expect(retryMessages.at(-1)?.content).toMatch(/F999/);
  });

  it("fails with a structured error if the model keeps citing invented ids", async () => {
    const invented = answer({ ...goodAnswer, facts_used: [{ table: "rules_facts", id: "F999" }], house_rule_adjustment: null });
    mockedGenerator.mockResolvedValueOnce(toolCall(FACTS_SQL)).mockResolvedValueOnce(invented).mockResolvedValueOnce(invented);

    const result = await rulesAgent(request, context, TODAY);

    expect(result).toMatchObject({ ok: false, error: { attempts: 2 } });
    if (!result.ok) expect(result.error.message).toMatch(/F999/);
  });

  it(`stops running queries after ${MAX_TOOL_CALLS} tool calls and asks for an answer`, async () => {
    for (let i = 0; i < 6; i += 1) mockedGenerator.mockResolvedValueOnce(toolCall(FACTS_SQL, `call_${i}`));
    mockedGenerator.mockResolvedValue(answer({ ...goodAnswer, facts_used: [{ table: "rules_facts", id: "F010" }], house_rule_adjustment: null, applies_pitch_rest: false }));

    const result = await rulesAgent(request, context, TODAY);

    expect(result.ok).toBe(true);
    const modelQueries = mockedRows.mock.calls.filter(([sql]) => sql === FACTS_SQL);
    expect(modelQueries).toHaveLength(MAX_TOOL_CALLS);
    const optionsAfterCap = mockedGenerator.mock.calls[MAX_TOOL_CALLS]?.[1] as { tools?: unknown };
    expect(optionsAfterCap.tools).toBeUndefined();
  });

  it("returns a structured error after two invalid JSON answers", async () => {
    mockedGenerator.mockResolvedValueOnce(answer("not json")).mockResolvedValueOnce(answer("still not json"));

    const result = await rulesAgent(request, context, TODAY);

    expect(result).toMatchObject({ ok: false, error: { attempts: 2 } });
  });

  it("skips the calculation and asks for the pitch count when it is missing", async () => {
    mockedGenerator
      .mockResolvedValueOnce(toolCall(FACTS_SQL))
      .mockResolvedValueOnce(answer({ ...goodAnswer, facts_used: [{ table: "rules_facts", id: "F010" }], house_rule_adjustment: null }));

    const result = await rulesAgent(request, { ...context, entities: { last_pitched_date: "Friday", game_date: "Sunday" } }, TODAY);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.computation).toBeNull();
    expect(result.missing_facts.join(" ")).toMatch(/pitch count/);
  });

  it("explains when the sanction has no pitch-count tiers instead of guessing", async () => {
    mockedGenerator.mockResolvedValueOnce(answer({ ...goodAnswer, facts_used: [], house_rule_adjustment: null }));

    const result = await rulesAgent(
      { ...request, sport: "softball", sanction: "usa_softball", event_name: undefined },
      { ...context, sport: "softball", sanction: "usa_softball" },
      TODAY,
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.computation).toBeNull();
    expect(result.missing_facts.join(" ")).toMatch(/pitch-rest tier/);
  });

  it("returns tool errors to the model instead of crashing", async () => {
    mockedRows.mockImplementationOnce(async () => {
      throw new Error("Only SELECT statements are allowed");
    });
    mockedGenerator
      .mockResolvedValueOnce(toolCall("DELETE FROM diq_pg.rules_facts"))
      .mockResolvedValueOnce(answer({ ...goodAnswer, facts_used: [], house_rule_adjustment: null, applies_pitch_rest: false }));

    const result = await rulesAgent(request, context, TODAY);

    expect(result.ok).toBe(true);
    const second = mockedGenerator.mock.calls[1]?.[0] as Array<{ role: string; content: string }>;
    expect(second.find((m) => m.role === "tool")?.content).toMatch(/^ERROR: Only SELECT/);
  });

  it("retries a blank reply without spending an answer attempt", async () => {
    mockedGenerator
      .mockResolvedValueOnce(answer(""))
      .mockResolvedValueOnce(toolCall(FACTS_SQL))
      .mockResolvedValueOnce(answer("not json"))
      .mockResolvedValueOnce(answer({ ...goodAnswer, facts_used: [{ table: "rules_facts", id: "F010" }], house_rule_adjustment: null }));

    const result = await rulesAgent(request, context, TODAY);

    expect(result.ok).toBe(true);
    expect(mockedGenerator).toHaveBeenCalledTimes(4);
  });
});
