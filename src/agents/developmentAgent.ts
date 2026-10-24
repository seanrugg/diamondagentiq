/**
 * DevelopmentAgent (Lightning): the teaching layer. On development,
 * equipment and general questions it supplies the whole answer's evidence; on
 * ruling questions it runs alongside RulesAgent and adds the lesson that turns
 * a rule answer into a teachable moment (arm care, depth, team, mistakes).
 *
 * It picks from five kinds of team-vetted material: coaching insights, drills,
 * lessons (philosophy), situations (strategy) and stories.
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
export const MAX_LESSONS = 2;
export const MAX_SITUATIONS = 2;

export type DevelopmentMode = "ruling" | "development";

export const DevelopmentPickSchema = z.object({
  lesson_ids: z.array(z.string()).min(1),
  insight_ids: z.array(z.string()).default([]),
  drill_ids: z.array(z.string()).default([]),
  situation_ids: z.array(z.string()).default([]),
  story_id: z.string().nullish(),
  focus: z.string().min(1),
  call_type_hint: z.enum(["judgment", "rule", "mixed", "coaching"]),
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

export type Lesson = {
  id: string;
  title: string;
  principle: string;
  life_lesson: string;
  for_player: string | null;
  for_coach: string | null;
  for_parent: string | null;
  for_umpire: string | null;
  tags: string[];
  source_url: string | null;
  verified: boolean;
};

export type Situation = {
  id: string;
  name: string;
  topic: string;
  offense: string;
  defense: string;
  common_mistakes: string | null;
  rule_fact_codes: string[];
  lesson_ids: string[];
  source_url: string | null;
  verified: boolean;
};

export type Story = {
  id: string;
  title: string;
  story: string;
  lesson_ids: string[];
  situation_ids: string[];
  source_url: string | null;
  verified: boolean;
};

export type DevelopmentResult =
  | {
      ok: true;
      focus: string;
      insights: Insight[];
      drills: Drill[];
      lessons: Lesson[];
      situations: Situation[];
      story: Story | null;
      /** RulesAgent-shaped evidence for the shared downstream agents. */
      evidence: Extract<RulesResult, { ok: true }>;
    }
  | { ok: false; error: { message: string; attempts: number } };

const str = (v: unknown): string | null => (v === null || v === undefined || v === "" ? null : String(v));
const bool = (v: unknown): boolean => v === true || /^(true|t|1)$/i.test(String(v ?? ""));

const list = (v: unknown): string[] => String(v ?? "").split(";").map((x) => x.trim()).filter(Boolean);

function toLesson(r: Row): Lesson {
  return {
    id: String(r.lesson_code),
    title: String(r.title),
    principle: String(r.principle),
    life_lesson: String(r.life_lesson),
    for_player: str(r.for_player),
    for_coach: str(r.for_coach),
    for_parent: str(r.for_parent),
    for_umpire: str(r.for_umpire),
    tags: list(r.tags),
    source_url: str(r.url),
    verified: bool(r.verified),
  };
}

function toSituation(r: Row): Situation {
  return {
    id: String(r.situation_code),
    name: String(r.name),
    topic: String(r.topic),
    offense: String(r.offense),
    defense: String(r.defense),
    common_mistakes: str(r.common_mistakes),
    rule_fact_codes: list(r.rule_fact_codes),
    lesson_ids: list(r.lesson_codes),
    source_url: str(r.url),
    verified: bool(r.verified),
  };
}

function toStory(r: Row): Story {
  return {
    id: String(r.story_code),
    title: String(r.title),
    story: String(r.story),
    lesson_ids: list(r.lesson_codes),
    situation_ids: list(r.situation_codes),
    source_url: str(r.url),
    verified: bool(r.verified),
  };
}

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

const byId = <T extends { id: string }>(a: T, b: T) => a.id.localeCompare(b.id);

export async function fetchLessons(): Promise<Lesson[]> {
  const rows = await runAgentRows(
    `SELECT l.lesson_code, l.title, l.principle, l.life_lesson, l.for_player, l.for_coach, l.for_parent, l.for_umpire, l.tags, l.verified, s.url FROM diq_pg.coaching_lessons l JOIN diq_pg.rule_sources s ON l.source_id = s.source_id`,
  );
  return rows.map(toLesson).sort(byId);
}

export async function fetchSituations(): Promise<Situation[]> {
  const rows = await runAgentRows(
    `SELECT t.situation_code, t.name, t.topic, t.offense, t.defense, t.common_mistakes, t.rule_fact_codes, t.lesson_codes, t.verified, s.url FROM diq_pg.coaching_situations t JOIN diq_pg.rule_sources s ON t.source_id = s.source_id`,
  );
  return rows.map(toSituation).sort(byId);
}

export async function fetchStories(): Promise<Story[]> {
  const rows = await runAgentRows(
    `SELECT t.story_code, t.title, t.story, t.lesson_codes, t.situation_codes, t.verified, s.url FROM diq_pg.coaching_stories t JOIN diq_pg.rule_sources s ON t.source_id = s.source_id`,
  );
  return rows.map(toStory).sort(byId);
}

function coachingSource(table: RuleSource["table"], id: string, url: string | null, verified: boolean, summary: string): RuleSource {
  return { table, id, rule_ref: null, source_url: url, edition: null, verified, synthetic: false, call_type: null, summary };
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
  mode: DevelopmentMode = "development",
  /** Ruling mode: what RulesAgent found, so the lesson fits the actual answer. */
  ruleSummary?: string,
  /** MemoryAgent recall, so picks can build on what this team already worked on. */
  memoryContext = "",
): Promise<DevelopmentResult> {
  const [insights, drills, lessons, situations, stories] = await Promise.all([
    fetchInsights(context.sport, context.age),
    fetchDrills(context.age),
    fetchLessons(),
    fetchSituations(),
    fetchStories(),
  ]);
  if (lessons.length === 0) {
    return { ok: false, error: { message: "No coaching lessons loaded (run npm run rules:load)", attempts: 0 } };
  }

  const menu = [
    "Lessons (philosophy):",
    ...lessons.map((l) => `- ${l.id} "${l.title}" [${l.tags.join(", ")}]: ${l.principle}`),
    "Situations (strategy):",
    ...(situations.length ? situations.map((t) => `- ${t.id} ${t.name}`) : ["(none)"]),
    "Stories (real coaching moments):",
    ...(stories.length ? stories.map((t) => `- ${t.id} "${t.title}" (lessons ${t.lesson_ids.join(", ")}; situations ${t.situation_ids.join(", ") || "none"})`) : ["(none)"]),
    "Coaching insights:",
    ...insights.map((i) => `- ${i.id} [${i.topic}; for ${i.audience}] when: ${i.situation} | ${i.insight}`),
    "Drills:",
    ...(drills.length ? drills.map((d) => `- ${d.id} [${d.skill}; ${d.setting}] ${d.title}`) : ["(none)"]),
  ].join("\n");

  const modeLine =
    mode === "ruling"
      ? "A rules answer is being built separately. Your job is what goes beyond the rule: pick the lesson that turns it into a teachable moment (for pitching questions think arm care, building other pitchers' confidence and depth, and not putting winning above everything), plus insights that help (e.g. workload, arm care)."
      : "Pick what best helps the person grow from this moment.";

  const system = `You are the DevelopmentAgent for DiamondAgentIQ, a youth baseball/softball learning tool focused on education, encouragement and keeping everyone positively engaged. ${modeLine}
Pick ONLY ids from the menus:
- 1-${MAX_LESSONS} lessons (required): the life lesson this moment teaches.
- 0-${MAX_SITUATIONS} situations: only if the question is about that game situation.
- story_id: a story only if it truly fits the moment; otherwise null.
- 0-${MAX_INSIGHTS} insights (prefer ones for a ${request.role} or "all") and 0-${MAX_DRILLS} drills.
Name ONE focus: the single most useful next step, in a few plain words.
call_type_hint: "judgment" if the question involves what the umpire saw (balls and strikes, safe/out), "rule" if a written rule decides it, "mixed" if both, "coaching" if no call or rule is involved (skills, confidence, effort).
Reply with ONLY: {"lesson_ids": ["L001"], "situation_ids": [], "story_id": null, "insight_ids": [], "drill_ids": [], "focus": "...", "call_type_hint": "judgment"|"coaching"|"rule"|"mixed"}`;

  const user = `Question (${request.role}): ${request.question}
Sport/age: ${context.sport} / ${context.age} | Topic: ${context.topic}
${ruleSummary ? `Rules answer already found: ${ruleSummary}\n` : ""}${memoryContext ? `${memoryContext.replace(/; list the ids you use in memory_used/, "")}\n` : ""}${menu}`;

  const picked = await askJson("developmentAgent", `pick_${mode}`, "lightning", [
    { role: "system", content: system },
    { role: "user", content: user },
  ], DevelopmentPickSchema);
  if (!picked.ok) return { ok: false, error: picked.error };

  // Keep only ids that were on the menu, in the model's order, deduplicated.
  const keep = <T extends { id: string }>(items: T[], ids: string[], max: number): T[] => {
    const map = new Map(items.map((x) => [x.id, x]));
    const out: T[] = [];
    for (const id of ids) {
      const item = map.get(id.trim());
      if (item && !out.includes(item)) out.push(item);
    }
    return out.slice(0, max);
  };
  const p = picked.value;
  const chosenLessons = keep(lessons, p.lesson_ids, MAX_LESSONS);
  const chosenSituations = keep(situations, p.situation_ids, MAX_SITUATIONS);
  const chosenInsights = keep(insights, p.insight_ids, MAX_INSIGHTS);
  const chosenDrills = keep(drills, p.drill_ids, MAX_DRILLS);
  const story = p.story_id ? (stories.find((t) => t.id === p.story_id?.trim()) ?? null) : null;
  const asked = p.lesson_ids.length + p.situation_ids.length + p.insight_ids.length + p.drill_ids.length + (p.story_id ? 1 : 0);
  const kept = chosenLessons.length + chosenSituations.length + chosenInsights.length + chosenDrills.length + (story ? 1 : 0);

  trace({
    agent_name: "developmentAgent",
    action: "verify_picks",
    input_summary: JSON.stringify(p),
    output_summary: `mode=${mode}; kept lessons ${chosenLessons.map((l) => l.id).join(",") || "none"}, situations ${chosenSituations.length}, story ${story?.id ?? "none"}, insights ${chosenInsights.length}, drills ${chosenDrills.length}; dropped ${asked - kept} not on the menu; focus: ${p.focus}`,
    status: chosenLessons.length ? "ok" : "error",
  });
  if (chosenLessons.length === 0) {
    return { ok: false, error: { message: "DevelopmentAgent picked no lesson from the menu", attempts: 1 } };
  }

  const sources: RuleSource[] = [
    ...chosenLessons.map((l) => coachingSource("coaching_lessons", l.id, l.source_url, l.verified, `${l.title}: ${l.principle}`)),
    ...chosenSituations.map((t) => coachingSource("coaching_situations", t.id, t.source_url, t.verified, t.name)),
    ...(story ? [coachingSource("coaching_stories", story.id, story.source_url, story.verified, story.title)] : []),
    ...chosenInsights.map(insightSource),
  ];

  return {
    ok: true,
    focus: p.focus,
    insights: chosenInsights,
    drills: chosenDrills,
    lessons: chosenLessons,
    situations: chosenSituations,
    story,
    evidence: {
      ok: true,
      summary: `Focus: ${p.focus}. Lessons: ${chosenLessons.map((l) => l.title).join("; ")}.${chosenSituations.length ? ` Situations: ${chosenSituations.map((t) => t.name).join("; ")}.` : ""}`,
      call_type_hint: p.call_type_hint,
      sources,
      computation: null,
      draft_data: sources.some((x) => !x.verified),
      missing_facts: [],
    },
  };
}
