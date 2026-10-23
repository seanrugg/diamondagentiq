import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { looksLikePlayByPlay, parsePlayByPlay, pbpTeamStats, pitchesIn } from "../src/calculators/playByPlay.js";

const game = (g: string) =>
  readFileSync(new URL(`../data/samples/season/play_by_play/${g}_play_by_play.txt`, import.meta.url), "utf8");
const GAMES = ["G03", "G04", "G07", "G09"];

describe("play-by-play parser", () => {
  it.each(GAMES)("%s: runs by inning add up to the final and match the line score", (g) => {
    const r = parsePlayByPlay(game(g));
    expect(r.issues).toEqual([]);
    for (const t of [r.away, r.home]) {
      expect(t.runs_by_inning.reduce((a, b) => a + b, 0)).toBe(t.runs);
    }
  });

  it("reads G03: WRN 2 at TAL 12, run-rule finish with 2 outs in the bottom of the 5th", () => {
    const r = parsePlayByPlay(game("G03"));
    expect([r.away.abbr, r.away.runs, r.home.abbr, r.home.runs]).toEqual(["WRN", 2, "TAL", 12]);
    expect(r.home.runs_by_inning).toEqual([5, 0, 3, 1, 3]);
    expect(r.innings).toBe(5);
    expect(r.final_outs_in_last_half).toBe(2);
    expect(r.home.batting.big_innings).toEqual([{ inning: 1, runs: 5 }]);
  });

  it("counts strikeouts (dropped third strikes included) and called third strikes", () => {
    const g04 = parsePlayByPlay(game("G04"));
    expect(g04.home.batting.strikeouts).toBe(16); // WRN batting at home
    expect(g04.home.batting.strikeouts_looking).toBe(8);
    expect(g04.away.batting.strikeouts).toBe(10);
  });

  it("totals WRN's first-pitch called strikes across the four games", () => {
    const wrn = GAMES.map((g) => parsePlayByPlay(game(g))).map((r) => (r.away.abbr === "WRN" ? r.away : r.home));
    expect(wrn.reduce((n, t) => n + t.batting.first_pitch_called_strikes, 0)).toBe(23);
    expect(wrn.reduce((n, t) => n + t.batting.strikeouts, 0)).toBe(35);
  });

  it("finds the rule moments: balk, interference, dropped third strikes, courtesy runners, run cap", () => {
    const kinds = (g: string) => parsePlayByPlay(game(g)).rule_moments.map((m) => m.kind);
    expect(kinds("G09")).toContain("balk");
    expect(kinds("G03")).toContain("offensive_interference");
    expect(kinds("G03")).toContain("courtesy_runner");
    expect(kinds("G07")).toContain("inning_run_cap");
    expect(GAMES.flatMap(kinds).filter((k) => k === "dropped_third_strike")).toHaveLength(4);
  });

  it("batters faced by one team equals the other team's plate appearances", () => {
    for (const g of GAMES) {
      const r = parsePlayByPlay(game(g));
      expect(r.home.pitching.batters_faced).toBe(r.away.batting.plate_appearances);
      expect(r.away.pitching.batters_faced).toBe(r.home.batting.plate_appearances);
    }
  });

  it("reads pitch tokens and skips base-running notes", () => {
    expect(pitchesIn("Ball 1, #19 A steals 2nd, Strike 1 looking, Foul, Foul tip, Strike 3 swinging.")).toEqual([
      "ball",
      "called",
      "foul",
      "foul",
      "swinging",
    ]);
  });

  it("handles \\r\\n line endings and flags a line score that disagrees", () => {
    const text = game("G03").replace(/\n/g, "\r\n").replace("TAL | 5 | 0 | 3 | 1 | 3 | 12", "TAL | 5 | 0 | 3 | 1 | 3 | 13");
    const r = parsePlayByPlay(text);
    expect(r.home.runs).toBe(12);
    expect(r.issues.join(" ")).toMatch(/line score says 13/);
  });

  it("turns one side into review stats, matched by name or abbreviation", () => {
    const r = parsePlayByPlay(game("G03"));
    const s = pbpTeamStats(r, "Wrenmoor Wolves");
    expect(s && [s.result, s.runs_for, s.runs_against, s.outs_recorded, s.pitches, s.pitches_per_inning]).toEqual(["loss", 2, 12, 14, 103, 22.1]);
    expect(s?.strikeouts_looking).toBe(3);
    expect(s?.big_innings_against.map((b) => b.inning)).toEqual([1, 3, 5]);
    expect(pbpTeamStats(r, "tal")?.result).toBe("win");
    expect(pbpTeamStats(r, "Demo Hawks")).toBeNull();
  });

  it("detects the format and rejects text without a header", () => {
    expect(looksLikePlayByPlay(game("G07"))).toBe(true);
    expect(looksLikePlayByPlay("Demo Hawks 5, Riverside Comets 3")).toBe(false);
    expect(() => parsePlayByPlay("[T1] Walk | Ball 1 | x | Outs: 0 | A 0 – B 0")).toThrow(/first line/);
  });
});
