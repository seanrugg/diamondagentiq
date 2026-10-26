/**
 * Deterministic play-by-play parser (AGENTS.md rule 4: code does the math).
 *
 * Input: the one-event-per-line text format of data/samples/season/play_by_play:
 *   G03 — Away Team (AWY, away) at Home Team (HOM, home)
 *   TOP 1 — Away Team batting
 *   [T1] Strikeout | Ball 1, Strike 1 swinging, ... | description | Outs: 1 | AWY 0 – HOM 0
 *   ...
 *   LINE SCORE
 *   AWY | 0 | 1 | ... | R
 *
 * Output: per-team batting and pitching facts the GameReviewAgent can talk
 * about, plus the rule moments found in the text. The model never counts.
 */
import { z } from "zod";
import type { TeamStats } from "./boxScore.js";

export const PbpTeamSchema = z.object({
  name: z.string(),
  abbr: z.string(),
  side: z.enum(["away", "home"]),
  runs: z.number().int(),
  runs_by_inning: z.array(z.number().int()),
  batting: z.object({
    plate_appearances: z.number().int(),
    hits: z.number().int(),
    walks: z.number().int(),
    hit_by_pitch: z.number().int(),
    strikeouts: z.number().int(),
    strikeouts_looking: z.number().int(),
    reached_on_error: z.number().int(),
    sacrifices: z.number().int(),
    first_pitch_called_strikes: z.number().int(),
    first_pitch_swings: z.number().int(),
    first_pitch_balls: z.number().int(),
    two_strike_pas: z.number().int(),
    stolen_bases: z.number().int(),
    caught_stealing: z.number().int(),
    big_innings: z.array(z.object({ inning: z.number().int(), runs: z.number().int() })),
  }),
  /** This team's pitching and defense (while the other team batted). */
  pitching: z.object({
    pitches: z.number().int(),
    strikes: z.number().int(),
    batters_faced: z.number().int(),
    outs_recorded: z.number().int(),
    first_pitch_strikes: z.number().int(),
    walks: z.number().int(),
    hit_by_pitch: z.number().int(),
    wild_pitches: z.number().int(),
    passed_balls: z.number().int(),
    errors: z.number().int(),
    pitches_by_inning: z.array(z.number().int()),
  }),
});

export const RuleMomentSchema = z.object({
  kind: z.enum([
    "dropped_third_strike",
    "balk",
    "offensive_interference",
    "courtesy_runner",
    "inning_run_cap",
    "pickoff_out",
  ]),
  half: z.string(),
  batting_team: z.string(),
  text: z.string(),
});

export const PlayByPlaySchema = z.object({
  game: z.string(),
  away: PbpTeamSchema,
  home: PbpTeamSchema,
  innings: z.number().int(),
  final_outs_in_last_half: z.number().int(),
  rule_moments: z.array(RuleMomentSchema),
  /** Problems found while checking the text; empty when it is consistent. */
  issues: z.array(z.string()),
});

export type PlayByPlay = z.infer<typeof PlayByPlaySchema>;
export type PbpTeam = z.infer<typeof PbpTeamSchema>;

const EVENT_LINE = /^\[([TB])(\d+)\]\s*([^|]+?)\s*\|\s*([^|]*?)\s*\|\s*(.*?)\s*\|\s*Outs:\s*(\d)\s*\|\s*(.+)$/;
const HEADER = /^(\S+)\s+[—-]\s+(.+?)\s+\((\w+),\s*away\)\s+at\s+(.+?)\s+\((\w+),\s*home\)/;
const SCORE = /^(\w+)\s+(\d+)\s*[–—-]\s*(\w+)\s+(\d+)\s*$/;
const HITS = new Set(["Single", "Double", "Triple", "Home Run"]);
/** Events that do not finish a plate appearance. */
const NOT_PA = new Set(["Inning Ended", "Runner Out"]);

/** True when the text looks like this play-by-play format. */
/**
 * Text pasted from a markdown file: drop headings, quotes, list markers, bold,
 * italics and code marks around each line, so the same play-by-play reads the
 * same whether it was saved as .txt or .md.
 */
export function stripMarkdown(text: string): string {
  return text
    .split(/\r?\n/)
    .map((l) => l
      .replace(/^\s*(?:#{1,6}\s+|>\s*|[-*+]\s+|\d+[.)]\s+)/, "")
      .replace(/\*\*|__|`/g, "")
      .replace(/(^|\s)[*_](\S)/g, "$1$2")
      .replace(/\\\[/g, "[").replace(/\\\]/g, "]"))
    .join("\n");
}

export function looksLikePlayByPlay(text: string): boolean {
  return stripMarkdown(text).split("\n").filter((l) => /^\[[TB]\d+\]/.test(l.trim())).length >= 3;
}

type Pitch = "ball" | "called" | "swinging" | "foul" | "in_play";

/** Pitch tokens from a sequence; base-running notes in between are skipped. */
export function pitchesIn(sequence: string): Pitch[] {
  const out: Pitch[] = [];
  for (const raw of sequence.split(",")) {
    const t = raw.trim().replace(/\.$/, "");
    if (/^Ball \d/.test(t)) out.push("ball");
    else if (/^Strike \d looking/.test(t)) out.push("called");
    else if (/^Strike \d swinging/.test(t)) out.push("swinging");
    else if (/^Foul( tip)?$/.test(t)) out.push("foul");
    else if (/^In play$/.test(t)) out.push("in_play");
  }
  return out;
}

const count = (text: string, re: RegExp) => (text.match(re) ?? []).length;

function emptyTeam(name: string, abbr: string, side: "away" | "home"): PbpTeam {
  return {
    name,
    abbr,
    side,
    runs: 0,
    runs_by_inning: [],
    batting: {
      plate_appearances: 0,
      hits: 0,
      walks: 0,
      hit_by_pitch: 0,
      strikeouts: 0,
      strikeouts_looking: 0,
      reached_on_error: 0,
      sacrifices: 0,
      first_pitch_called_strikes: 0,
      first_pitch_swings: 0,
      first_pitch_balls: 0,
      two_strike_pas: 0,
      stolen_bases: 0,
      caught_stealing: 0,
      big_innings: [],
    },
    pitching: {
      pitches: 0,
      strikes: 0,
      batters_faced: 0,
      outs_recorded: 0,
      first_pitch_strikes: 0,
      walks: 0,
      hit_by_pitch: 0,
      wild_pitches: 0,
      passed_balls: 0,
      errors: 0,
      pitches_by_inning: [],
    },
  };
}

export function parsePlayByPlay(text: string): PlayByPlay {
  const lines = stripMarkdown(text).split("\n").map((l) => l.trim());
  const header = lines.map((l) => HEADER.exec(l)).find((m) => m);
  if (!header) throw new Error("Play-by-play needs a first line like 'G01 — Away (AWY, away) at Home (HOM, home)'.");
  const [, game, awayName, awayAbbr, homeName, homeAbbr] = header as unknown as string[];
  const away = emptyTeam(awayName!, awayAbbr!, "away");
  const home = emptyTeam(homeName!, homeAbbr!, "home");
  const issues: string[] = [];
  const moments: PlayByPlay["rule_moments"] = [];

  const score: Record<string, number> = { [away.abbr]: 0, [home.abbr]: 0 };
  const halfOuts = new Map<string, number>();
  let lastHalf = "";
  let innings = 0;

  for (const line of lines) {
    const m = EVENT_LINE.exec(line);
    if (!m) continue;
    const [, tb, inn, event, sequence, description, outs, scoreText] = m as unknown as string[];
    const inning = Number(inn);
    innings = Math.max(innings, inning);
    const half = `${tb === "T" ? "Top" : "Bottom"} ${inning}`;
    lastHalf = half;
    const bat = tb === "T" ? away : home;
    const fld = tb === "T" ? home : away;
    const idx = inning - 1;
    while (bat.runs_by_inning.length <= idx) bat.runs_by_inning.push(0);
    while (fld.pitching.pitches_by_inning.length <= idx) fld.pitching.pitches_by_inning.push(0);

    // Runs come from the running score, so runs on wild pitches and steals count too.
    const s = SCORE.exec(scoreText!);
    if (s) {
      const now = { [s[1]!]: Number(s[2]), [s[3]!]: Number(s[4]) };
      const before = score[bat.abbr] ?? 0;
      const after = now[bat.abbr];
      if (after === undefined || now[fld.abbr] === undefined) issues.push(`${half}: score '${scoreText}' doesn't name both teams.`);
      else {
        if (after < before) issues.push(`${half}: ${bat.abbr} score went down (${before} to ${after}).`);
        bat.runs_by_inning[idx]! += after - before;
        if (now[fld.abbr] !== score[fld.abbr]) issues.push(`${half}: the fielding team's score changed.`);
        score[bat.abbr] = after;
      }
    } else issues.push(`${half}: couldn't read the score '${scoreText}'.`);
    halfOuts.set(half, Number(outs));

    const pitches = pitchesIn(sequence!);
    const ev = event!.trim();
    const whole = `${sequence} ${description}`;
    let thrown = pitches.length;
    if (ev === "Hit By Pitch" && !/Ball 4/.test(sequence!)) thrown += 1; // the HBP pitch itself isn't listed
    fld.pitching.pitches += thrown;
    fld.pitching.pitches_by_inning[idx]! += thrown;
    fld.pitching.strikes += pitches.filter((p) => p !== "ball").length;

    bat.batting.stolen_bases += count(whole, /\bsteals \d/g);
    bat.batting.caught_stealing += count(whole, /\bcaught stealing\b/g);
    fld.pitching.wild_pitches += count(whole, /\bon wild pitch\b/g);
    fld.pitching.passed_balls += count(whole, /\bon passed ball\b/g);
    fld.pitching.errors += count(whole, /\berror by\b/g);

    const note = (kind: PlayByPlay["rule_moments"][number]["kind"], t: string) =>
      moments.push({ kind, half, batting_team: bat.name, text: t });
    if (ev === "Dropped 3rd Strike") note("dropped_third_strike", description!);
    for (const t of sequence!.split(",").map((x) => x.trim())) {
      if (/^Balk\b/.test(t)) note("balk", t);
      if (/interference/i.test(t)) note("offensive_interference", t);
      if (/^Courtesy runner/.test(t)) note("courtesy_runner", t);
      if (/picked off/.test(t)) note("pickoff_out", t);
    }
    if (/ended by scorekeeper/i.test(description!)) note("inning_run_cap", description!);

    if (NOT_PA.has(ev)) continue;

    // A finished plate appearance.
    bat.batting.plate_appearances += 1;
    fld.pitching.batters_faced += 1;
    const first = pitches[0];
    if (first === "called") bat.batting.first_pitch_called_strikes += 1;
    else if (first === "ball") bat.batting.first_pitch_balls += 1;
    else if (first) bat.batting.first_pitch_swings += 1;
    if (ev === "Hit By Pitch" && pitches.length === 0) bat.batting.first_pitch_balls += 1;
    if (first && first !== "ball") fld.pitching.first_pitch_strikes += 1;

    let strikes = 0;
    for (const p of pitches) {
      if (p === "called" || p === "swinging") strikes += 1;
      else if (p === "foul" && strikes < 2) strikes += 1;
    }
    if (strikes >= 2) bat.batting.two_strike_pas += 1;

    if (HITS.has(ev)) bat.batting.hits += 1;
    if (ev === "Walk") {
      bat.batting.walks += 1;
      fld.pitching.walks += 1;
    }
    if (ev === "Hit By Pitch") {
      bat.batting.hit_by_pitch += 1;
      fld.pitching.hit_by_pitch += 1;
    }
    if (ev === "Error") bat.batting.reached_on_error += 1;
    if (/^Sacrifice/.test(ev)) bat.batting.sacrifices += 1;
    if (ev === "Strikeout" || ev === "Dropped 3rd Strike") {
      bat.batting.strikeouts += 1;
      if (/Strike 3 looking/.test(sequence!)) bat.batting.strikeouts_looking += 1;
    }
  }

  if (innings === 0) throw new Error("No play-by-play event lines found (lines start with [T1], [B1], ...).");

  for (const t of [away, home]) {
    t.runs = score[t.abbr] ?? 0;
    t.batting.big_innings = t.runs_by_inning
      .map((runs, i) => ({ inning: i + 1, runs }))
      .filter((x) => x.runs >= 4);
  }

  // Every half-inning except the game's last should end with 3 outs.
  for (const [half, outs] of halfOuts) {
    (half.startsWith("Top") ? home : away).pitching.outs_recorded += outs;
    if (half !== lastHalf && outs !== 3) issues.push(`${half} ended with ${outs} outs.`);
  }

  // Cross-check against the LINE SCORE block when present.
  for (const t of [away, home]) {
    const row = lines.find((l) => l.startsWith(`${t.abbr} |`));
    if (!row) continue;
    const cells = row.split("|").slice(1).map((c) => c.trim());
    const total = Number(cells.at(-1));
    if (total !== t.runs) issues.push(`${t.abbr}: line score says ${total} runs, the plays add up to ${t.runs}.`);
    cells.slice(0, -1).forEach((c, i) => {
      if (/^\d+$/.test(c) && Number(c) !== (t.runs_by_inning[i] ?? 0)) {
        issues.push(`${t.abbr} inning ${i + 1}: line score ${c}, plays ${t.runs_by_inning[i] ?? 0}.`);
      }
    });
  }

  return PlayByPlaySchema.parse({
    game: game!,
    away,
    home,
    innings,
    final_outs_in_last_half: halfOuts.get(lastHalf) ?? 0,
    rule_moments: moments,
    issues,
  });
}

/**
 * One team's game in the shape the post-game review uses for a box score
 * (TeamStats), plus the extra counts only a play-by-play has.
 * Returns null when `team` matches neither side.
 */
export function pbpTeamStats(pbp: PlayByPlay, team: string): (TeamStats & PbpExtras & { us: PbpTeam; them: PbpTeam }) | null {
  const want = team.trim().toLowerCase();
  if (!want) return null;
  const hit = (t: PbpTeam) => t.abbr.toLowerCase() === want || t.name.toLowerCase().includes(want) || want.includes(t.name.toLowerCase());
  const us = hit(pbp.away) ? pbp.away : hit(pbp.home) ? pbp.home : null;
  if (!us) return null;
  const them = us === pbp.away ? pbp.home : pbp.away;
  const b = us.batting;
  const p = us.pitching;
  const pa = b.plate_appearances;
  const ab = pa - b.walks - b.hit_by_pitch - b.sacrifices;
  const r3 = (x: number) => Math.round(x * 1000) / 1000;
  return {
    us,
    them,
    result: us.runs > them.runs ? "win" : us.runs < them.runs ? "loss" : "tie",
    runs_for: us.runs,
    runs_against: them.runs,
    plate_appearances: pa,
    hits: b.hits,
    walks: b.walks,
    strikeouts: b.strikeouts,
    strikeout_rate: pa ? r3(b.strikeouts / pa) : 0,
    on_base_rate: pa ? r3((b.hits + b.walks + b.hit_by_pitch) / pa) : 0,
    batting_average: ab > 0 ? r3(b.hits / ab) : 0,
    errors_committed: p.errors,
    pitches: p.pitches,
    outs_recorded: p.outs_recorded,
    pitches_per_inning: p.outs_recorded ? Math.round((p.pitches / (p.outs_recorded / 3)) * 10) / 10 : null,
    walks_allowed: p.walks,
    strikeouts_pitched: them.batting.strikeouts,
    big_innings_against: them.runs_by_inning.map((runs, i) => ({ inning: i + 1, runs })).filter((x) => x.runs >= 2),
    hit_by_pitch: b.hit_by_pitch,
    strikeouts_looking: b.strikeouts_looking,
    first_pitch_called_strikes: b.first_pitch_called_strikes,
    first_pitch_swings: b.first_pitch_swings,
    two_strike_pas: b.two_strike_pas,
    stolen_bases: b.stolen_bases,
    caught_stealing: b.caught_stealing,
    strike_rate: p.pitches ? r3(p.strikes / p.pitches) : 0,
    first_pitch_strike_rate: p.batters_faced ? r3(p.first_pitch_strikes / p.batters_faced) : 0,
    wild_pitches: p.wild_pitches,
    passed_balls: p.passed_balls,
  };
}

export type PbpExtras = {
  hit_by_pitch: number;
  strikeouts_looking: number;
  first_pitch_called_strikes: number;
  first_pitch_swings: number;
  two_strike_pas: number;
  stolen_bases: number;
  caught_stealing: number;
  strike_rate: number;
  first_pitch_strike_rate: number;
  wild_pitches: number;
  passed_balls: number;
};
