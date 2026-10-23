import { beforeEach, describe, expect, it, vi } from "vitest";
import { generator } from "../src/adapters/llm.js";
import { contextAgent } from "../src/agents/contextAgent.js";
import { rulesAgent } from "../src/agents/rulesAgent.js";
import { askJson } from "../src/agents/modelJson.js";
import { deterministicChecks } from "../src/agents/criticAgent.js";
import type { CoachingDraft } from "../src/agents/coachingAgent.js";
import { callTypeFromEvidence, computeConfidence, MAX_CRITIC_RETRIES, runSituation } from "../src/orchestrator.js";
import type { RulesResult } from "../src/schemas/rules.js";
import { CallTypeOutputSchema } from "../src/agents/callTypeAgent.js";
import { developmentAgent } from "../src/agents/developmentAgent.js";

vi.mock("../src/adapters/llm.js", () => ({ generator: vi.fn() }));
vi.mock("../src/adapters/zetaris.js", () => ({ runSql: vi.fn(), runSqlDetailed: vi.fn() }));
vi.mock("../src/agents/contextAgent.js", () => ({ contextAgent: vi.fn() }));
vi.mock("../src/agents/rulesAgent.js", () => ({ rulesAgent: vi.fn() }));
vi.mock("../src/agents/developmentAgent.js", () => ({ developmentAgent: vi.fn() }));

const mockedGenerator = generator as unknown as ReturnType<typeof vi.fn>;
const mockedContext = contextAgent as unknown as ReturnType<typeof vi.fn>;
const mockedRules = rulesAgent as unknown as ReturnType<typeof vi.fn>;
const mockedDev = developmentAgent as unknown as ReturnType<typeof vi.fn>;

const reply = (value: unknown, model = "test-model") => ({
  content: typeof value === "string" ? value : JSON.stringify(value),
  toolCalls: [],
  reasoning: null,
  model,
  provider: "meterless" as const,
});

const request = {
  question: "My 12U pitcher threw 68 pitches Friday. Can she pitch Sunday?",
  role: "coach" as const,
  sport: "baseball" as const,
  sanction: "little_league",
  age: 12,
  event_name: "Fall Classic 12U",
};

const context = {
  intent: "ruling" as const,
  sport: "baseball" as const,
  sanction: "little_league",
  age: 12,
  topic: "pitch rest",
  entities: { pitches: 68, last_pitched_date: "Friday", game_date: "Sunday" },
  missing_facts: [],
};

const rules: Extract<RulesResult, { ok: true }> = {
  ok: true,
  summary: "Little League rest days by pitch count; the Fall Classic adds a day.",
  call_type_hint: "rule",
  sources: [
    { table: "rules_facts", id: "F003", rule_ref: "Regulation VI(c)", source_url: "https://www.littleleague.org/playing-rules/pitch-count/", edition: "2026", verified: false, synthetic: false, call_type: "rule", summary: "Daily max 85 for 11-12." },
    { table: "house_rules", id: "hr-1", rule_ref: "Fall Classic 12U, Pitching rest", source_url: "synthetic://fall-classic-12u/house-rules.txt", edition: null, verified: false, synthetic: true, call_type: null, summary: "+1 day after 21+ pitches" },
  ],
  computation: {
    pitches: 68, age: 12, last_pitched_date: "2026-10-16", game_date: "2026-10-18",
    sanction_rest_days: 4, rest_days: 5, governing: "house_rule", conflict: true, house_rule_id: "hr-1",
    earliest_eligible_date: "2026-10-22", eligible_on_game_date: false,
  },
  draft_data: true,
  missing_facts: [],
};

const callType = { call_type: "rule", rationale: "Pitch rest follows the chart.", judgment_parts: [], rule_parts: ["rest days"] };

const goodDraft: CoachingDraft = {
  what_happened: "She can't pitch Sunday. Under the Fall Classic rule she needs 5 days of rest, so she is eligible again on Thursday, October 22. This is based on draft rule data that hasn't been verified yet.",
  channel: { who: "Tournament director", how: "Confirm the pitch log at check-in before Thursday's game." },
  teachable_moment: "Event rules can be stricter than the league's; the stricter one governs.",
  improvement_plan: { individual: ["Light catch only, no pitching, until Thursday."], team: ["Keep a shared pitch log."], at_home: ["Follow Pitch Smart rest guidance."] },
  life_lesson: "",
};
const draftWithoutDate = { ...goodDraft, what_happened: "She can't pitch Sunday; she needs more rest. This is based on draft rule data that hasn't been verified yet." };

beforeEach(() => {
  mockedGenerator.mockReset();
  mockedContext.mockReset().mockResolvedValue({ ok: true, context });
  mockedRules.mockReset().mockResolvedValue(rules);
  mockedDev.mockReset().mockResolvedValue({ ok: false, error: { message: "no lessons in this test", attempts: 0 } });
});

describe("askJson", () => {
  it("retries once with the validation error, then succeeds", async () => {
    mockedGenerator.mockResolvedValueOnce(reply("nope")).mockResolvedValueOnce(reply(callType));
    const result = await askJson("t", "a", "lightning", [{ role: "user", content: "x" }], CallTypeOutputSchema);
    expect(result.ok).toBe(true);
    const retryMessages = mockedGenerator.mock.calls[1]?.[0] as Array<{ content: string }>;
    expect(retryMessages.at(-1)?.content).toMatch(/Invalid JSON/);
  });

  it("falls back from Lightning to Super if the provider rejects the model", async () => {
    mockedGenerator.mockRejectedValueOnce(Object.assign(new Error("model not found"), { status: 404 })).mockResolvedValueOnce(reply(callType));
    const result = await askJson("t", "a", "lightning", [{ role: "user", content: "x" }], CallTypeOutputSchema);
    expect(result.ok).toBe(true);
    expect(mockedGenerator.mock.calls[0]?.[1]).toMatchObject({ tier: "lightning" });
    expect(mockedGenerator.mock.calls[1]?.[1]).toMatchObject({ tier: "super" });
  });
});

describe("deterministicChecks", () => {
  it("passes a grounded draft", () => {
    expect(deterministicChecks(goodDraft, rules)).toEqual([]);
  });

  it("flags a missing computed date", () => {
    expect(deterministicChecks(draftWithoutDate, rules).join(" ")).toMatch(/2026-10-22/);
  });

  it("flags missing draft-data disclosure", () => {
    const d = { ...goodDraft, what_happened: "She can't pitch Sunday; eligible again October 22." };
    expect(deterministicChecks(d, rules).join(" ")).toMatch(/draft rule data/);
  });

  it("doesn't mistake prose like 'rule interpretation' for a rule number", () => {
    const d = { ...goodDraft, channel: { who: "Head coach", how: "Protests are only for rule interpretation, never for judgment. Regulation viewpoints vary." } };
    expect(deterministicChecks(d, rules)).toEqual([]);
  });

  it("flags a rule number that isn't in the sources, but allows cited ones", () => {
    const d = { ...goodDraft, teachable_moment: "Regulation VI(c) sets the max; Rule 7.13 covers leading off." };
    const issues = deterministicChecks(d, rules);
    expect(issues.join(" ")).toMatch(/Rule 7\.13/);
    expect(issues.join(" ")).not.toMatch(/Regulation VI/);
  });

  it("flags an empty improvement plan and a missing 'not eligible'", () => {
    const d = { ...goodDraft, what_happened: "Eligible again October 22 (draft data).", improvement_plan: { individual: [], team: [], at_home: [] } };
    const text = deterministicChecks(d, rules).join(" ");
    expect(text).toMatch(/improvement-plan/);
    expect(text).toMatch(/not eligible/);
  });
});

describe("computeConfidence", () => {
  it("caps draft data and lowers for missing facts and unresolved issues", () => {
    expect(computeConfidence({ ...rules, draft_data: false }, 0)).toBe(0.9);
    expect(computeConfidence(rules, 0)).toBe(0.6);
    expect(computeConfidence({ ...rules, missing_facts: ["a", "b"] }, 1)).toBe(0.2);
  });
});

describe("callTypeFromEvidence", () => {
  it("classifies a computed pitch-rest answer built only on rule facts, and nothing else", () => {
    expect(callTypeFromEvidence(rules)?.call_type).toBe("rule");
    expect(callTypeFromEvidence({ ...rules, call_type_hint: "mixed" })).toBeNull();
    expect(callTypeFromEvidence({ ...rules, computation: null })).toBeNull();
    const judgmentFact = { ...rules.sources[0]!, call_type: "judgment" as const };
    expect(callTypeFromEvidence({ ...rules, sources: [judgmentFact] })).toBeNull();
  });
});

describe("runSituation", () => {
  it("sends a draft back when the code check finds a problem, skipping the model review that round", async () => {
    mockedGenerator
      .mockResolvedValueOnce(reply(draftWithoutDate)) // CoachingAgent draft 1 (code check fails; no model review)
      .mockResolvedValueOnce(reply(goodDraft)) // CoachingAgent draft 2
      .mockResolvedValueOnce(reply({ pass: true, issues: [] })); // CriticAgent

    const result = await runSituation(request, "2026-10-18");

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.answer.review).toEqual({ drafts: 2, passed: true, unresolved_issues: [] });
    expect(result.answer.call_type).toBe("rule"); // by code: computed answer, rule facts only
    expect(result.answer.confidence).toBe(0.6);
    expect(result.answer.sources.map((s) => s.id)).toEqual(["F003", "hr-1"]);
    expect(result.answer.trace_id).toBeTruthy();

    expect(mockedGenerator).toHaveBeenCalledTimes(3);
    const redraftPrompt = mockedGenerator.mock.calls[1]?.[0] as Array<{ content: string }>;
    expect(redraftPrompt.at(-1)?.content).toMatch(/reviewer rejected/i);
    expect(mockedGenerator.mock.calls[0]?.[1]).toMatchObject({ tier: "super" }); // Coaching
    expect(mockedGenerator.mock.calls[2]?.[1]).toMatchObject({ tier: "lightning" }); // Critic
  });

  it("asks CallTypeAgent (Lightning) when the evidence isn't a pure rule answer", async () => {
    mockedRules.mockResolvedValueOnce({ ...rules, call_type_hint: "mixed" });
    mockedGenerator
      .mockResolvedValueOnce(reply({ ...callType, call_type: "mixed" }))
      .mockResolvedValueOnce(reply(goodDraft))
      .mockResolvedValueOnce(reply({ pass: true, issues: [] }));
    const result = await runSituation(request, "2026-10-18");
    expect(result.ok && result.answer.call_type).toBe("mixed");
    expect(mockedGenerator.mock.calls[0]?.[1]).toMatchObject({ tier: "lightning" });
  });

  it(`stops after ${MAX_CRITIC_RETRIES} retries and reports unresolved issues with lower confidence`, async () => {
    for (let i = 0; i <= MAX_CRITIC_RETRIES; i += 1) {
      mockedGenerator
        .mockResolvedValueOnce(reply(goodDraft))
        .mockResolvedValueOnce(reply({ pass: false, issues: ["Tone is too harsh."] }));
    }

    const result = await runSituation(request, "2026-10-18");

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.answer.review?.drafts).toBe(MAX_CRITIC_RETRIES + 1);
    expect(result.answer.review?.passed).toBe(false);
    expect(result.answer.review?.unresolved_issues.join(" ")).toMatch(/Tone is too harsh/);
    expect(result.answer.confidence).toBe(0.4);
    expect(mockedGenerator).toHaveBeenCalledTimes(2 * (MAX_CRITIC_RETRIES + 1));
  });

  it("keeps the last draft if a redraft fails (e.g. a 499), and reports what's unresolved", async () => {
    mockedGenerator
      .mockResolvedValueOnce(reply(draftWithoutDate))
      .mockRejectedValueOnce(Object.assign(new Error("499 The request was aborted before completion."), { status: 499 }));
    const result = await runSituation(request, "2026-10-18");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.answer.review).toMatchObject({ drafts: 1, passed: false });
    expect(result.answer.review?.unresolved_issues.join(" ")).toMatch(/2026-10-22/);
  });

  it("adds a lesson to a ruling after RulesAgent, and requires the life_lesson", async () => {
    const lesson = { id: "L004", title: "Winning comes from a winning formula", principle: "Healthy arms and depth.", life_lesson: "Build people.", for_player: null, for_coach: "Build depth.", for_parent: null, for_umpire: null, tags: ["pitch_count"], source_url: "https://github.com/seanrugg/diamondagentiq", verified: false };
    mockedDev.mockResolvedValueOnce({
      ok: true, focus: "Rest and build depth", insights: [], drills: [], lessons: [lesson], situations: [], story: null,
      evidence: { ok: true, summary: "s", call_type_hint: "rule", computation: null, draft_data: true, missing_facts: [],
        sources: [{ table: "coaching_lessons", id: "L004", rule_ref: null, source_url: lesson.source_url, edition: null, verified: false, synthetic: false, call_type: null, summary: "Winning formula" }] },
    });
    mockedGenerator
      .mockResolvedValueOnce(reply(goodDraft)) // no life_lesson: code check rejects it
      .mockResolvedValueOnce(reply({ ...goodDraft, life_lesson: "Resting her builds another pitcher's confidence; teams win with depth, and so do families." }))
      .mockResolvedValueOnce(reply({ pass: true, issues: [] }));

    const result = await runSituation(request, "2026-10-18");
    expect(mockedDev).toHaveBeenCalledWith(request, context, "ruling", expect.stringMatching(/October 22/));
    expect(mockedRules.mock.invocationCallOrder[0]).toBeLessThan(mockedDev.mock.invocationCallOrder[0] ?? 0);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.answer.review?.drafts).toBe(2);
    expect(result.answer.sources.map((s) => s.id)).toEqual(["F003", "hr-1", "L004"]);
    expect(result.answer.life_lesson?.lessons[0]?.title).toBe("Winning comes from a winning formula");
    expect(result.answer.life_lesson?.text).toMatch(/depth/);
    expect(result.answer.computation).toMatchObject({ earliest_eligible_date: "2026-10-22" });

    const coachingSystem = (mockedGenerator.mock.calls[0]?.[0] as Array<{ content: string }>)[0]?.content ?? "";
    expect(coachingSystem).toMatch(/arm care/);
    const coachingUser = (mockedGenerator.mock.calls[0]?.[0] as Array<{ content: string }>)[1]?.content ?? "";
    expect(coachingUser).toContain("Computed result");
    expect(coachingUser).toContain("For a coach: Build depth.");
  });

  it("still answers a ruling when DevelopmentAgent throws", async () => {
    mockedDev.mockRejectedValueOnce(new Error("zetaris down"));
    mockedGenerator
      .mockResolvedValueOnce(reply(goodDraft))
      .mockResolvedValueOnce(reply({ pass: true, issues: [] }));
    const result = await runSituation(request, "2026-10-18");
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.answer.life_lesson).toBeUndefined();
  });

  it("turns a thrown error (e.g. a 499 after retries) into a structured error for that stage", async () => {
    mockedContext.mockRejectedValueOnce(Object.assign(new Error("499 The request was aborted before completion."), { status: 499 }));
    const result = await runSituation(request, "2026-10-18");
    expect(result).toMatchObject({ ok: false, error: { stage: "contextAgent", message: expect.stringMatching(/499/) } });
  });

  it("returns a structured error naming the stage that failed", async () => {
    mockedRules.mockResolvedValueOnce({ ok: false, error: { message: "boom", attempts: 2 } });
    const result = await runSituation(request, "2026-10-18");
    expect(result).toMatchObject({ ok: false, error: { stage: "rulesAgent", message: "boom" } });
  });
});
