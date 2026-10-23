import { beforeEach, describe, expect, it, vi } from "vitest";
import { generator } from "../src/adapters/llm.js";
import { runAgentRows } from "../src/adapters/dataTools.js";
import { openMemory } from "../src/adapters/hmem.js";
import { runGameReview } from "../src/gameReview.js";
import { demo } from "./fixtures/boxScoreDemo.js";

vi.mock("../src/adapters/llm.js", () => ({ generator: vi.fn() }));
vi.mock("../src/adapters/zetaris.js", () => ({ runSql: vi.fn(), runSqlDetailed: vi.fn() }));
vi.mock("../src/adapters/dataTools.js", () => ({ runAgentRows: vi.fn(), run_sql: {} }));

const mockedGenerator = generator as unknown as ReturnType<typeof vi.fn>;
const mockedRows = runAgentRows as unknown as ReturnType<typeof vi.fn>;
const reply = (v: unknown) => ({ content: JSON.stringify(v), toolCalls: [], reasoning: null, model: "m", requested_model: "m", finish_reason: "stop", retries: 0, provider: "meterless" as const });

const URL = "https://github.com/seanrugg/diamondagentiq";
const tiers = [
  { age_min: "11", age_max: "12", pitches_min: "1", pitches_max: "20", rest_days: "0" },
  { age_min: "11", age_max: "12", pitches_min: "21", pitches_max: "35", rest_days: "1" },
  { age_min: "11", age_max: "12", pitches_min: "36", pitches_max: "50", rest_days: "2" },
  { age_min: "11", age_max: "12", pitches_min: "51", pitches_max: "65", rest_days: "3" },
  { age_min: "11", age_max: "12", pitches_min: "66", pitches_max: "85", rest_days: "4" },
];

beforeEach(() => {
  mockedGenerator.mockReset();
  mockedRows.mockReset().mockImplementation(async (sql: string) =>
    sql.includes("pitch_rest_rules") ? tiers
    : sql.includes("coaching_lessons") ? [{ lesson_code: "L008", title: "A game built on failure", principle: "70% failure.", life_lesson: "Keep going.", tags: "failure", verified: "false", url: URL }]
    : sql.includes("coaching_insights") ? [{ insight_code: "C003", topic: "two_strike_approach", audience: "player", situation: "Two strikes", insight: "Protect the zone.", why: null, try_this: null, source_id: "DIQ-SME", verified: "false", url: URL, title: "Team" }]
    : [{ id: "d-1", skill: "two_strike_hitting", title: "Tee: two-strike outside corner", description: "Shorter swing.", setting: "individual", safety_notes: "Helmet on.", reviewed: "false" }]);
});

const request = { image: "data:image/png;base64,AAAA", role: "coach" as const, sport: "baseball" as const, sanction: "little_league", age: 12, team: "Demo Hawks" };
const draft = {
  headline: "A one-run loss with a lot to build on",
  what_decided_it: ["The 4th inning, when the Comets scored 2.", "9 strikeouts in 26 plate appearances."],
  strengths: ["Our pitchers walked only 3."],
  priorities: [{ title: "Two-strike approach", why: "We struck out in 35% of plate appearances.", drill_ids: ["d-1"], insight_ids: ["C003"] }],
  lesson_id: "L008",
  team_talk: "We lost as a team by one run. We'll get better together.",
  at_home: ["Ten dry swings choking up."],
};

describe("runGameReview", () => {
  it("re-reads once when totals disagree, computes stats and rest in code, and passes review", async () => {
    const misread = { ...demo, batting: demo.batting.map((b, i) => (i === 3 ? { ...b, so: 3 } : b)) };
    mockedGenerator
      .mockResolvedValueOnce(reply(misread)) // read 1: one digit wrong
      .mockResolvedValueOnce(reply(demo)) // re-read
      .mockResolvedValueOnce(reply(draft)) // GameReviewAgent
      .mockResolvedValueOnce(reply({ pass: true, issues: [] })); // Critic

    const hmem = openMemory({ clock: () => 1_790_000_000_000 });
    const result = await runGameReview(request, "2026-10-23", { memory: hmem });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const a = result.answer;
    expect(a.read).toEqual({ reads: 2, issues: [] });
    expect(a.pitcher_rest).toEqual([
      { player: "J Ortiz #12", pitches: 71, rest_days: 4, eligible_again: "2026-10-22", note: null },
      { player: "M Chen #7", pitches: 34, rest_days: 1, eligible_again: "2026-10-19", note: null },
    ]);
    expect(a.stats).toMatchObject({ strikeouts: 9, result: "loss" });
    expect(a.priorities[0]?.drills[0]?.title).toBe("Tee: two-strike outside corner");
    expect(a.lesson?.title).toBe("A game built on failure");
    expect(a.review).toEqual({ drafts: 1, passed: true, unresolved_issues: [] });
    expect(a.synthetic_input).toBe(true);
    expect(a.memory?.saved).toHaveLength(1);
    expect(hmem.store.all()[0]?.content).toMatch(/loss 3-4 vs Riverside Comets/);

    // The image goes to the Super (VL) tier; the critic runs on the judge tier.
    const first = mockedGenerator.mock.calls[0];
    expect(first?.[1]).toMatchObject({ tier: "super", agent: "scorebookAgent" });
    expect(JSON.stringify(first?.[0])).toContain("image_url");
    expect(JSON.stringify(mockedGenerator.mock.calls[1]?.[0])).toMatch(/Batting SO adds to 10/);
    expect(mockedGenerator.mock.calls[3]?.[1]).toMatchObject({ tier: "judge" });
  });

  it("explains what to do when Nightshift has no vision lane", async () => {
    mockedGenerator.mockRejectedValueOnce(Object.assign(new Error("400 this box cannot serve vision: no lane carries the vision capability"), { status: 400 }));
    const result = await runGameReview(request, "2026-10-23");
    expect(result).toMatchObject({ ok: false, error: { stage: "scorebookAgent", message: expect.stringMatching(/Paste the box score as text/) } });
  });

  it("sends a draft back when it cites a drill that isn't on the menu", async () => {
    mockedGenerator
      .mockResolvedValueOnce(reply(demo))
      .mockResolvedValueOnce(reply({ ...draft, priorities: [{ ...draft.priorities[0], drill_ids: ["made-up"] }] }))
      .mockResolvedValueOnce(reply(draft))
      .mockResolvedValueOnce(reply({ pass: true, issues: [] }));
    const result = await runGameReview(request, "2026-10-23");
    expect(result.ok && result.answer.review.drafts).toBe(2);
    const redraft = JSON.stringify(mockedGenerator.mock.calls[2]?.[0]);
    expect(redraft).toMatch(/Drill made-up is not on the drill menu/);
  });
});
