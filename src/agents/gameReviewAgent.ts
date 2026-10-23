/**
 * GameReviewAgent (Super): the post-game coach. It reasons only from the box
 * score ScorebookAgent read and the stats code computed, picks what decided
 * the game and 1-3 practice priorities (drills and coaching insights chosen
 * from menus fetched via Zetaris), and the life lesson for the team talk.
 * A judge-tier review then checks tone and grounding (one redraft at most).
 */
import { z } from "zod";
import type { GameReviewRequest, GameSummary } from "../schemas/boxScore.js";
import type { TeamStats } from "../calculators/boxScore.js";
import type { PbpExtras, PlayByPlay } from "../calculators/playByPlay.js";
import type { Drill, Insight, Lesson } from "./developmentAgent.js";
import { askJson, type JsonAgentResult } from "./modelJson.js";
import { LEARNING_PHILOSOPHY } from "./philosophy.js";

export const MAX_REVIEW_REDRAFTS = 1;

export const GameReviewDraftSchema = z.object({
  headline: z.string().min(1),
  what_decided_it: z.array(z.string().min(1)).min(1).max(3),
  strengths: z.array(z.string().min(1)).min(1).max(3),
  priorities: z
    .array(
      z.object({
        title: z.string().min(1),
        why: z.string().min(1),
        drill_ids: z.array(z.string()).default([]),
        insight_ids: z.array(z.string()).default([]),
      }),
    )
    .min(1)
    .max(3),
  lesson_id: z.string().min(1),
  team_talk: z.string().min(1),
  at_home: z.array(z.string()).default([]),
  memory_used: z.array(z.string()).default([]),
});
export type GameReviewDraft = z.infer<typeof GameReviewDraftSchema>;

export const ReviewVerdictSchema = z.object({ pass: z.boolean(), issues: z.array(z.string()).default([]) });

export type PitcherRest = { player: string; pitches: number; rest_days: number | null; eligible_again: string | null; note: string | null };

export type ReviewInputs = {
  request: GameReviewRequest;
  game: GameSummary;
  stats: TeamStats & Partial<PbpExtras>;
  /** Rule moments from a play-by-play (empty for a box score). */
  ruleMoments: PlayByPlay["rule_moments"];
  readIssues: string[];
  pitcherRest: PitcherRest[];
  lessons: Lesson[];
  insights: Insight[];
  drills: Drill[];
  memoryContext: string;
};

function factsText(i: ReviewInputs): string {
  const s = i.stats;
  const pct = (x: number) => `${Math.round(x * 100)}%`;
  const g = i.game;
  const pbp = g.source === "play_by_play"
    ? `
- From the play-by-play: called third strikes ${s.strikeouts_looking ?? 0} of ${s.strikeouts} strikeouts; first pitch was a called strike in ${s.first_pitch_called_strikes ?? 0} plate appearances and a swing in ${s.first_pitch_swings ?? 0}; ${s.two_strike_pas ?? 0} plate appearances reached two strikes.
- Our running: ${s.stolen_bases ?? 0} stolen bases, ${s.caught_stealing ?? 0} caught stealing. Our pitching: ${pct(s.strike_rate ?? 0)} strikes, first-pitch strikes to ${pct(s.first_pitch_strike_rate ?? 0)} of batters, ${s.wild_pitches ?? 0} wild pitches, ${s.passed_balls ?? 0} passed balls.
- Rule moments in this game (teach them; never treat them as complaints about the umpire): ${i.ruleMoments.length ? i.ruleMoments.map((m) => `${m.half}, ${m.batting_team} batting: ${m.kind.replace(/_/g, " ")}`).join("; ") : "none"}.`
    : "";
  return `Game: ${g.away_team} ${g.line_score.away_rhe.r}, ${g.home_team} ${g.line_score.home_rhe.r}${g.date ? ` on ${g.date}` : ""}${g.event ? ` (${g.event})` : ""}. Our team: ${g.our_team}, result: ${s.result}.
Computed in code (use these numbers exactly; don't compute your own):
- Plate appearances ${s.plate_appearances}; hits ${s.hits}; walks ${s.walks}; strikeouts ${s.strikeouts} (${pct(s.strikeout_rate)} of plate appearances); on-base rate ${pct(s.on_base_rate)}.
- Errors committed ${s.errors_committed}. Walks allowed ${s.walks_allowed}; strikeouts by our pitchers ${s.strikeouts_pitched}.
- Pitches ${s.pitches ?? "not recorded"}${s.pitches_per_inning !== null ? `, ${s.pitches_per_inning} per inning` : ""}.
- Opponent's big innings (2+ runs): ${s.big_innings_against.length ? s.big_innings_against.map((b) => `inning ${b.inning}: ${b.runs}`).join("; ") : "none"}.${pbp}
- Pitcher rest (computed from the league chart): ${i.pitcherRest.map((p) => `${p.player} ${p.pitches} pitches -> ${p.rest_days ?? "?"} days, eligible ${p.eligible_again ?? "unknown"}`).join("; ") || "no pitch counts"}.
${i.readIssues.length ? `Totals that didn't agree when the ${g.source === "play_by_play" ? "play-by-play was checked" : "box score was read"} (mention that the numbers may be off): ${i.readIssues.join(" ")}` : `All ${g.source === "play_by_play" ? "play-by-play" : "box-score"} totals agree.`}`;
}

export function gameReviewAgent(i: ReviewInputs, criticIssues: string[] = []): Promise<JsonAgentResult<GameReviewDraft>> {
  const lessons = i.lessons.map((l) => `- ${l.id} "${l.title}": ${l.principle}`).join("\n");
  const insights = i.insights.map((x) => `- ${x.id} [${x.topic}]: ${x.insight}`).join("\n");
  const drills = i.drills.map((d) => `- ${d.id} [${d.skill}; ${d.setting}] ${d.title}`).join("\n");

  const system = `You are the GameReviewAgent for DiamondAgentIQ: a youth ${i.request.sport} coach reviewing a game for a ${i.request.role}, players aged ${i.request.age}.
${LEARNING_PHILOSOPHY}

Rules:
- Use only the facts and computed numbers given. Never invent plays, innings or stats that aren't there.
- Talk about the team, not individuals' failures. You may praise individuals. Never single out a player for a loss.
- Umpires' calls are never the reason a game was won or lost.
- Priorities: 1-3, each a concrete practice focus tied to a number from the facts ("why"), with drill ids and insight ids only from the menus. Age-appropriate and safe.
- If a pitcher's rest is given, the plan must respect it (no pitching before the eligible date).
- lesson_id: one lesson from the menu for the team talk. team_talk: 2-3 warm sentences the coach could say to the team, win or lose.
Reply with ONLY: {"headline": "...", "what_decided_it": ["..."], "strengths": ["..."], "priorities": [{"title": "...", "why": "...", "drill_ids": [], "insight_ids": []}], "lesson_id": "L00x", "team_talk": "...", "at_home": ["..."], "memory_used": []}`;

  const user = `${factsText(i)}
${i.memoryContext ? `\n${i.memoryContext}\n` : ""}
Lessons:
${lessons}
Coaching insights:
${insights}
Drills:
${drills || "(none)"}${criticIssues.length ? `\n\nA reviewer rejected your previous draft. Fix every issue:\n${criticIssues.map((x) => `- ${x}`).join("\n")}` : ""}`;

  return askJson("gameReviewAgent", "draft_review", "super", [
    { role: "system", content: system },
    { role: "user", content: user },
  ], GameReviewDraftSchema);
}

/** Code checks first (ids on the menus, pitcher rest respected), then the judge-tier review. */
export function reviewChecks(draft: GameReviewDraft, i: ReviewInputs): string[] {
  const issues: string[] = [];
  const lessonIds = new Set(i.lessons.map((l) => l.id));
  const drillIds = new Set(i.drills.map((d) => d.id));
  const insightIds = new Set(i.insights.map((x) => x.id));
  if (!lessonIds.has(draft.lesson_id)) issues.push(`lesson_id ${draft.lesson_id} is not on the lesson menu.`);
  for (const p of draft.priorities) {
    for (const d of p.drill_ids) if (!drillIds.has(d)) issues.push(`Drill ${d} is not on the drill menu.`);
    for (const x of p.insight_ids) if (!insightIds.has(x)) issues.push(`Insight ${x} is not on the insight menu.`);
  }
  return issues;
}

export function reviewCritic(draft: GameReviewDraft, i: ReviewInputs): Promise<JsonAgentResult<z.infer<typeof ReviewVerdictSchema>>> {
  const system = `You are the CriticAgent for DiamondAgentIQ. Review a post-game review for a youth ${i.request.sport} ${i.request.role} (players aged ${i.request.age}). Fail it ONLY for real problems:
- It blames or singles out a player, coach, parent or umpire for the result, or is discouraging.
- It states a number or event that isn't in the facts given.
- A practice idea is unsafe or not age-appropriate, or it has a pitcher pitching before the eligible date.
- It puts winning above development or health.
Reply with ONLY: {"pass": true|false, "issues": ["<specific fix>"]}`;
  return askJson("criticAgent", "review_game_review", "judge", [
    { role: "system", content: system },
    { role: "user", content: `${factsText(i)}\n\nDraft:\n${JSON.stringify(draft, null, 2)}` },
  ], ReviewVerdictSchema);
}
