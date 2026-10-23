/**
 * CriticAgent: reviews a draft answer before it reaches the user.
 * 1. Deterministic checks in code (grounding that must never slip):
 *    the computed date is stated, draft data is disclosed, no rule number
 *    appears that isn't in the cited sources, the plan isn't empty.
 * 2. A Lightning-tier review of the guardrails code can't check:
 *    umpire authority, no ruling on judgment, calm channel, safe and
 *    age-appropriate advice, no medical advice.
 * The orchestrator sends failing drafts back to CoachingAgent (max 2 retries).
 */
import { z } from "zod";
import type { RulesResult } from "../schemas/rules.js";
import type { SituationRequest } from "../schemas/situation.js";
import type { CallTypeOutput } from "./callTypeAgent.js";
import type { CoachingDraft } from "./coachingAgent.js";
import { askJson, type JsonAgentResult } from "./modelJson.js";

type RulesOk = Extract<RulesResult, { ok: true }>;

export const CriticOutputSchema = z.object({
  pass: z.boolean(),
  issues: z.array(z.string()).default([]),
});
export type CriticOutput = z.infer<typeof CriticOutputSchema>;

function draftText(draft: CoachingDraft): string {
  return [
    draft.what_happened,
    draft.channel.who,
    draft.channel.how,
    draft.teachable_moment,
    draft.life_lesson,
    ...draft.improvement_plan.individual,
    ...draft.improvement_plan.team,
    ...draft.improvement_plan.at_home,
  ].join("\n");
}

/** Ways a YYYY-MM-DD date may legitimately appear in prose. */
function dateForms(iso: string): string[] {
  const [y, m, d] = iso.split("-").map(Number);
  const month = new Intl.DateTimeFormat("en-US", { month: "long", timeZone: "UTC" }).format(
    new Date(Date.UTC(y ?? 1970, (m ?? 1) - 1, d ?? 1)),
  );
  return [iso, `${month} ${d}`, `${month.slice(0, 3)} ${d}`, `${m}/${d}`];
}

const RULE_REF = /\b(?:Rule|Regulation|Reg\.)\s+[0-9IVX][\w.()-]*/gi;

export function deterministicChecks(draft: CoachingDraft, rules: RulesOk, needsLesson = false): string[] {
  const text = draftText(draft);
  const issues: string[] = [];

  const c = rules.computation;
  if (c && !dateForms(c.earliest_eligible_date).some((f) => text.includes(f))) {
    issues.push(`State the earliest eligible date exactly as computed (${c.earliest_eligible_date}).`);
  }
  if (c?.game_date && c.eligible_on_game_date === false && !/\bnot\b|\bcan't\b|\bcannot\b|\bisn't\b/i.test(draft.what_happened)) {
    issues.push("Say clearly that the player is not eligible on the game date.");
  }
  if (rules.draft_data && !/\b(draft|unverified|not yet verified|hasn't been verified|has not been verified)\b/i.test(text)) {
    issues.push(
      rules.sources.every((s) => s.table.startsWith("coaching_"))
        ? "Add one short sentence saying this guidance comes from draft coaching notes that haven't been reviewed yet."
        : "Disclose that the answer is based on draft rule data that hasn't been verified yet.",
    );
  }

  const cited = rules.sources.map((s) => (s.rule_ref ?? "").toLowerCase()).join(" | ");
  for (const ref of text.match(RULE_REF) ?? []) {
    if (!cited.includes(ref.toLowerCase().replace(/[.,;:]$/, ""))) {
      issues.push(`Remove the rule reference "${ref}": it is not in the cited sources.`);
    }
  }

  if (needsLesson && draft.life_lesson.trim() === "") {
    issues.push("Add the life_lesson: 1-3 sentences applying the given lesson to this moment.");
  }

  const plan = draft.improvement_plan;
  if (plan.individual.length + plan.team.length + plan.at_home.length === 0) {
    issues.push("Add at least one improvement-plan item.");
  }
  return issues;
}

export function criticAgent(
  request: SituationRequest,
  draft: CoachingDraft,
  callType: CallTypeOutput,
  age: number,
): Promise<JsonAgentResult<CriticOutput>> {
  const system = `You are the CriticAgent for DiamondAgentIQ. Review a draft answer for a youth baseball/softball ${request.role}. Fail it ONLY for real problems:
- It rules on a judgment call, second-guesses the umpire, or undermines the umpire's authority.
- It encourages a protest or confrontation over a judgment call, or suggests arguing during play.
- The channel is missing, vague, or not calm and respectful.
- Advice is unsafe, not appropriate for age ${age}, or gives medical advice.
- It is not written in plain, respectful language for a ${request.role}.
- It blames or shames a player, coach, parent or umpire, or is discouraging. The app's job is education and encouragement: mistakes are chances to learn, and everyone is human.
- It puts winning above a player's health or development.
Do not fail it for style preferences. Reply with ONLY: {"pass": true|false, "issues": ["<specific fix>", ...]}`;

  const user = `Question: ${request.question}
Call type: ${callType.call_type} (${callType.rationale})
Draft:
${JSON.stringify(draft, null, 2)}`;

  return askJson("criticAgent", "review_draft", "lightning", [
    { role: "system", content: system },
    { role: "user", content: user },
  ], CriticOutputSchema);
}
