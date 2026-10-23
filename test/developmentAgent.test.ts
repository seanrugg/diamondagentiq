import { beforeEach, describe, expect, it, vi } from "vitest";
import { generator } from "../src/adapters/llm.js";
import { runAgentRows } from "../src/adapters/dataTools.js";
import { contextAgent } from "../src/agents/contextAgent.js";
import { rulesAgent } from "../src/agents/rulesAgent.js";
import { developmentAgent } from "../src/agents/developmentAgent.js";
import { deterministicChecks } from "../src/agents/criticAgent.js";
import { runSituation } from "../src/orchestrator.js";
import { LEARNING_PHILOSOPHY } from "../src/agents/philosophy.js";
import type { RuleSource } from "../src/schemas/rules.js";

vi.mock("../src/adapters/llm.js", () => ({ generator: vi.fn() }));
vi.mock("../src/adapters/zetaris.js", () => ({ runSql: vi.fn(), runSqlDetailed: vi.fn() }));
vi.mock("../src/adapters/dataTools.js", () => ({ runAgentRows: vi.fn(), run_sql: {} }));
vi.mock("../src/agents/contextAgent.js", () => ({ contextAgent: vi.fn() }));
vi.mock("../src/agents/rulesAgent.js", () => ({ rulesAgent: vi.fn() }));

const mockedGenerator = generator as unknown as ReturnType<typeof vi.fn>;
const mockedRows = runAgentRows as unknown as ReturnType<typeof vi.fn>;
const mockedContext = contextAgent as unknown as ReturnType<typeof vi.fn>;
const mockedRules = rulesAgent as unknown as ReturnType<typeof vi.fn>;

const reply = (value: unknown) => ({ content: JSON.stringify(value), toolCalls: [], reasoning: null, model: "m", provider: "meterless" as const });

const request = {
  question: "My son struck out to end the game. 3 straight pitches. They were probably outside. What can I do to help him overcome that failure?",
  role: "parent" as const,
  sport: "baseball" as const,
  sanction: "little_league",
  age: 10,
};
const context = { intent: "development" as const, sport: "baseball" as const, sanction: "little_league", age: 10, topic: "strikeout recovery", entities: {}, missing_facts: [] };

// Zetaris returns strings.
const insightRows = [
  { insight_code: "C001", topic: "plate_coverage", audience: "all", situation: "Strikes out on pitches away", insight: "Crowd the plate.", why: "Reach the outer edge.", try_this: "Bat-length check.", source_id: "DIQ-SME", verified: "false", url: "https://github.com/seanrugg/diamondagentiq", title: "Team" },
  { insight_code: "C006", topic: "parent_support", audience: "parent", situation: "After a tough game", insight: "Let your child speak first.", why: null, try_this: null, source_id: "DIQ-SME", verified: "false", url: "https://github.com/seanrugg/diamondagentiq", title: "Team" },
];
const drillRows = [{ id: "d-1", skill: "two_strike_hitting", title: "Tee: two-strike outside corner", description: "Shorter swing to the outer half.", setting: "individual", safety_notes: "Helmet on.", reviewed: "false" }];

const URL = "https://github.com/seanrugg/diamondagentiq";
const lessonRows = [
  { lesson_code: "L002", title: "Everyone makes mistakes; own yours and learn from it", principle: "We are all human.", life_lesson: "Owning mistakes lasts.", for_player: "Say that's on me.", for_coach: null, for_parent: "Show your child how to own a mistake.", for_umpire: null, tags: "mistake;blame", verified: "false", url: URL },
  { lesson_code: "L003", title: "Believe in your players", principle: "Feed them confidence.", life_lesson: "People rise to belief.", for_player: null, for_coach: null, for_parent: "Tell them you love watching them play.", for_umpire: null, tags: "confidence;scared_hitter", verified: "false", url: URL },
];
const situationRows = [{ situation_code: "SIT003", name: "Dropped third strike, runner on third, 1 out", topic: "dropped_third_strike", offense: "Run.", defense: "Check the runner.", common_mistakes: null, rule_fact_codes: "F034;F148", lesson_codes: "L005", verified: "false", url: URL }];
const storyRows = [{ story_code: "ST001", title: "The playoff game nobody scripted", story: "The kid ran.", lesson_codes: "L003", situation_codes: "SIT003", verified: "false", url: URL }];

const pick = { lesson_ids: ["L003", "L999"], story_id: "ST001", situation_ids: [], insight_ids: ["C001", "C006", "C999"], drill_ids: ["d-1", "nope"], focus: "Cover the outer half", call_type_hint: "judgment" };
const draft = {
  what_happened: "Striking out to end a game stings. Whether those pitches were strikes was the umpire's call; what he controls is where he stands and how ready he is. This guidance comes from draft coaching notes that haven't been reviewed yet.",
  channel: { who: "You, then his coach", how: "Let him talk first on the ride home; ask the coach later in the week about plate coverage." },
  teachable_moment: "One at-bat is information, not a verdict.",
  improvement_plan: { individual: ["Bat-length check before each at-bat."], team: ["Two-strike rounds."], at_home: ["Tell him you love watching him play."] },
  life_lesson: "Your belief in him matters most when he's struggling, on the field and off it.",
};

beforeEach(() => {
  mockedGenerator.mockReset();
  mockedRows.mockReset().mockImplementation(async (sql: string) =>
    sql.includes("coaching_insights") ? insightRows
    : sql.includes("coaching_lessons") ? lessonRows
    : sql.includes("coaching_situations") ? situationRows
    : sql.includes("coaching_stories") ? storyRows
    : drillRows);
  mockedContext.mockReset().mockResolvedValue({ ok: true, context });
  mockedRules.mockReset();
});

describe("developmentAgent", () => {
  it("filters by sport and age in SQL and keeps only picks from the menu", async () => {
    mockedGenerator.mockResolvedValueOnce(reply(pick));
    const result = await developmentAgent(request, context);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.insights.map((i) => i.id)).toEqual(["C001", "C006"]);
    expect(result.lessons.map((l) => l.id)).toEqual(["L003"]);
    expect(result.lessons[0]?.tags).toEqual(["confidence", "scared_hitter"]);
    expect(result.story?.id).toBe("ST001");
    expect(result.evidence.sources.map((s) => s.table)).toEqual(["coaching_lessons", "coaching_stories", "coaching_insights", "coaching_insights"]);
    expect(result.drills.map((d) => d.id)).toEqual(["d-1"]);
    expect(result.evidence.draft_data).toBe(true); // verified "false" string from Zetaris
    expect(result.evidence.computation).toBeNull();

    const insightSql = mockedRows.mock.calls.find(([sql]) => String(sql).includes("coaching_insights"))?.[0] as string;
    expect(insightSql).toContain("c.sport IN ('both', 'baseball')");
    expect(insightSql).toContain("c.age_min <= 10");
    expect(insightSql).toContain("c.age_max >= 10");
    expect(mockedGenerator.mock.calls[0]?.[1]).toMatchObject({ tier: "lightning" });
  });

  it("fails when the model picks no lesson that was on the menu", async () => {
    mockedGenerator.mockResolvedValueOnce(reply({ ...pick, lesson_ids: ["L999"] }));
    const result = await developmentAgent(request, context);
    expect(result).toMatchObject({ ok: false });
  });
});

describe("runSituation, development intent", () => {
  it("skips RulesAgent, feeds insights and the philosophy to CoachingAgent, and returns the focus", async () => {
    mockedGenerator
      .mockResolvedValueOnce(reply(pick)) // DevelopmentAgent
      .mockResolvedValueOnce(reply({ call_type: "judgment", rationale: "Balls and strikes are the umpire's judgment.", judgment_parts: ["strike calls"], rule_parts: [] }))
      .mockResolvedValueOnce(reply(draft)) // CoachingAgent
      .mockResolvedValueOnce(reply({ pass: true, issues: [] })); // CriticAgent

    const result = await runSituation(request, "2026-10-23");
    expect(mockedRules).not.toHaveBeenCalled();
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.answer.intent).toBe("development");
    expect(result.answer.focus).toBe("Cover the outer half");
    expect(result.answer.call_type).toBe("judgment");
    expect(result.answer.sources.map((s) => s.id)).toEqual(["L003", "ST001", "C001", "C006"]);
    expect(result.answer.story).toEqual({ id: "ST001", title: "The playoff game nobody scripted", story: "The kid ran." });
    expect(result.answer.life_lesson?.text).toMatch(/belief/);
    expect(result.answer.confidence).toBe(0.6);

    const coachingMessages = mockedGenerator.mock.calls[2]?.[0] as Array<{ content: string }>;
    expect(coachingMessages[0]?.content).toContain(LEARNING_PHILOSOPHY);
    expect(coachingMessages[0]?.content).toMatch(/development question/);
    expect(coachingMessages[1]?.content).toContain("Crowd the plate.");
    expect(coachingMessages[1]?.content).toContain("Tee: two-strike outside corner");
    expect(coachingMessages[1]?.content).not.toMatch(/Computed result/);
    expect(coachingMessages[1]?.content).toContain("For a parent: Tell them you love watching them play.");
    expect(coachingMessages[0]?.content).toMatch(/life_lesson/);
  });

  it("asks for a draft-notes disclosure in coaching wording", () => {
    const evidence = { ok: true as const, summary: "s", call_type_hint: "judgment" as const, computation: null, draft_data: true, missing_facts: [],
      sources: [{ table: "coaching_insights" as RuleSource["table"], id: "C001", rule_ref: null, source_url: "https://x.org", edition: null, verified: false, synthetic: false }] };
    const noDisclosure = { ...draft, what_happened: "Striking out stings. The umpire made the call." };
    expect(deterministicChecks(noDisclosure, evidence).join(" ")).toMatch(/draft coaching notes/);
    expect(deterministicChecks(draft, evidence)).toEqual([]);
    expect(deterministicChecks({ ...draft, life_lesson: " " }, evidence, true).join(" ")).toMatch(/life_lesson/);
  });
});
