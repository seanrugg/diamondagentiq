/**
 * Orchestrator: runs the agent team for one situation and owns the
 * critique/retry loop.
 *
 *   ContextAgent -> RulesAgent -> DevelopmentAgent -> CallTypeAgent -> CoachingAgent <-> CriticAgent   (intent "ruling")
 *   ContextAgent -> DevelopmentAgent               -> CallTypeAgent -> CoachingAgent <-> CriticAgent   (development, equipment, general)
 *
 * Agents run one at a time: Nightshift dropped requests (HTTP 499) when two
 * ran at once, and DevelopmentAgent picks a better lesson once it knows the
 * rule answer. A thrown error at any stage becomes a structured error naming
 * that stage, so one bad call never crashes a caller (e.g. npm run eval).
 *
 * Every answer carries a lesson: on rulings DevelopmentAgent adds the
 * teachable moment beyond the rule (if it fails, the rule answer still goes
 * out). Both middle agents return the same evidence shape, so the rest of the
 * team is shared.
 * CriticAgent (code checks + Lightning review) can send a draft back to
 * CoachingAgent at most MAX_CRITIC_RETRIES times (AGENTS.md rule 9). Every
 * handoff is traced. Confidence is computed in code from the evidence, not
 * by a model.
 */
import { callTypeAgent, type CallTypeOutput } from "./agents/callTypeAgent.js";
import { coachingAgent, computedResultText, type CoachingDraft, type DevelopmentInput } from "./agents/coachingAgent.js";
import { developmentAgent, type DevelopmentResult } from "./agents/developmentAgent.js";
import { contextAgent, type ContextOutput } from "./agents/contextAgent.js";
import { criticAgent, deterministicChecks } from "./agents/criticAgent.js";
import { rulesAgent } from "./agents/rulesAgent.js";
import { feedback as memoryFeedback, memoryText, recall, remember, type RecalledMemory } from "./agents/memoryAgent.js";
import type { Hmem } from "./adapters/hmem.js";
import type { RulesResult } from "./schemas/rules.js";
import {
  SituationAnswerSchema,
  type SituationAnswer,
  type SituationRequest,
} from "./schemas/situation.js";
import { getRunId, trace } from "./trace.js";

export const MAX_CRITIC_RETRIES = 2;

type RulesOk = Extract<RulesResult, { ok: true }>;

export type OrchestratorResult =
  | { ok: true; answer: SituationAnswer }
  | { ok: false; error: { stage: string; message: string; trace_id: string } };

function handoff(from: string, to: string, summary: string): void {
  trace({ agent_name: "orchestrator", action: "handoff", input_summary: `${from} -> ${to}`, output_summary: summary.slice(0, 500), status: "ok" });
}

function fail(stage: string, message: string): OrchestratorResult {
  trace({ agent_name: "orchestrator", action: "failed", input_summary: stage, output_summary: message.slice(0, 500), status: "error" });
  return { ok: false, error: { stage, message, trace_id: getRunId() } };
}

/**
 * A computed pitch-rest answer where every cited rules fact is tagged "rule"
 * involves no umpire judgment, so code classifies it and skips a model call.
 * Anything else (judgment, mixed, development questions) goes to CallTypeAgent.
 */
export function callTypeFromEvidence(rules: RulesOk): CallTypeOutput | null {
  const facts = rules.sources.filter((s) => s.table === "rules_facts");
  if (!rules.computation || rules.call_type_hint !== "rule" || facts.length === 0) return null;
  if (!facts.every((s) => s.call_type === "rule")) return null;
  return {
    call_type: "rule",
    rationale: "This follows from written pitch-count and rest rules applied to known facts (pitches thrown and dates); no umpire judgment is involved.",
    judgment_parts: [],
    rule_parts: ["pitch count", "required rest days", "earliest eligible date"],
  };
}

/** Confidence from evidence: draft data, missing facts, sources, unresolved review issues. */
export function computeConfidence(rules: RulesOk, unresolved: number): number {
  let c = 0.9;
  if (rules.draft_data) c = Math.min(c, 0.6);
  if (rules.sources.length === 0) c = Math.min(c, 0.3);
  c -= Math.min(rules.missing_facts.length, 3) * 0.1;
  if (unresolved > 0) c -= 0.2;
  return Math.round(Math.max(0.1, c) * 100) / 100;
}

function isUrl(value: string | null): value is string {
  if (!value) return false;
  try {
    new URL(value);
    return true;
  } catch {
    return false;
  }
}

/** Lessons, situations and story come straight from the tables; only the applied text is the model's. */
function lessonParts(draft: CoachingDraft, dev: DevelopmentInput | null) {
  if (!dev) return {};
  return {
    ...(dev.lessons.length
      ? { life_lesson: { text: draft.life_lesson, lessons: dev.lessons.map((l) => ({ id: l.id, title: l.title, principle: l.principle })) } }
      : {}),
    ...(dev.situations.length
      ? { situations: dev.situations.map((t) => ({ id: t.id, name: t.name, offense: t.offense, defense: t.defense, common_mistakes: t.common_mistakes })) }
      : {}),
    ...(dev.story ? { story: { id: dev.story.id, title: dev.story.title, story: dev.story.story } } : {}),
  };
}

export function assembleAnswer(
  rules: RulesOk,
  callType: CallTypeOutput,
  draft: CoachingDraft,
  review: { drafts: number; passed: boolean; unresolved_issues: string[] },
  route: { intent?: ContextOutput["intent"]; focus?: string; development?: DevelopmentInput | null } = {},
): SituationAnswer {
  const answer = {
    what_happened: {
      summary: draft.what_happened,
      sources: rules.sources.map((s) => `${s.table}:${s.id}`),
    },
    call_type: callType.call_type,
    call_type_rationale: callType.rationale,
    channel: draft.channel,
    teachable_moment: draft.teachable_moment,
    improvement_plan: draft.improvement_plan,
    confidence: computeConfidence(rules, review.unresolved_issues.length),
    sources: rules.sources
      .filter((s) => isUrl(s.source_url))
      .map((s) => ({
        table: s.table,
        id: s.id,
        source_url: s.source_url as string,
        verified: s.verified,
        rule_ref: s.rule_ref,
        edition: s.edition,
        synthetic: s.synthetic,
      })),
    missing_facts: rules.missing_facts,
    trace_id: getRunId(),
    computation: rules.computation,
    draft_data: rules.draft_data,
    ...(route.intent ? { intent: route.intent } : {}),
    ...(route.focus ? { focus: route.focus } : {}),
    ...lessonParts(draft, route.development ?? null),
    review,
  };
  return SituationAnswerSchema.parse(answer);
}

export type RunOptions = {
  /** H-MEM store for MemoryAgent; omit to run without memory. */
  memory?: Hmem | null;
  /** Let MemoryAgent mine the question with a model (default true). */
  mine?: boolean;
};

export async function runSituation(
  request: SituationRequest,
  referenceDate: string,
  opts: RunOptions = {},
): Promise<OrchestratorResult> {
  // Per-run record of the stage in progress, so a thrown error names it.
  const track = { stage: "contextAgent" };
  try {
    return await runStages(request, referenceDate, track, opts);
  } catch (error) {
    return fail(track.stage, error instanceof Error ? error.message : String(error));
  }
}

async function runStages(
  request: SituationRequest,
  referenceDate: string,
  track: { stage: string },
  opts: RunOptions,
): Promise<OrchestratorResult> {
  const context = await contextAgent(request);
  if (!context.ok) return fail("contextAgent", context.error.message);
  const ctx: ContextOutput = context.context;

  const hmem = opts.memory ?? null;
  let recalled: RecalledMemory[] = [];
  if (hmem) {
    track.stage = "memoryAgent";
    recalled = recall(hmem, request, ctx);
    handoff("contextAgent", "memoryAgent", `recalled ${recalled.length} memories`);
  }
  const memoryContext = memoryText(recalled);
  const intent = ctx.intent ?? "ruling";

  let rules: RulesOk;
  let development: DevelopmentInput | null = null;
  const toInput = (dev: Extract<DevelopmentResult, { ok: true }>, mode: DevelopmentInput["mode"]): DevelopmentInput => ({
    mode,
    focus: dev.focus,
    insights: dev.insights,
    drills: dev.drills,
    lessons: dev.lessons,
    situations: dev.situations,
    story: dev.story,
  });
  const devSummary = (dev: Extract<DevelopmentResult, { ok: true }>) =>
    `focus: ${dev.focus}; lessons ${dev.lessons.map((l) => l.id).join(",")}; situations ${dev.situations.map((t) => t.id).join(",") || "none"}; story ${dev.story?.id ?? "none"}; insights ${dev.insights.length}; drills ${dev.drills.length}`;

  if (intent === "ruling") {
    handoff("contextAgent", "rulesAgent", JSON.stringify({ intent, topic: ctx.topic, entities: ctx.entities }));
    track.stage = "rulesAgent";
    const found = await rulesAgent(request, ctx, referenceDate);
    if (!found.ok) return fail("rulesAgent", found.error.message);
    rules = found;
    handoff("rulesAgent", "developmentAgent", `${found.sources.length} rule sources; computation=${found.computation ? "yes" : "no"}`);
    const ruleSummary = `${found.summary} ${found.computation ? computedResultText(found) : ""}`.trim();
    const dev: DevelopmentResult = await developmentAgent(request, ctx, "ruling", ruleSummary, memoryContext).catch((error: unknown) => ({
      ok: false as const,
      error: { message: error instanceof Error ? error.message : String(error), attempts: 0 },
    }));
    if (dev.ok) {
      development = toInput(dev, "ruling");
      rules = {
        ...found,
        sources: [...found.sources, ...dev.evidence.sources],
        draft_data: found.draft_data || dev.evidence.draft_data,
      };
      handoff("developmentAgent", "callTypeAgent", devSummary(dev));
    } else {
      trace({ agent_name: "orchestrator", action: "lesson_skipped", input_summary: "developmentAgent", output_summary: dev.error.message.slice(0, 300), status: "error" });
    }
    handoff("rulesAgent", "callTypeAgent", `${found.sources.length} rule sources; computation=${found.computation ? "yes" : "no"}; draft_data=${found.draft_data}`);
  } else {
    handoff("contextAgent", "developmentAgent", JSON.stringify({ intent, topic: ctx.topic }));
    track.stage = "developmentAgent";
    const dev = await developmentAgent(request, ctx, "development", undefined, memoryContext);
    if (!dev.ok) return fail("developmentAgent", dev.error.message);
    rules = dev.evidence;
    development = toInput(dev, "development");
    handoff("developmentAgent", "callTypeAgent", devSummary(dev));
  }

  track.stage = "callTypeAgent";
  const byCode = callTypeFromEvidence(rules);
  let callType: { ok: true; value: CallTypeOutput };
  if (byCode) {
    callType = { ok: true, value: byCode };
    trace({ agent_name: "orchestrator", action: "call_type_by_code", input_summary: "computed pitch-rest answer; every cited fact is a rule", output_summary: "rule (CallTypeAgent not needed)", status: "ok" });
  } else {
    const classified = await callTypeAgent(request, ctx, rules);
    if (!classified.ok) return fail("callTypeAgent", classified.error.message);
    callType = classified;
  }
  handoff("callTypeAgent", "coachingAgent", `${callType.value.call_type}: ${callType.value.rationale}`);

  let issues: string[] = [];
  let drafts = 0;
  let draft: CoachingDraft | null = null;

  for (let round = 0; round <= MAX_CRITIC_RETRIES; round += 1) {
    track.stage = "coachingAgent";
    const written = await coachingAgent(request, ctx, rules, callType.value, issues, development, memoryContext).catch(
      (error: unknown) => ({ ok: false as const, error: { message: error instanceof Error ? error.message : String(error), attempts: 1 } }),
    );
    if (!written.ok) {
      if (draft) {
        // Keep the last draft and report what's still open, rather than losing a whole answer.
        trace({ agent_name: "orchestrator", action: "redraft_failed", input_summary: `round ${round + 1}`, output_summary: `kept draft ${drafts}: ${written.error.message}`.slice(0, 300), status: "error" });
        break;
      }
      return fail("coachingAgent", written.error.message);
    }
    draft = written.value;
    drafts += 1;
    handoff("coachingAgent", "criticAgent", `draft ${drafts}`);

    const codeIssues = deterministicChecks(draft, rules, (development?.lessons.length ?? 0) > 0);
    // If code already found problems the draft goes back anyway, so skip the
    // model review this round (saves a slow call). Its turn comes on the redraft.
    let modelIssues: string[] = [];
    if (codeIssues.length === 0) {
      track.stage = "criticAgent";
      const review = await criticAgent(request, draft, callType.value, ctx.age).catch((error: unknown) => {
        trace({ agent_name: "orchestrator", action: "critic_unavailable", input_summary: `draft ${drafts}`, output_summary: error instanceof Error ? error.message.slice(0, 200) : "error", status: "error" });
        return null;
      });
      modelIssues = review?.ok && !review.value.pass ? review.value.issues : [];
    }
    issues = [...codeIssues, ...modelIssues];

    trace({
      agent_name: "orchestrator",
      action: "critique",
      input_summary: `draft ${drafts}`,
      output_summary: issues.length ? `rejected: ${issues.join(" | ")}`.slice(0, 600) : "passed",
      status: issues.length ? "error" : "ok",
    });
    if (issues.length === 0) break;
    if (round < MAX_CRITIC_RETRIES) handoff("criticAgent", "coachingAgent", `retry ${round + 1}: ${issues.length} issue(s)`);
  }

  if (!draft) return fail("coachingAgent", "no draft produced");
  const passed = issues.length === 0;
  const recalledIds = new Set(recalled.map((m) => m.id));
  const used = draft.memory_used.filter((id) => recalledIds.has(id)); // never trust an id we didn't give it
  const answer = assembleAnswer(rules, callType.value, draft, {
    drafts,
    passed,
    unresolved_issues: issues,
  }, { intent, focus: development?.focus, development });

  if (hmem) {
    track.stage = "memoryAgent";
    memoryFeedback(hmem, used, passed);
    const saved = await remember(hmem, request, ctx, answer, { mine: opts.mine, referenceDate });
    answer.memory = { recalled, used, saved };
    handoff("criticAgent", "memoryAgent", `used ${used.length}; saved ${saved.length}`);
  }
  trace({
    agent_name: "orchestrator",
    action: "answer",
    input_summary: request.question,
    output_summary: `intent=${intent} call_type=${answer.call_type} confidence=${answer.confidence} drafts=${drafts} passed=${issues.length === 0}`,
    status: "ok",
  });
  return { ok: true, answer };
}
