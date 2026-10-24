/**
 * CallTypeAgent (Lightning): is this situation the umpire's judgment, a rule
 * application, or a mix (judgment decides what happened, a rule sets the
 * award or penalty)? It reasons from the situation plus the call_type of
 * every fact RulesAgent cited, so the classification is grounded in data.
 */
import { z } from "zod";
import type { RulesResult } from "../schemas/rules.js";
import type { SituationRequest } from "../schemas/situation.js";
import type { ContextOutput } from "./contextAgent.js";
import { askJson, type JsonAgentResult } from "./modelJson.js";

export const CallTypeOutputSchema = z.object({
  call_type: z.enum(["judgment", "rule", "mixed", "coaching"]),
  rationale: z.string().min(1),
  judgment_parts: z.array(z.string()).default([]),
  rule_parts: z.array(z.string()).default([]),
});
export type CallTypeOutput = z.infer<typeof CallTypeOutputSchema>;

type RulesOk = Extract<RulesResult, { ok: true }>;

export function callTypeAgent(
  request: SituationRequest,
  context: ContextOutput,
  rules: RulesOk,
): Promise<JsonAgentResult<CallTypeOutput>> {
  const facts = rules.sources
    .filter((s) => s.table === "rules_facts")
    .map((s) => `- ${s.id} [${s.call_type ?? "unknown"}]: ${s.summary ?? ""}`)
    .join("\n");

  const system = `You are the CallTypeAgent for DiamondAgentIQ. Classify a youth baseball/softball situation:
- "judgment": the outcome rests on what the umpire saw (ball/strike, safe/out, fair/foul, whether obstruction or interference happened). Never reviewable by protest.
- "rule": the outcome follows from a written rule once the facts are known (pitch counts and rest, eligibility, base awards for a known event).
- "mixed": judgment decides whether something happened, then a rule sets the award or penalty.
- "coaching": no umpire call and no rule is in question: a skills, confidence, effort or development question (for example "help with my swing", "my hitter is scared at the plate"). Use it only when nothing about a call or a rule is being asked.
Each cited fact is tagged with its own call_type; use them. Reply with ONLY this JSON object:
{"call_type": "judgment"|"rule"|"mixed"|"coaching", "rationale": "<1-2 sentences in plain words>", "judgment_parts": ["..."], "rule_parts": ["..."]}`;

  const user = `Question (${request.role}): ${request.question}
Sport/sanction/age: ${context.sport} / ${context.sanction} / ${context.age}
Topic: ${context.topic}
RulesAgent's suggestion: ${rules.call_type_hint}
Cited facts:
${facts || "(none)"}`;

  return askJson("callTypeAgent", "classify_call", "lightning", [
    { role: "system", content: system },
    { role: "user", content: user },
  ], CallTypeOutputSchema);
}
