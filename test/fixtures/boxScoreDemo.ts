import { BoxScoreSchema, type BoxScore } from "../../src/schemas/boxScore.js";

// Matches data/samples/box-score-demo.png (synthetic).
export const demo: BoxScore = BoxScoreSchema.parse({
  away_team: "Riverside Comets", home_team: "Demo Hawks", date: "2026-10-17", event: "Fall Classic 12U",
  line_score: { away: [0, 1, 0, 2, 0, 1], home: [1, 0, 0, 2, 0, 0], away_rhe: { r: 4, h: 7, e: 1 }, home_rhe: { r: 3, h: 6, e: 2 } },
  stats_team: "Demo Hawks",
  batting: [
    { player: "A Rivera #2", ab: 3, r: 1, h: 1, rbi: 0, bb: 1, so: 0 },
    { player: "J Ortiz #12", ab: 3, r: 1, h: 2, rbi: 1, bb: 0, so: 0 },
    { player: "M Chen #7", ab: 3, r: 0, h: 1, rbi: 1, bb: 0, so: 1 },
    { player: "D Park #21", ab: 3, r: 0, h: 0, rbi: 0, bb: 0, so: 2 },
    { player: "L Brooks #5", ab: 2, r: 1, h: 1, rbi: 0, bb: 1, so: 0 },
    { player: "S Patel #9", ab: 3, r: 0, h: 0, rbi: 0, bb: 0, so: 2 },
    { player: "T Nguyen #14", ab: 2, r: 0, h: 1, rbi: 1, bb: 0, so: 1 },
    { player: "R Diaz #3", ab: 2, r: 0, h: 0, rbi: 0, bb: 1, so: 1 },
    { player: "K Moore #18", ab: 2, r: 0, h: 0, rbi: 0, bb: 0, so: 2 },
  ],
  batting_totals: { ab: 23, r: 3, h: 6, rbi: 3, bb: 3, so: 9 },
  pitching: [
    { player: "J Ortiz #12", ip: "4.0", h: 5, r: 3, er: 2, bb: 2, so: 4, pitches: 71 },
    { player: "M Chen #7", ip: "2.0", h: 2, r: 1, er: 1, bb: 1, so: 3, pitches: 34 },
  ],
  pitching_totals: { ip: "6.0", h: 7, r: 4, er: 3, bb: 3, so: 7, pitches: 105 },
});

