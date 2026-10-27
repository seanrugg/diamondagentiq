/**
 * TranslatorAgent: puts a finished answer into the asker's language.
 *
 * It runs after the Critic has passed the English draft, so every grounding
 * check (computed dates, cited rule references, draft-data disclosure) is done
 * once, on the English text. Rule facts stay single-sourced: only the wording
 * is translated, and the sources table is never touched.
 *
 * Code checks the translation before it is used: every key comes back, and
 * every number or date in the English text (rest days, eligible dates, rule
 * numbers, ages) appears unchanged. One retry with the issues; if it still
 * fails, the English answer goes out and the trace says why.
 */
import { z } from "zod";
import { askJson } from "./modelJson.js";
import { trace } from "../trace.js";
import type { SituationAnswer } from "../schemas/situation.js";

export const LANGUAGES = {
  en: "English",
  es: "Spanish",
  ja: "Japanese",
  ko: "Korean",
} as const;
export type LanguageCode = keyof typeof LANGUAGES;

const TranslationSchema = z.object({ texts: z.record(z.string()) });

/** The user-facing wording of an answer, flattened to keyed strings. Sources and ids are left out. */
export function answerTexts(a: SituationAnswer): Record<string, string> {
  const t: Record<string, string> = {};
  const put = (k: string, v: string | null | undefined) => {
    if (typeof v === "string" && v.trim() !== "") t[k] = v;
  };
  put("summary", a.what_happened.summary);
  put("rationale", a.call_type_rationale);
  put("channel_who", a.channel.who);
  put("channel_how", a.channel.how);
  put("teachable", a.teachable_moment);
  put("focus", a.focus);
  a.improvement_plan.individual.forEach((s, i) => put(`plan_individual_${i}`, s));
  a.improvement_plan.team.forEach((s, i) => put(`plan_team_${i}`, s));
  a.improvement_plan.at_home.forEach((s, i) => put(`plan_home_${i}`, s));
  a.missing_facts.forEach((s, i) => put(`missing_${i}`, s));
  if (a.life_lesson) {
    put("life_lesson", a.life_lesson.text);
    a.life_lesson.lessons.forEach((l, i) => { put(`lesson_${i}_title`, l.title); put(`lesson_${i}_principle`, l.principle); });
  }
  (a.situations ?? []).forEach((s, i) => {
    put(`situation_${i}_name`, s.name);
    put(`situation_${i}_offense`, s.offense);
    put(`situation_${i}_defense`, s.defense);
    put(`situation_${i}_mistakes`, s.common_mistakes);
  });
  if (a.story) { put("story_title", a.story.title); put("story", a.story.story); }
  return t;
}

/** Put translated strings back into a copy of the answer. Keys that didn't come back keep their English. */
export function applyTexts(a: SituationAnswer, t: Record<string, string>): SituationAnswer {
  const get = (k: string, fallback: string) => t[k] ?? fallback;
  const out: SituationAnswer = structuredClone(a);
  out.what_happened.summary = get("summary", a.what_happened.summary);
  out.call_type_rationale = get("rationale", a.call_type_rationale);
  out.channel = { who: get("channel_who", a.channel.who), how: get("channel_how", a.channel.how) };
  out.teachable_moment = get("teachable", a.teachable_moment);
  if (a.focus) out.focus = get("focus", a.focus);
  out.improvement_plan = {
    individual: a.improvement_plan.individual.map((s, i) => get(`plan_individual_${i}`, s)),
    team: a.improvement_plan.team.map((s, i) => get(`plan_team_${i}`, s)),
    at_home: a.improvement_plan.at_home.map((s, i) => get(`plan_home_${i}`, s)),
  };
  out.missing_facts = a.missing_facts.map((s, i) => get(`missing_${i}`, s));
  if (a.life_lesson && out.life_lesson) {
    out.life_lesson.text = get("life_lesson", a.life_lesson.text);
    out.life_lesson.lessons = a.life_lesson.lessons.map((l, i) => ({ ...l, title: get(`lesson_${i}_title`, l.title), principle: get(`lesson_${i}_principle`, l.principle) }));
  }
  if (a.situations && out.situations) {
    out.situations = a.situations.map((s, i) => ({
      ...s,
      name: get(`situation_${i}_name`, s.name),
      offense: get(`situation_${i}_offense`, s.offense),
      defense: get(`situation_${i}_defense`, s.defense),
      common_mistakes: s.common_mistakes === null ? null : get(`situation_${i}_mistakes`, s.common_mistakes),
    }));
  }
  if (a.story && out.story) out.story = { ...a.story, title: get("story_title", a.story.title), story: get("story", a.story.story) };
  return out;
}

/** Numbers and dates as written: 68, 2026-10-20, 7.13, 4:00, 10/18. */
const NUMBER = /\d+(?:[.:/-]\d+)*/g;

/** Code checks on a translation: same keys, nothing empty, every number and date unchanged. */
export function translationIssues(source: Record<string, string>, translated: Record<string, string>): string[] {
  const issues: string[] = [];
  for (const [key, text] of Object.entries(source)) {
    const got = translated[key];
    if (typeof got !== "string" || got.trim() === "") {
      issues.push(`Key "${key}" is missing or empty; translate it.`);
      continue;
    }
    // Full-width digits count as the same number.
    const normalized = got.replace(/[０-９]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0));
    for (const n of new Set(text.match(NUMBER) ?? [])) {
      if (!normalized.includes(n)) issues.push(`Key "${key}": keep "${n}" exactly as written.`);
    }
  }
  return issues;
}

export type TranslateResult =
  | { ok: true; answer: SituationAnswer; model: string }
  | { ok: false; reason: string };

/** Split the texts into batches of about maxChars, keeping keys in order (at most maxBatches). */
export function batchTexts(texts: Record<string, string>, maxChars = 2200, maxBatches = 3): Record<string, string>[] {
  const entries = Object.entries(texts);
  const total = entries.reduce((n, [, v]) => n + v.length, 0);
  const target = Math.max(maxChars, Math.ceil(total / maxBatches));
  const batches: Record<string, string>[] = [];
  let cur: Record<string, string> = {};
  let size = 0;
  for (const [k, v] of entries) {
    if (size > 0 && size + v.length > target) { batches.push(cur); cur = {}; size = 0; }
    cur[k] = v; size += v.length;
  }
  if (size > 0) batches.push(cur);
  return batches;
}

export async function translatorAgent(answer: SituationAnswer, language: LanguageCode, role: string): Promise<TranslateResult> {
  const all: Record<string, string> = {};
  let model = "";
  const batches = batchTexts(answerTexts(answer));
  for (const [i, source] of batches.entries()) {
    const r = await translateBatch(source, language, role, `${i + 1}/${batches.length}`);
    if (!r.ok) return { ok: false, reason: r.reason };
    Object.assign(all, r.texts);
    model = r.model;
  }
  return { ok: true, answer: applyTexts(answer, all), model };
}

async function translateBatch(
  source: Record<string, string>,
  language: LanguageCode,
  role: string,
  part: string,
): Promise<{ ok: true; texts: Record<string, string>; model: string } | { ok: false; reason: string }> {
  const name = LANGUAGES[language];
  const system = `You are the TranslatorAgent for DiamondAgentIQ, a learning tool for youth baseball and softball. Translate a finished, reviewed answer for a ${role} into ${name}.

Rules:
- Translate the meaning faithfully. Add nothing, drop nothing, and don't change any advice.
- Keep every number and date exactly as written, in ASCII digits (68, 2026-10-20, Rule 7.13 keeps 7.13).
- Use the everyday baseball and softball terms that coaches, parents and players in ${name}-speaking countries actually use. League names (Little League, USSSA, Pitch Smart) stay as they are.
- Keep the tone warm, plain and encouraging, at a reading level a parent or a 10-year-old can follow.
- The umpire is the authority on the field: keep that message intact.

Reply with ONLY this JSON object, with exactly the same keys: {"texts": {"<key>": "<${name} text>", ...}}`;
  const user = JSON.stringify({ texts: source }, null, 1);

  let messages: Parameters<typeof askJson>[3] = [
    { role: "system", content: system },
    { role: "user", content: user },
  ];
  let reason = "no translation";
  for (let attempt = 1; attempt <= 2; attempt += 1) {
    const result = await askJson("translatorAgent", `translate_${language}`, "super", messages, TranslationSchema);
    if (!result.ok) return { ok: false, reason: result.error.message };
    const issues = translationIssues(source, result.value.texts);
    trace({
      agent_name: "translatorAgent",
      action: "check_translation",
      input_summary: `${name}, part ${part}, attempt ${attempt}/2, ${Object.keys(source).length} texts`,
      output_summary: issues.length ? `issues: ${issues.slice(0, 6).join(" ")}` : "every key back; every number and date unchanged",
      status: issues.length ? "error" : "ok",
    });
    if (issues.length === 0) return { ok: true, texts: result.value.texts, model: result.model };
    reason = issues.slice(0, 3).join(" ");
    messages = [...messages, { role: "assistant", content: JSON.stringify(result.value) }, { role: "user", content: `Fix these and reply with the full corrected JSON object:\n${issues.slice(0, 12).map((i) => `- ${i}`).join("\n")}` }];
  }
  return { ok: false, reason };
}
