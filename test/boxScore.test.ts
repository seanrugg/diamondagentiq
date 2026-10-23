import { describe, expect, it } from "vitest";
import { checkBoxScore, inningsToOuts, teamStats } from "../src/calculators/boxScore.js";
import { demo } from "./fixtures/boxScoreDemo.js";

describe("box score math", () => {
  it("reads innings notation", () => {
    expect(inningsToOuts("4.0")).toBe(12);
    expect(inningsToOuts("3.2")).toBe(11);
    expect(inningsToOuts("3.5")).toBeNull();
  });

  it("finds no issues in a consistent box score", () => {
    expect(checkBoxScore(demo)).toEqual([]);
  });

  it("catches a misread digit", () => {
    const misread = { ...demo, batting: demo.batting.map((b, i) => (i === 3 ? { ...b, so: 3 } : b)) };
    expect(checkBoxScore(misread).join(" ")).toMatch(/Batting SO adds to 10, but the totals row says 9/);
    const badRuns = { ...demo, line_score: { ...demo.line_score, away: [0, 1, 0, 2, 0, 2] } };
    expect(checkBoxScore(badRuns).join(" ")).toMatch(/Away line score innings add to 5/);
  });

  it("computes team stats in code", () => {
    const s = teamStats(demo);
    expect(s).toMatchObject({ result: "loss", runs_for: 3, runs_against: 4, plate_appearances: 26, strikeouts: 9, walks: 3, errors_committed: 2, pitches: 105, outs_recorded: 18, pitches_per_inning: 17.5, walks_allowed: 3 });
    expect(s.strikeout_rate).toBeCloseTo(0.346, 3);
    expect(s.on_base_rate).toBeCloseTo(0.346, 3);
    expect(s.big_innings_against).toEqual([{ inning: 4, runs: 2 }]);
  });
});
