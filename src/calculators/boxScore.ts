/**
 * Deterministic box-score math (AGENTS.md rule 4): consistency checks on what
 * ScorebookAgent read, and the team stats GameReviewAgent reasons from.
 * Pure: no I/O.
 */
import type { BoxScore, PitchingLine } from "../schemas/boxScore.js";

/** "4.0" -> 12 outs, "3.2" -> 11 outs. Returns null for anything else. */
export function inningsToOuts(ip: string): number | null {
  const m = /^(\d+)(?:\.([012]))?$/.exec(ip.trim());
  if (!m) return null;
  return Number(m[1]) * 3 + Number(m[2] ?? 0);
}

const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);

/**
 * Every place the box score should agree with itself. A failed check usually
 * means a misread digit, so the agent gets one chance to re-read.
 */
export function checkBoxScore(bs: BoxScore): string[] {
  const issues: string[] = [];
  const ls = bs.line_score;
  if (sum(ls.away) !== ls.away_rhe.r) issues.push(`Away line score innings add to ${sum(ls.away)}, but R is ${ls.away_rhe.r}.`);
  if (sum(ls.home) !== ls.home_rhe.r) issues.push(`Home line score innings add to ${sum(ls.home)}, but R is ${ls.home_rhe.r}.`);

  const statsIsHome = norm(bs.stats_team) === norm(bs.home_team) || norm(bs.home_team).includes(norm(bs.stats_team)) || norm(bs.stats_team).includes(norm(bs.home_team));
  const own = statsIsHome ? ls.home_rhe : ls.away_rhe;
  const opp = statsIsHome ? ls.away_rhe : ls.home_rhe;

  const bat = {
    ab: sum(bs.batting.map((b) => b.ab)), r: sum(bs.batting.map((b) => b.r)), h: sum(bs.batting.map((b) => b.h)),
    rbi: sum(bs.batting.map((b) => b.rbi)), bb: sum(bs.batting.map((b) => b.bb)), so: sum(bs.batting.map((b) => b.so)),
  };
  if (bs.batting_totals) {
    for (const k of ["ab", "r", "h", "rbi", "bb", "so"] as const) {
      if (bat[k] !== bs.batting_totals[k]) issues.push(`Batting ${k.toUpperCase()} adds to ${bat[k]}, but the totals row says ${bs.batting_totals[k]}.`);
    }
  }
  if (bat.r !== own.r) issues.push(`Batters scored ${bat.r} runs, but the line score gives ${bs.stats_team} ${own.r}.`);
  if (bat.h !== own.h) issues.push(`Batters had ${bat.h} hits, but the line score gives ${bs.stats_team} ${own.h}.`);

  const pit = { h: sum(bs.pitching.map((p) => p.h)), r: sum(bs.pitching.map((p) => p.r)) };
  if (pit.h !== opp.h) issues.push(`Pitchers allowed ${pit.h} hits, but the line score gives the opponent ${opp.h}.`);
  if (pit.r !== opp.r) issues.push(`Pitchers allowed ${pit.r} runs, but the line score gives the opponent ${opp.r}.`);
  for (const p of bs.pitching) {
    if (inningsToOuts(p.ip) === null) issues.push(`${p.player}'s innings "${p.ip}" isn't a valid innings figure.`);
    if (p.er > p.r) issues.push(`${p.player} has more earned runs (${p.er}) than runs (${p.r}).`);
  }
  return issues;
}

function norm(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]/g, "");
}

export type TeamStats = {
  result: "win" | "loss" | "tie";
  runs_for: number;
  runs_against: number;
  plate_appearances: number;
  hits: number;
  walks: number;
  strikeouts: number;
  strikeout_rate: number; // per plate appearance (AB + BB)
  on_base_rate: number; // (H + BB) / (AB + BB)
  batting_average: number;
  errors_committed: number;
  pitches: number | null;
  outs_recorded: number;
  pitches_per_inning: number | null;
  walks_allowed: number;
  strikeouts_pitched: number;
  /** Runs allowed by inning, to find the big innings. */
  big_innings_against: { inning: number; runs: number }[];
};

const round = (x: number, d = 3) => Math.round(x * 10 ** d) / 10 ** d;

export function teamStats(bs: BoxScore): TeamStats {
  const ls = bs.line_score;
  const statsIsHome = norm(bs.home_team).includes(norm(bs.stats_team)) || norm(bs.stats_team).includes(norm(bs.home_team));
  const own = statsIsHome ? ls.home_rhe : ls.away_rhe;
  const opp = statsIsHome ? ls.away_rhe : ls.home_rhe;
  const oppInnings = statsIsHome ? ls.away : ls.home;

  const ab = sum(bs.batting.map((b) => b.ab));
  const h = sum(bs.batting.map((b) => b.h));
  const bb = sum(bs.batting.map((b) => b.bb));
  const so = sum(bs.batting.map((b) => b.so));
  const pa = ab + bb;
  const pitchCounts = bs.pitching.map((p) => p.pitches);
  const pitches = pitchCounts.every((p) => p !== null) ? sum(pitchCounts as number[]) : null;
  const outs = sum(bs.pitching.map((p: PitchingLine) => inningsToOuts(p.ip) ?? 0));

  return {
    result: own.r > opp.r ? "win" : own.r < opp.r ? "loss" : "tie",
    runs_for: own.r,
    runs_against: opp.r,
    plate_appearances: pa,
    hits: h,
    walks: bb,
    strikeouts: so,
    strikeout_rate: pa ? round(so / pa) : 0,
    on_base_rate: pa ? round((h + bb) / pa) : 0,
    batting_average: ab ? round(h / ab) : 0,
    errors_committed: own.e,
    pitches,
    outs_recorded: outs,
    pitches_per_inning: pitches !== null && outs ? round(pitches / (outs / 3), 1) : null,
    walks_allowed: sum(bs.pitching.map((p) => p.bb)),
    strikeouts_pitched: sum(bs.pitching.map((p) => p.so)),
    big_innings_against: oppInnings.map((runs, i) => ({ inning: i + 1, runs })).filter((x) => x.runs >= 2),
  };
}
