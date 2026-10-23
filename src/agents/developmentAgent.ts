/**
 * DevelopmentAgent (Lightning): for questions about growing a player rather
 * than applying a rule (a tough strikeout, confidence, practice, equipment).
 *
 * Code fetches the coaching insights and drills that fit the player's sport
 * and age through Zetaris; the model only picks which ones apply and names a
 * single focus. Picked ids must come from the menu code gave it, so every
 * piece of advice in the answer traces back to a cited, team-vetted row.
 * The result is shaped like the RulesAgent result ("evidence"), so the
 * CallType, Coaching and Critic agents work the same way on both paths.
 */
import { z } from "zod";
import { runAgentRows } from "../adapters/dataTools.js";
import type { Row } from "../adapters/rows.js";
import type { RuleSource, RulesResult } from "../schemas/rules.js";
import type { SituationRequest } from "../schemas/situation.js";
import { trace } from "../trace.js";
import type { ContextOutput } from "./contextAgent.js";
import { askJson } from "./modelJson.js";

export const MAX_INSIGHTS = 4;
export const MAX_DRILLS = 3;

export const DevelopmentPickSchema = z.object({
  insight_ids: z.array(z.string()).min(1),
  drill_ids: z.array(z.string()).default([]),
  focus: z.string().min(1),
  call_type_hint: z.enum(["judgment", "rule", "mixed"]),
});
export type DevelopmentPick = z.infer<typeof DevelopmentPickSchema>;

export type Insight = {
  id: string;
  topic: string;
  audience: string;
  situation: string;
  insight: string;
  why: string | null;
  try_this: string | null;
  source_id: string;
  source_url: string | null;
  source_title: string | null;
  verified: boolean;
};

export type Drill = {
  id: string;
  skill: string;
  title: string;
  description: string;
  setting: string;
  safety_notes: string | null;
  reviewed: boolean;
};

export type DevelopmentResult =
  | {
      ok: true;
      focus: string;
      insights: Insight[];
      drills: Drill[];
      /** RulesAgent-shaped evidence for the shared downstream agents. */
      evidence: Extract<RulesResult, { ok: true }>;
    }
  | { ok: false; error: { message: string; attempts: number } };

const str = (v: unknown): string | null => (v === null || v === undefined || v === "" ? null : String(v));
const bool = (v: unknown): boolean => v === true || /^(true|t|1)$/i.test(String(v ?? ""));

function toInsight(r: Row): Insight {
  return {
    id: String(r.insight_code),
    topic: String(r.topic),
    audience: String(r.audience),
    situation: String(r.situation),
    insight: String(r.insight),
    why: str(r.why),
    try_this: str(r.try_this),
    source_id: String(r.source_id),
    source_url: str(r.url),
    source_title: str(r.title),
    verified: bool(r.verified),
  };
}

function toDrill(r: Row): Drill {
  return {
    id: String(r.id),
    skill: String(r.skill),
    title: String(r.title),
    description: String(r.description),
    setting: String(r.setting),
    safety_notes: str(r.safety_notes),
    reviewed: bool(r.reviewed),
  };
}

/** Age filter that keeps open-ended ranges (NULL bounds). Age is a validated int. */
function ageClause(alias: string, age: number): string {
  const a = Math.trunc(age);
  return `(${alias}.age_min IS NULL OR ${alias}.age_min <= ${a}) AND (${alias}.age_max IS NULL OR ${alias}.age_max >= ${a})`;
}

export async function fetchInsights(sport: "baseball" | "softball", age: number): Promise<Insight[]> {
  const rows = await runAgentRows(
    `SELECT c.insight_code, c.topic, c.audience, c.situation, c.insight, c.why, c.try_this, c.source_id, c.verified, s.url, s.title FROM diq_pg.coaching_insights c JOIN diq_pg.rule_sources s ON c.source_id = s.source_id WHERE c.sport IN ('both', '${sport}') AND ${ageClause("c", age)}`,
  );
  return rows.map(toInsight).sort((a, b) => a.id.localeCompare(b.id));
}

export async function fetchDrills(age: number): Promise<Drill[]> {
  const rows = await runAgentRows(
    `SELECT d.id, d.skill, d.title, d.description, d.setting, d.safety_notes, d.reviewed FROM diq_pg.drills d WHERE ${ageClause("d", age)}`,
  );
  return rows.map(toDrill).sort((a, b) => a.title.localeCompare(b.title));
}

export function insightSource(i: Insight): RuleSource {
  return {
    table: "coaching_insights",
    id: i.id,
    rule_ref: null,
    source_url: i.source_url,
    edition: null,
    verified: i.verified,
    synthetic: false,
    call_type: null,
    summary: i.insight,
  };
}

export async function developmentAgent(
  request: SituationRequest,
  context: ContextOutput,
): Promise<DevelopmentResult> {
  const [insights, drills] = await Promise.all([fetchInsights(context.sport, context.age), fetchDrills(context.age)]);
  if (insights.length === 0) {
    return { ok: false, error: { message: `No coaching insights for ${context.sport} age ${context.age}`, attempts: 0 } };
  }

  const insightMenu = insights
    .map((i) => `- ${i.id} [${i.topic}; for ${i.audience}] when: ${i.situation} | ${i.insight}`)
    .join("\n");
  const drillMenu = drills.map((d) => `- ${d.id} [${d.skill}; ${d.setting}] ${d.title}`).join("\n");

  const system = `You are the DevelopmentAgent for DiamondAgentIQ, a youth baseball/softball learning tool. Pick the coaching insights and drills that best help with this question. Pick ONLY ids from the menus. Choose 1-${MAX_INSIGHTS} insights (prefer ones written for a ${request.role} or for "all") and 0-${MAX_DRILLS} drills. Name ONE focus: the single most useful next step, in a few plain words.
call_type_hint: "judgment" if the question involves what the umpire saw (balls and strikes, safe/out), "rule" if a written rule decides it, "mixed" if both.
Reply with ONLY: {"insight_ids": ["C001", ...], "drill_ids": ["..."], "focus": "...", "call_type_hint": "judgment"|"rule"|"mixed"}`;

  const user = `Question (${request.role}): ${request.question}
Sport/age: ${context.sport} / ${context.age} | Topic: ${context.topic}
Coaching insights:
${insightMenu}
Drills:
${drillMenu || "(none)"}`;

  const picked = await askJson("developmentAgent", "pick_insights", "lightning", [
    { role: "system", content: system },
    { role: "user", content: user },
  ], DevelopmentPickSchema);
  if (!picked.ok) return { ok: false, error: picked.error };

  // Keep only ids that were on the menu, in the model's order, deduplicated.
  const byInsight = new Map(insights.map((i) => [i.id, i]));
  const byDrill = new Map(drills.map((d) => [d.id, d]));
  const unique = <T,>(xs: (T | undefined)[]) => [...new Set(xs.filter((x): x is T => x !== undefined))];
  const chosen = unique(picked.value.insight_ids.map((id) => byInsight.get(id.trim()))).slice(0, MAX_INSIGHTS);
  const chosenDrills = unique(picked.value.drill_ids.map((id) => byDrill.get(id.trim()))).slice(0, MAX_DRILLS);
  const dropped = picked.value.insight_ids.length + picked.value.drill_ids.length - chosen.length - chosenDrills.length;

  trace({
    agent_name: "developmentAgent",
    action: "verify_picks",
    input_summary: JSON.stringify({ insight_ids: picked.value.insight_ids, drill_ids: picked.value.drill_ids }),
    output_summary: `kept ${chosen.length} insights, ${chosenDrills.length} drills; dropped ${dropped} not on the menu; focus: ${picked.value.focus}`,
    status: chosen.length ? "ok" : "error",
  });
  if (chosen.length === 0) {
    return { ok: false, error: { message: "DevelopmentAgent picked no insight from the menu", attempts: 1 } };
  }

  return {
    ok: true,
    focus: picked.value.focus,
    insights: chosen,
    drills: chosenDrills,
    evidence: {
      ok: true,
      summary: `Focus: ${picked.value.focus}. Coaching insights: ${chosen.map((i) => i.topic).join(", ")}.`,
      call_type_hint: picked.value.call_type_hint,
      sources: chosen.map(insightSource),
      computation: null,
      draft_data: chosen.some((i) => !i.verified),
      missing_facts: [],
    },
  };
}
