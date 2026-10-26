/**
 * CoachingAgent (Super): writes the user-facing answer from what the other
 * agents established: the rules found, the computed result, the call type,
 * draft-data status and missing facts. It never decides the numbers; it
 * explains them, points to the right channel, and turns the situation into a
 * teachable moment with a short, age-appropriate improvement plan.
 */
import { z } from "zod";
import type { RulesResult } from "../schemas/rules.js";
import type { SituationRequest } from "../schemas/situation.js";
import type { CallTypeOutput } from "./callTypeAgent.js";
import type { ContextOutput } from "./contextAgent.js";
import type { DevelopmentMode, Drill, Insight, Lesson, Situation, Story } from "./developmentAgent.js";
import { askJson, type JsonAgentResult } from "./modelJson.js";
import { LEARNING_PHILOSOPHY } from "./philosophy.js";

/** Coaching knowledge chosen by DevelopmentAgent. mode "ruling" adds the lesson to a rules answer. */
export type DevelopmentInput = {
  mode: DevelopmentMode;
  focus: string;
  insights: Insight[];
  drills: Drill[];
  lessons: Lesson[];
  situations: Situation[];
  story: Story | null;
};

const ROLE_ANGLE = { player: "for_player", coach: "for_coach", parent: "for_parent", umpire: "for_umpire" } as const;

export function developmentText(dev: DevelopmentInput, role: keyof typeof ROLE_ANGLE = "parent"): string {
  const angle = ROLE_ANGLE[role];
  const lessons = dev.lessons
    .map((l) => `- ${l.id} "${l.title}"${l.verified ? "" : " [draft]"}: ${l.principle} Beyond the diamond: ${l.life_lesson}${l[angle] ? ` For a ${role}: ${l[angle]}` : ""}`)
    .join("\n");
  const situations = dev.situations
    .map((t) => `- ${t.name}${t.verified ? "" : " [draft]"}. Offense: ${t.offense} Defense: ${t.defense}${t.common_mistakes ? ` Common mistakes: ${t.common_mistakes}` : ""} (Applies only where this rule is in effect; see the rule sources.)`)
    .join("\n");
  const story = dev.story ? `"${dev.story.title}"${dev.story.verified ? "" : " [draft]"} (shown to the reader in full next to your answer; connect to it, don't retell it): ${dev.story.story}` : "(none)";
  return `Lessons (philosophy):
${lessons}
Situations (strategy):
${situations || "(none)"}
Coach's story:
${story}
${developmentInsightsText(dev)}`;
}

function developmentInsightsText(dev: DevelopmentInput): string {
  const insights = dev.insights
    .map((i) => `- ${i.id} [${i.topic}${i.verified ? "" : "; draft, not yet reviewed"}]: ${i.insight}${i.why ? ` Why: ${i.why}` : ""}${i.try_this ? ` Try: ${i.try_this}` : ""}`)
    .join("\n");
  const drills = dev.drills
    .map((d) => `- ${d.title} (${d.setting}): ${d.description}${d.safety_notes ? ` Safety: ${d.safety_notes}` : ""}`)
    .join("\n");
  return `Focus (one next step): ${dev.focus}
Coaching insights (build the answer on these; do not add techniques that are not here):
${insights}
Drills:
${drills || "(none)"}`;
}

export const CoachingDraftSchema = z.object({
  what_happened: z.string().min(1),
  channel: z.object({ who: z.string().min(1), how: z.string().min(1) }),
  teachable_moment: z.string().min(1),
  improvement_plan: z.object({
    individual: z.array(z.string()).default([]),
    team: z.array(z.string()).default([]),
    at_home: z.array(z.string()).default([]),
  }),
  /** The life lesson applied to this moment (beyond the diamond). */
  life_lesson: z.string().default(""),
  /** Ids of remembered team facts (MemoryAgent) this answer built on. */
  memory_used: z.array(z.string()).default([]),
});
export type CoachingDraft = z.infer<typeof CoachingDraftSchema>;

type RulesOk = Extract<RulesResult, { ok: true }>;

/** "2026-10-22" -> "Thursday, October 22, 2026" (UTC, no time zone drift). */
export function longDate(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  return new Intl.DateTimeFormat("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(Date.UTC(y ?? 1970, (m ?? 1) - 1, d ?? 1)));
}

export function computedResultText(rules: RulesOk): string {
  const c = rules.computation;
  if (!c) return "No pitch-rest calculation was made.";
  const lines = [
    `Pitches: ${c.pitches} on ${longDate(c.last_pitched_date)}.`,
    `Sanction chart: ${c.sanction_rest_days} calendar day(s) of rest.`,
    c.governing === "house_rule"
      ? `House rule makes it ${c.rest_days} day(s) of rest (stricter, so it governs).`
      : `Required rest: ${c.rest_days} day(s).`,
    `Earliest eligible date: ${longDate(c.earliest_eligible_date)}.`,
  ];
  if (c.game_date) {
    lines.push(
      c.eligible_on_game_date
        ? `Eligible on the game date (${longDate(c.game_date)}).`
        : `NOT eligible on the game date (${longDate(c.game_date)}).`,
    );
  }
  return lines.join(" ");
}

export function coachingAgent(
  request: SituationRequest,
  context: ContextOutput,
  rules: RulesOk,
  callType: CallTypeOutput,
  criticIssues: string[] = [],
  development: DevelopmentInput | null = null,
  memoryContext = "",
): Promise<JsonAgentResult<CoachingDraft>> {
  const sources = rules.sources
    .map((s) => `- ${s.table}:${s.id}${s.rule_ref ? ` (${s.rule_ref})` : ""}${s.synthetic ? " [synthetic demo rule]" : ""}${s.verified ? "" : " [unverified draft]"}: ${s.summary ?? ""}`)
    .join("\n");

  const system = `You are the CoachingAgent for DiamondAgentIQ, a learning tool for youth baseball and softball. Write the answer for a ${request.role}.

${LEARNING_PHILOSOPHY}

Non-negotiable:
- The umpire is the on-field authority. Never rule on a judgment call; explain why it is the umpire's call.
- This is a learning tool, not a protest generator or mid-game replay.
- Use ONLY the rules, coaching insights and computed result given below. Never invent rule numbers; only mention a rule reference that appears in the sources list.
- If the computed result is given, state the earliest eligible date and the game-day answer exactly as given.
${development?.mode === "development" ? "" : "- If any rule source is marked unverified, say plainly that the answer is based on draft rule data that hasn't been verified yet.\n"}- If a house or tournament rule is stricter than the sanction, explain that the stricter rule governs at that event.
- Channel: say who to talk to and how, calmly and at the right time (e.g. the head coach or tournament director, between innings or after the game). Protests are only for rule interpretation, never for judgment.
- Improvement plan: short, concrete, age-appropriate (age ${context.age}) and safety-conscious; no medical advice. For pitching workload, include rest and arm-care habits and point to Pitch Smart; for skills, give simple drills. 1-3 items per list.
- Plain, warm, non-judgmental language. No markdown.
- Write in English even if the question is in another language: the reviewed answer is translated afterwards.
${memoryContext ? "- If something remembered about this team helps, build on it naturally (e.g. what they worked on last time) and list its id in memory_used. Never invent memories.\n" : ""}${development ? `- "life_lesson": 1-3 sentences that apply the given lesson(s) to this moment for a ${request.role}, and say how it reaches beyond the diamond. Encouraging, no blame of players, coaches, parents or umpires. If a coach's story is given, connect to it in a phrase.
` : ""}${development?.mode === "ruling" ? `- After the rule answer, go beyond it: the improvement plan should cover what a good coach would add (for pitching: arm care and rest habits, giving other pitchers reps and confidence, not putting winning above development).
` : ""}${development?.mode === "development" ? `- This is a development question, not a ruling. "what_happened": acknowledge how the moment feels, reframe it as information (process over result), and name the one focus. If the call type is "coaching", don't mention umpires or rules at all; focus on the skill, the effort and the next step. If it involves balls and strikes or another judgment call, say that call belonged to the umpire and that the player controls their readiness and approach, never whether the pitches were really balls. "channel": who should help and how, and when (for a parent: let the player talk first, support rather than instruction, leave technique to the coach). "teachable_moment": the lesson for the player. "improvement_plan": built from the coaching insights and drills given; individual = what the player practises, team = what the coach can run, at_home = what the parent can do.
` : ""}${development ? `- If any lesson, situation, story or insight is marked draft, add one short sentence saying this guidance comes from draft coaching notes that haven't been reviewed yet.
` : ""}
Reply with ONLY this JSON object:
{"what_happened": "<2-4 sentences: the answer and why>", "channel": {"who": "...", "how": "..."}, "teachable_moment": "<1-2 sentences>", "improvement_plan": {"individual": ["..."], "team": ["..."], "at_home": ["..."]}${development ? ', "life_lesson": "<1-3 sentences>"' : ""}${memoryContext ? ', "memory_used": ["mem-..."]' : ""}}`;

  const fix = criticIssues.length
    ? `\n\nA reviewer rejected your previous draft. Fix every issue:\n${criticIssues.map((i) => `- ${i}`).join("\n")}`
    : "";

  const user = `Question: ${request.question}
Role: ${request.role} | Sport: ${context.sport} | Sanction: ${context.sanction} | Age: ${context.age} | Event: ${request.event_name ?? "(none)"}
Call type: ${callType.call_type}. ${callType.rationale}
${development?.mode === "development" ? "Evidence (DevelopmentAgent)" : "Rules found (RulesAgent summary)"}: ${rules.summary}
${development?.mode === "development" ? "" : `Computed result (from code; use exactly): ${computedResultText(rules)}\n`}Draft data: ${rules.draft_data ? "YES (some sources unverified)" : "no"}
Missing facts: ${rules.missing_facts.length ? rules.missing_facts.join("; ") : "(none)"}
Sources:
${sources || "(none)"}${development ? `\n${developmentText(development, request.role)}` : ""}${memoryContext ? `\n${memoryContext}` : ""}${fix}`;

  return askJson("coachingAgent", "draft_answer", "super", [
    { role: "system", content: system },
    { role: "user", content: user },
  ], CoachingDraftSchema);
}
