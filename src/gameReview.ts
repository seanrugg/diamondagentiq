/**
 * Post-game review: the coaching-staff mode.
 *
 *   ScorebookAgent (Super VL) reads the box score -> code checks the totals
 *   (one re-read if they disagree) -> code computes team stats and pitcher
 *   rest (league chart via Zetaris) -> MemoryAgent recalls this team ->
 *   GameReviewAgent drafts <-> CriticAgent (judge tier, one redraft) ->
 *   MemoryAgent remembers the game.
 */
import type { Hmem } from "./adapters/hmem.js";
import { runAgentRows } from "./adapters/dataTools.js";
import { teamStats } from "./calculators/boxScore.js";
import { earliestEligibleDate, restDaysRequired } from "./calculators/pitchRest.js";
import { fetchDrills, fetchInsights, fetchLessons } from "./agents/developmentAgent.js";
import { gameReviewAgent, MAX_REVIEW_REDRAFTS, reviewChecks, reviewCritic, type GameReviewDraft, type PitcherRest, type ReviewInputs } from "./agents/gameReviewAgent.js";
import { memoryText, type RecalledMemory } from "./agents/memoryAgent.js";
import { scorebookAgent } from "./agents/scorebookAgent.js";
import { GameReviewAnswerSchema, type BoxScore, type GameReviewAnswer, type GameReviewRequest } from "./schemas/boxScore.js";
import { getRunId, trace } from "./trace.js";

export type GameReviewResult =
  | { ok: true; answer: GameReviewAnswer }
  | { ok: false; error: { stage: string; message: string; trace_id: string } };

function fail(stage: string, message: string): GameReviewResult {
  trace({ agent_name: "orchestrator", action: "failed", input_summary: stage, output_summary: message.slice(0, 500), status: "error" });
  return { ok: false, error: { stage, message, trace_id: getRunId() } };
}

const teamKey = (request: GameReviewRequest) => `team:${(request.team ?? "default").trim().toLowerCase() || "default"}`;

export async function pitcherRest(boxScore: BoxScore, request: GameReviewRequest, gameDate: string): Promise<PitcherRest[]> {
  const pitchers = boxScore.pitching.filter((p) => p.pitches !== null);
  if (pitchers.length === 0) return [];
  if (!/^[a-z_]+$/.test(request.sanction)) return pitchers.map((p) => ({ player: p.player, pitches: p.pitches ?? 0, rest_days: null, eligible_again: null, note: "unknown sanction" }));
  const tiers = await runAgentRows(
    `SELECT age_min, age_max, pitches_min, pitches_max, rest_days FROM diq_pg.pitch_rest_rules WHERE sanction = '${request.sanction}' AND sport = '${request.sport}'`,
  );
  const rows = tiers.map((t) => ({ age_min: t.age_min ?? "", age_max: t.age_max ?? "", pitches_min: t.pitches_min ?? "", pitches_max: t.pitches_max ?? "", rest_days: t.rest_days ?? "" }));
  return pitchers.map((p) => {
    const match = restDaysRequired(p.pitches ?? 0, request.age, rows);
    if (match.kind !== "match") return { player: p.player, pitches: p.pitches ?? 0, rest_days: null, eligible_again: null, note: `no ${request.sanction} pitch-count tier for age ${request.age}` };
    return { player: p.player, pitches: p.pitches ?? 0, rest_days: match.rest_days, eligible_again: earliestEligibleDate(gameDate, match.rest_days), note: null };
  });
}

export async function runGameReview(
  request: GameReviewRequest,
  today: string,
  opts: { memory?: Hmem | null } = {},
): Promise<GameReviewResult> {
  const track = { stage: "scorebookAgent" };
  try {
    return await run(request, today, opts.memory ?? null, track);
  } catch (error) {
    return fail(track.stage, error instanceof Error ? error.message : String(error));
  }
}

async function run(request: GameReviewRequest, today: string, hmem: Hmem | null, track: { stage: string }): Promise<GameReviewResult> {
  const read = await scorebookAgent(request);
  if (!read.ok) return fail("scorebookAgent", read.error.message);
  const box = read.boxScore;

  track.stage = "calculators";
  const stats = teamStats(box);
  const gameDate = box.date ?? today;
  const rest = await pitcherRest(box, request, gameDate);
  trace({
    agent_name: "orchestrator",
    action: "computed_stats",
    input_summary: `${box.stats_team}: ${box.batting.length} batters, ${box.pitching.length} pitchers`,
    output_summary: JSON.stringify({ result: stats.result, score: `${stats.runs_for}-${stats.runs_against}`, strikeout_rate: stats.strikeout_rate, on_base_rate: stats.on_base_rate, errors: stats.errors_committed, pitches_per_inning: stats.pitches_per_inning, pitcher_rest: rest.map((r) => `${r.player}: ${r.pitches} -> eligible ${r.eligible_again}`) }),
    status: "ok",
  });

  track.stage = "developmentAgent";
  const [lessons, insights, drills] = await Promise.all([fetchLessons(), fetchInsights(request.sport, request.age), fetchDrills(request.age)]);

  let recalled: RecalledMemory[] = [];
  if (hmem) {
    track.stage = "memoryAgent";
    const q = `post-game review ${box.stats_team} strikeouts walks errors practice priorities`;
    recalled = hmem.query(q, { topN: 3, threshold: 0.15, chatId: teamKey(request) }).memories.map(({ memory, relevance }) => ({ id: memory.id, content: memory.content, relevance: Number(relevance.toFixed(3)), confidence: Number(memory.confidence.toFixed(3)) }));
    trace({ agent_name: "memoryAgent", action: "recall", input_summary: `${teamKey(request)}: ${q}`, output_summary: recalled.length ? recalled.map((m) => `${m.id} (${m.relevance}): ${m.content.slice(0, 80)}`).join(" | ") : "nothing relevant yet", status: "ok" });
  }

  const inputs: ReviewInputs = { request, boxScore: box, stats, readIssues: read.issues, pitcherRest: rest, lessons, insights, drills, memoryContext: memoryText(recalled) };

  let draft: GameReviewDraft | null = null;
  let issues: string[] = [];
  let drafts = 0;
  for (let round = 0; round <= MAX_REVIEW_REDRAFTS; round += 1) {
    track.stage = "gameReviewAgent";
    const written = await gameReviewAgent(inputs, issues).catch((e: unknown) => ({ ok: false as const, error: { message: e instanceof Error ? e.message : String(e), attempts: 1 } }));
    if (!written.ok) {
      if (draft) break;
      return fail("gameReviewAgent", written.error.message);
    }
    draft = written.value;
    drafts += 1;
    const codeIssues = reviewChecks(draft, inputs);
    let modelIssues: string[] = [];
    if (codeIssues.length === 0) {
      track.stage = "criticAgent";
      const verdict = await reviewCritic(draft, inputs).catch(() => null);
      modelIssues = verdict?.ok && !verdict.value.pass ? verdict.value.issues : [];
    }
    issues = [...codeIssues, ...modelIssues];
    trace({ agent_name: "orchestrator", action: "critique", input_summary: `draft ${drafts}`, output_summary: issues.length ? `rejected: ${issues.join(" | ")}`.slice(0, 600) : "passed", status: issues.length ? "error" : "ok" });
    if (issues.length === 0) break;
  }
  if (!draft) return fail("gameReviewAgent", "no draft produced");

  const drillById = new Map(drills.map((d) => [d.id, d]));
  const insightById = new Map(insights.map((x) => [x.id, x]));
  const lesson = lessons.find((l) => l.id === draft.lesson_id) ?? null;
  const priorities = draft.priorities.map((p) => ({
    title: p.title,
    why: p.why,
    drills: p.drill_ids.flatMap((id) => { const d = drillById.get(id); return d ? [{ id: d.id, title: d.title, description: d.description, setting: d.setting, safety_notes: d.safety_notes }] : []; }),
    insights: p.insight_ids.flatMap((id) => { const x = insightById.get(id); return x ? [{ id: x.id, insight: x.insight, source_url: x.source_url, verified: x.verified }] : []; }),
  }));
  const usedInsights = priorities.flatMap((p) => p.insights);
  const sources = [
    ...(lesson ? [{ table: "coaching_lessons", id: lesson.id, source_url: lesson.source_url, verified: lesson.verified }] : []),
    ...usedInsights.map((x) => ({ table: "coaching_insights", id: x.id, source_url: x.source_url, verified: x.verified })),
  ];
  const draftData = sources.some((s) => !s.verified);
  let confidence = 0.9;
  if (read.issues.length) confidence = Math.min(confidence, 0.5);
  if (draftData) confidence = Math.min(confidence, 0.7);
  if (issues.length) confidence -= 0.2;

  const passed = issues.length === 0;
  const recalledIds = new Set(recalled.map((m) => m.id));
  const used = draft.memory_used.filter((id) => recalledIds.has(id));

  const answer: GameReviewAnswer = GameReviewAnswerSchema.parse({
    box_score: box,
    read: { reads: read.reads, issues: read.issues },
    stats,
    pitcher_rest: rest,
    headline: draft.headline,
    what_decided_it: draft.what_decided_it,
    strengths: draft.strengths,
    priorities,
    lesson: lesson ? { id: lesson.id, title: lesson.title, principle: lesson.principle, life_lesson: lesson.life_lesson } : null,
    team_talk: draft.team_talk,
    at_home: draft.at_home,
    sources,
    confidence: Math.round(Math.max(0.1, confidence) * 100) / 100,
    review: { drafts, passed, unresolved_issues: issues },
    synthetic_input: /synthetic demo data/i.test(`${box.event ?? ""} ${request.text ?? ""}`) || /demo hawks/i.test(box.stats_team),
    trace_id: getRunId(),
  });

  if (hmem) {
    track.stage = "memoryAgent";
    for (const id of used) hmem.feedback(id, passed ? "helpful" : "not_helpful");
    const saved = hmem.add({
      content: `${gameDate}: ${stats.result} ${stats.runs_for}-${stats.runs_against} vs ${box.stats_team === box.home_team ? box.away_team : box.home_team}. Struck out in ${Math.round(stats.strikeout_rate * 100)}% of plate appearances; ${stats.errors_committed} errors; ${stats.walks_allowed} walks allowed. Practice priorities: ${priorities.map((p) => p.title).join("; ")}.`,
      type: "factual",
      layer: "working",
      tags: ["game", stats.result, ...priorities.map((p) => p.title.toLowerCase().split(" ")[0] ?? "")].filter(Boolean),
      confidence: answer.confidence,
      source: `diamondagentiq:game_review:${answer.trace_id}`,
      provenance: { origin: "plan_completion", learnedAt: hmem.clock(), label: "post-game review" },
      chatId: teamKey(request),
    });
    trace({ agent_name: "memoryAgent", action: "remember", input_summary: teamKey(request), output_summary: `saved ${saved.id}`, status: "ok" });
    answer.memory = { recalled, used, saved: [saved.id] };
  }

  trace({ agent_name: "orchestrator", action: "answer", input_summary: "game review", output_summary: `drafts=${drafts} passed=${passed} confidence=${answer.confidence}`, status: "ok" });
  return { ok: true, answer };
}
