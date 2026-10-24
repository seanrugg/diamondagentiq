/**
 * Score one answer against its checklist. Pure: no network, no model.
 * Checks describe what a good answer must contain (cited tables, key ideas,
 * phrases to avoid); they never hold an expected answer, so passing means the
 * app reasoned its way there (AGENTS.md rule 5).
 */
import { z } from "zod";
import type { SituationAnswer } from "../schemas/situation.js";

export const EvalChecksSchema = z.object({
  intent: z.enum(["ruling", "development", "equipment", "general"]).optional(),
  call_type: z.enum(["judgment", "rule", "mixed", "coaching"]).optional(),
  computation: z.record(z.union([z.string(), z.number(), z.boolean(), z.null()])).optional(),
  /** Tables that must appear among the cited sources. */
  cites: z.array(z.string()).default([]),
  /** Each group needs at least one of its phrases somewhere in the answer text. */
  mentions_any: z.array(z.array(z.string()).min(1)).default([]),
  /** Phrases that must not appear. */
  avoid: z.array(z.string()).default([]),
});
export type EvalChecks = z.infer<typeof EvalChecksSchema>;

export const EvalQuestionSchema = z.object({
  id: z.string(),
  request: z.record(z.unknown()),
  today: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  checks: EvalChecksSchema,
});
export const EvalFileSchema = z.object({ questions: z.array(EvalQuestionSchema).min(1) });

export type CheckResult = { check: string; pass: boolean; detail?: string };

/** All the words a reader sees. */
export function answerText(a: SituationAnswer): string {
  return [
    a.what_happened.summary,
    a.channel.who,
    a.channel.how,
    a.teachable_moment,
    ...a.improvement_plan.individual,
    ...a.improvement_plan.team,
    ...a.improvement_plan.at_home,
    a.life_lesson?.text ?? "",
    ...(a.situations ?? []).flatMap((s) => [s.offense, s.defense]),
  ].join("\n");
}

export function scoreAnswer(answer: SituationAnswer, checks: EvalChecks): CheckResult[] {
  const text = answerText(answer).toLowerCase();
  const results: CheckResult[] = [];

  if (checks.intent) results.push({ check: `intent=${checks.intent}`, pass: answer.intent === checks.intent, detail: `got ${answer.intent ?? "none"}` });
  if (checks.call_type) results.push({ check: `call_type=${checks.call_type}`, pass: answer.call_type === checks.call_type, detail: `got ${answer.call_type}` });
  for (const [key, expected] of Object.entries(checks.computation ?? {})) {
    const got = (answer.computation as Record<string, unknown> | null | undefined)?.[key];
    results.push({ check: `computation.${key}=${String(expected)}`, pass: got === expected, detail: `got ${String(got)}` });
  }
  const tables = new Set(answer.sources.map((s) => s.table));
  for (const table of checks.cites) results.push({ check: `cites ${table}`, pass: tables.has(table), detail: `cited ${[...tables].join(", ") || "nothing"}` });
  for (const group of checks.mentions_any) {
    const hit = group.find((p) => text.includes(p.toLowerCase()));
    results.push({ check: `mentions one of: ${group.join(" | ")}`, pass: hit !== undefined, ...(hit ? { detail: hit } : {}) });
  }
  for (const phrase of checks.avoid) {
    results.push({ check: `avoids "${phrase}"`, pass: !text.includes(phrase.toLowerCase()) });
  }
  return results;
}
