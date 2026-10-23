/**
 * Orchestrator: runs the agent team for one situation and owns the
 * critique/retry loop.
 *
 *   ContextAgent -> RulesAgent       -> CallTypeAgent -> CoachingAgent <-> CriticAgent   (intent "ruling")
 *   ContextAgent -> DevelopmentAgent -> CallTypeAgent -> CoachingAgent <-> CriticAgent   (development, equipment, general)
 *
 * Both middle agents return the same evidence shape (sources, summary,
 * computation, draft flag), so the rest of the team is shared.
 * CriticAgent (code checks + Lightning review) can send a draft back to
 * CoachingAgent at most MAX_CRITIC_RETRIES times (AGENTS.md rule 9). Every
 * handoff is traced. Confidence is computed in code from the evidence, not
 * by a model.
 */
import { callTypeAgent, type CallTypeOutput } from "./agents/callTypeAgent.js";
import { coachingAgent, type CoachingDraft, type DevelopmentInput } from "./agents/coachingAgent.js";
import { developmentAgent } from "./agents/developmentAgent.js";
import { contextAgent, type ContextOutput } from "./agents/contextAgent.js";
import { criticAgent, deterministicChecks } from "./agents/criticAgent.js";
import { rulesAgent } from "./agents/rulesAgent.js";
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

export function assembleAnswer(
  rules: RulesOk,
  callType: CallTypeOutput,
  draft: CoachingDraft,
  review: { drafts: number; passed: boolean; unresolved_issues: string[] },
  route: { intent?: ContextOutput["intent"]; focus?: string } = {},
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
    review,
  };
  return SituationAnswerSchema.parse(answer);
}

export async function runSituation(
  request: SituationRequest,
  referenceDate: string,
): Promise<OrchestratorResult> {
  const context = await contextAgent(request);
  if (!context.ok) return fail("contextAgent", context.error.message);
  const ctx: ContextOutput = context.context;
  const intent = ctx.intent ?? "ruling";

  let rules: RulesOk;
  let development: DevelopmentInput | null = null;
  if (intent === "ruling") {
    handoff("contextAgent", "rulesAgent", JSON.stringify({ intent, topic: ctx.topic, entities: ctx.entities }));
    const found = await rulesAgent(request, ctx, referenceDate);
    if (!found.ok) return fail("rulesAgent", found.error.message);
    rules = found;
    handoff("rulesAgent", "callTypeAgent", `${rules.sources.length} sources; computation=${rules.computation ? "yes" : "no"}; draft_data=${rules.draft_data}`);
  } else {
    handoff("contextAgent", "developmentAgent", JSON.stringify({ intent, topic: ctx.topic }));
    const dev = await developmentAgent(request, ctx);
    if (!dev.ok) return fail("developmentAgent", dev.error.message);
    rules = dev.evidence;
    development = { focus: dev.focus, insights: dev.insights, drills: dev.drills };
    handoff("developmentAgent", "callTypeAgent", `focus: ${dev.focus}; insights ${dev.insights.map((i) => i.id).join(",")}; drills ${dev.drills.length}`);
  }

  const callType = await callTypeAgent(request, ctx, rules);
  if (!callType.ok) return fail("callTypeAgent", callType.error.message);
  handoff("callTypeAgent", "coachingAgent", `${callType.value.call_type}: ${callType.value.rationale}`);

  let issues: string[] = [];
  let drafts = 0;
  let draft: CoachingDraft | null = null;

  for (let round = 0; round <= MAX_CRITIC_RETRIES; round += 1) {
    const written = await coachingAgent(request, ctx, rules, callType.value, issues, development);
    if (!written.ok) {
      if (draft) break; // keep the last good draft
      return fail("coachingAgent", written.error.message);
    }
    draft = written.value;
    drafts += 1;
    handoff("coachingAgent", "criticAgent", `draft ${drafts}`);

    const codeIssues = deterministicChecks(draft, rules);
    const review = await criticAgent(request, draft, callType.value, ctx.age);
    const modelIssues = review.ok && !review.value.pass ? review.value.issues : [];
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
  const answer = assembleAnswer(rules, callType.value, draft, {
    drafts,
    passed: issues.length === 0,
    unresolved_issues: issues,
  }, { intent, focus: development?.focus });
  trace({
    agent_name: "orchestrator",
    action: "answer",
    input_summary: request.question,
    output_summary: `intent=${intent} call_type=${answer.call_type} confidence=${answer.confidence} drafts=${drafts} passed=${issues.length === 0}`,
    status: "ok",
  });
  return { ok: true, answer };
}
