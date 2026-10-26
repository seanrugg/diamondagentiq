import { beforeEach, describe, expect, it, vi } from "vitest";
import { generator } from "../src/adapters/llm.js";
import { answerTexts, applyTexts, translationIssues, translatorAgent } from "../src/agents/translatorAgent.js";
import type { SituationAnswer } from "../src/schemas/situation.js";

vi.mock("../src/adapters/llm.js", () => ({ generator: vi.fn() }));
const mockedGenerator = generator as unknown as ReturnType<typeof vi.fn>;

const reply = (value: unknown) => ({
  content: JSON.stringify(value),
  toolCalls: [],
  reasoning: null,
  model: "test-model",
  requested_model: "test-model",
  provider: "meterless" as const,
});

const answer: SituationAnswer = {
  what_happened: { summary: "She needs 3 days of rest. She can pitch again on 2026-10-20.", sources: [] },
  call_type: "rule",
  call_type_rationale: "A written pitch-count rule.",
  channel: { who: "Head coach", how: "Talk after the game." },
  teachable_moment: "Plan the rotation before the weekend.",
  improvement_plan: { individual: ["Ice and rest."], team: ["Give two other pitchers reps."], at_home: [] },
  confidence: 0.9,
  sources: [{ table: "pitch_rest_rules", id: "LL-1", source_url: "https://example.org/rule", verified: true, rule_ref: "Regulation VI(d)" }],
  missing_facts: [],
  trace_id: "t-1",
  situations: [{ id: "S1", name: "Fly ball, runner on first", offense: "Read the ball.", defense: "Throw behind the runner.", common_mistakes: null }],
};

describe("TranslatorAgent", () => {
  beforeEach(() => mockedGenerator.mockReset());

  it("flattens only user-facing text, and puts it back", () => {
    const t = answerTexts(answer);
    expect(t.summary).toContain("2026-10-20");
    expect(Object.keys(t)).not.toContain("plan_home_0");
    expect(JSON.stringify(t)).not.toContain("example.org");
    const back = applyTexts(answer, { ...t, summary: "Necesita 3 días de descanso. Puede lanzar de nuevo el 2026-10-20." });
    expect(back.what_happened.summary).toMatch(/^Necesita/);
    expect(back.sources).toEqual(answer.sources);
    expect(back.situations?.[0]?.common_mistakes).toBeNull();
  });

  it("flags a missing key and a changed number or date", () => {
    const source = { a: "Rest 3 days, until 2026-10-20.", b: "Rule 7.13 applies." };
    expect(translationIssues(source, { a: "Descansa 3 días, hasta el 2026-10-20.", b: "Se aplica la Regla 7.13." })).toEqual([]);
    const issues = translationIssues(source, { a: "Descansa tres días, hasta el 20 de octubre." });
    expect(issues.join(" ")).toMatch(/"3"/);
    expect(issues.join(" ")).toMatch(/2026-10-20/);
    expect(issues.join(" ")).toMatch(/Key "b"/);
  });

  it("accepts full-width digits", () => {
    expect(translationIssues({ a: "68 pitches" }, { a: "６８球" })).toEqual([]);
  });

  it("returns the translated answer when the checks pass", async () => {
    const t = answerTexts(answer);
    const es = Object.fromEntries(Object.entries(t).map(([k, v]) => [k, `ES ${v}`]));
    mockedGenerator.mockResolvedValueOnce(reply({ texts: es }));
    const r = await translatorAgent(answer, "es", "coach");
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.answer.channel.how).toBe("ES Talk after the game.");
  });

  it("retries once with the issues, then gives up and keeps English", async () => {
    const bad = { texts: { summary: "Sin números." } };
    mockedGenerator.mockResolvedValue(reply(bad));
    const r = await translatorAgent(answer, "ko", "coach");
    expect(r.ok).toBe(false);
    expect(mockedGenerator).toHaveBeenCalledTimes(2);
    const second = mockedGenerator.mock.calls[1]?.[0] as { content: string }[];
    expect(second.at(-1)?.content).toMatch(/keep "3" exactly/);
  });
});
