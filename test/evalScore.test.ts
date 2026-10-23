import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { EvalFileSchema, scoreAnswer } from "../src/evals/score.js";
import type { SituationAnswer } from "../src/schemas/situation.js";
import { SituationRequestSchema } from "../src/schemas/situation.js";

const answer: SituationAnswer = {
  what_happened: { summary: "That call belonged to the umpire. Try moving closer to the plate.", sources: [] },
  call_type: "judgment",
  call_type_rationale: "Balls and strikes.",
  channel: { who: "You", how: "Let him talk first." },
  teachable_moment: "One at-bat is information.",
  improvement_plan: { individual: [], team: [], at_home: [] },
  confidence: 0.6,
  sources: [{ table: "coaching_lessons", id: "L003", source_url: "https://x.org", verified: false }],
  missing_facts: [],
  trace_id: "t",
  intent: "development",
  life_lesson: { text: "Your belief matters.", lessons: [] },
};

describe("scoreAnswer", () => {
  it("passes and fails checks on intent, citations, mentions and phrases to avoid", () => {
    const results = scoreAnswer(answer, {
      intent: "development",
      call_type: "judgment",
      cites: ["coaching_lessons", "rules_facts"],
      mentions_any: [["umpire"], ["crowd the plate", "closer to the plate"], ["drill"]],
      avoid: ["bad call", "umpire"],
    });
    const failed = results.filter((r) => !r.pass).map((r) => r.check);
    expect(failed).toEqual(["cites rules_facts", "mentions one of: drill", 'avoids "umpire"']);
    expect(results.find((r) => r.check.startsWith("mentions one of: crowd"))?.detail).toBe("closer to the plate");
  });

  it("checks computed values", () => {
    const withComp = { ...answer, computation: { earliest_eligible_date: "2026-10-22", eligible_on_game_date: false } };
    expect(scoreAnswer(withComp, { cites: [], mentions_any: [], avoid: [], computation: { earliest_eligible_date: "2026-10-22", eligible_on_game_date: false } }).every((r) => r.pass)).toBe(true);
    expect(scoreAnswer(answer, { cites: [], mentions_any: [], avoid: [], computation: { earliest_eligible_date: "2026-10-22" } })[0]?.pass).toBe(false);
  });

  it("keeps data/evals/questions.json valid", () => {
    const file = EvalFileSchema.parse(JSON.parse(readFileSync(new URL("../data/evals/questions.json", import.meta.url), "utf8")));
    for (const q of file.questions) expect(() => SituationRequestSchema.parse(q.request)).not.toThrow();
    expect(new Set(file.questions.map((q) => q.id)).size).toBe(file.questions.length);
  });
});
