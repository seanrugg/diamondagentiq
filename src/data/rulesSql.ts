/**
 * Turn the rules knowledge-base CSVs (data/rules/*.csv) into deterministic
 * INSERT statements for Postgres. Pure: takes CSV text, returns SQL text.
 * Validates the data first so a bad edit fails at build time, not at load.
 */
import { parseCsvRecords } from "./csv.js";

type ColumnType = "text" | "int" | "bool" | "date";
type ColumnSpec = { csv: string; column: string; type: ColumnType; required?: boolean };

const SOURCE_COLUMNS: ColumnSpec[] = [
  { csv: "source_id", column: "source_id", type: "text", required: true },
  { csv: "sanction", column: "sanction", type: "text", required: true },
  { csv: "sport", column: "sport", type: "text", required: true },
  { csv: "title", column: "title", type: "text", required: true },
  { csv: "url", column: "url", type: "text", required: true },
  { csv: "edition", column: "edition", type: "text" },
  { csv: "access", column: "access", type: "text" },
  { csv: "use_note", column: "use_note", type: "text" },
  { csv: "retrieved_on", column: "retrieved_on", type: "date" },
];

const FACT_COLUMNS: ColumnSpec[] = [
  { csv: "fact_id", column: "fact_code", type: "text", required: true },
  { csv: "source_id", column: "source_id", type: "text", required: true },
  { csv: "sport", column: "sport", type: "text", required: true },
  { csv: "sanction", column: "sanction", type: "text", required: true },
  { csv: "division", column: "division", type: "text" },
  { csv: "age_min", column: "age_min", type: "int" },
  { csv: "age_max", column: "age_max", type: "int" },
  { csv: "edition", column: "edition", type: "text" },
  { csv: "topic", column: "topic", type: "text", required: true },
  { csv: "fact_key", column: "fact_key", type: "text", required: true },
  { csv: "fact_value", column: "fact_value", type: "text" },
  { csv: "unit", column: "unit", type: "text" },
  { csv: "rule_ref", column: "rule_ref", type: "text" },
  { csv: "call_type", column: "call_type", type: "text", required: true },
  { csv: "summary", column: "summary", type: "text", required: true },
  { csv: "source_url", column: "source_url", type: "text" },
  { csv: "verified", column: "verified", type: "bool", required: true },
  { csv: "verified_by", column: "verified_by", type: "text" },
  { csv: "retrieved_on", column: "retrieved_on", type: "date" },
  { csv: "verify_note", column: "verify_note", type: "text" },
];

const TIER_COLUMNS: ColumnSpec[] = [
  { csv: "sanction", column: "sanction", type: "text", required: true },
  { csv: "sport", column: "sport", type: "text", required: true },
  { csv: "age_min", column: "age_min", type: "int", required: true },
  { csv: "age_max", column: "age_max", type: "int", required: true },
  { csv: "pitches_min", column: "pitches_min", type: "int", required: true },
  { csv: "pitches_max", column: "pitches_max", type: "int", required: true },
  { csv: "rest_days", column: "rest_days", type: "int", required: true },
  { csv: "edition", column: "edition", type: "text" },
  { csv: "source_url", column: "source_url", type: "text" },
  { csv: "verified", column: "verified", type: "bool", required: true },
  { csv: "source_id", column: "source_id", type: "text", required: true },
];

const INSIGHT_COLUMNS: ColumnSpec[] = [
  { csv: "insight_id", column: "insight_code", type: "text", required: true },
  { csv: "topic", column: "topic", type: "text", required: true },
  { csv: "sport", column: "sport", type: "text", required: true },
  { csv: "age_min", column: "age_min", type: "int" },
  { csv: "age_max", column: "age_max", type: "int" },
  { csv: "audience", column: "audience", type: "text", required: true },
  { csv: "situation", column: "situation", type: "text", required: true },
  { csv: "insight", column: "insight", type: "text", required: true },
  { csv: "why", column: "why", type: "text" },
  { csv: "try_this", column: "try_this", type: "text" },
  { csv: "source_id", column: "source_id", type: "text", required: true },
  { csv: "verified", column: "verified", type: "bool", required: true },
  { csv: "verified_by", column: "verified_by", type: "text" },
  { csv: "verify_note", column: "verify_note", type: "text" },
];

const LESSON_COLUMNS: ColumnSpec[] = [
  { csv: "lesson_id", column: "lesson_code", type: "text", required: true },
  { csv: "title", column: "title", type: "text", required: true },
  { csv: "principle", column: "principle", type: "text", required: true },
  { csv: "life_lesson", column: "life_lesson", type: "text", required: true },
  { csv: "for_player", column: "for_player", type: "text" },
  { csv: "for_coach", column: "for_coach", type: "text" },
  { csv: "for_parent", column: "for_parent", type: "text" },
  { csv: "for_umpire", column: "for_umpire", type: "text" },
  { csv: "tags", column: "tags", type: "text" },
  { csv: "source_id", column: "source_id", type: "text", required: true },
  { csv: "verified", column: "verified", type: "bool", required: true },
  { csv: "verified_by", column: "verified_by", type: "text" },
  { csv: "verify_note", column: "verify_note", type: "text" },
];

const SITUATION_COLUMNS: ColumnSpec[] = [
  { csv: "situation_id", column: "situation_code", type: "text", required: true },
  { csv: "name", column: "name", type: "text", required: true },
  { csv: "topic", column: "topic", type: "text", required: true },
  { csv: "bases", column: "bases", type: "text" },
  { csv: "outs", column: "outs", type: "text" },
  { csv: "count", column: "pitch_count_state", type: "text" },
  { csv: "rule_fact_codes", column: "rule_fact_codes", type: "text" },
  { csv: "offense", column: "offense", type: "text", required: true },
  { csv: "defense", column: "defense", type: "text", required: true },
  { csv: "common_mistakes", column: "common_mistakes", type: "text" },
  { csv: "lesson_ids", column: "lesson_codes", type: "text" },
  { csv: "source_id", column: "source_id", type: "text", required: true },
  { csv: "verified", column: "verified", type: "bool", required: true },
  { csv: "verified_by", column: "verified_by", type: "text" },
  { csv: "verify_note", column: "verify_note", type: "text" },
];

const STORY_COLUMNS: ColumnSpec[] = [
  { csv: "story_id", column: "story_code", type: "text", required: true },
  { csv: "title", column: "title", type: "text", required: true },
  { csv: "story", column: "story", type: "text", required: true },
  { csv: "lesson_ids", column: "lesson_codes", type: "text" },
  { csv: "situation_ids", column: "situation_codes", type: "text" },
  { csv: "source_id", column: "source_id", type: "text", required: true },
  { csv: "verified", column: "verified", type: "bool", required: true },
  { csv: "verified_by", column: "verified_by", type: "text" },
  { csv: "verify_note", column: "verify_note", type: "text" },
];

/** "L001; L002" -> ["L001", "L002"] */
export function splitList(raw: string | undefined): string[] {
  return (raw ?? "").split(";").map((x) => x.trim()).filter(Boolean);
}

const AUDIENCES = new Set(["all", "player", "parent", "coach", "umpire"]);

const SPORTS = new Set(["baseball", "softball", "both"]);
const CALL_TYPES = new Set(["rule", "judgment", "mixed"]);

export type RulesCsvInput = {
  ruleSources: string;
  rulesFacts: string;
  pitchRestRules: string;
  /** data/coaching/insights.csv; optional so older callers keep working. */
  coachingInsights?: string;
  /** data/coaching/lessons.csv, situations.csv, stories.csv (optional). */
  lessons?: string;
  situations?: string;
  stories?: string;
};

export type RulesSqlOutput = {
  sql: string;
  counts: { sources: number; facts: number; tiers: number; insights: number; lessons: number; situations: number; stories: number };
};

/** Quote a value as a SQL literal according to its column type. */
export function sqlLiteral(raw: string, type: ColumnType, where: string): string {
  const value = raw.trim();
  if (value === "") {
    return "NULL";
  }
  switch (type) {
    case "int":
      if (!/^-?\d+$/.test(value)) throw new Error(`${where}: "${value}" is not an integer`);
      return value;
    case "bool":
      if (/^(true|t|1)$/i.test(value)) return "TRUE";
      if (/^(false|f|0)$/i.test(value)) return "FALSE";
      throw new Error(`${where}: "${value}" is not a boolean`);
    case "date":
      if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new Error(`${where}: "${value}" is not YYYY-MM-DD`);
      return `DATE '${value}'`;
    default:
      return `'${value.replace(/'/g, "''")}'`;
  }
}

function toTuple(record: Record<string, string>, specs: ColumnSpec[], where: string): string {
  const values = specs.map((spec) => {
    const raw = record[spec.csv];
    if (raw === undefined) throw new Error(`${where}: missing column ${spec.csv}`);
    if (spec.required && raw.trim() === "") throw new Error(`${where}: ${spec.csv} is required`);
    return sqlLiteral(raw, spec.type, `${where} ${spec.csv}`);
  });
  return `  (${values.join(", ")})`;
}

function insertBlock(table: string, specs: ColumnSpec[], tuples: string[]): string {
  if (tuples.length === 0) return `-- no rows for ${table}\n`;
  const columns = specs.map((s) => s.column).join(", ");
  const chunks: string[] = [];
  for (let i = 0; i < tuples.length; i += 50) {
    chunks.push(`INSERT INTO ${table} (${columns}) VALUES\n${tuples.slice(i, i + 50).join(",\n")};\n`);
  }
  return chunks.join("\n");
}

function optionalBlock(
  text: string | undefined,
  table: string,
  specs: ColumnSpec[],
  rows: Record<string, string>[],
  key: string,
): string[] {
  if (text === undefined) return [];
  const sorted = [...rows].sort((a, b) => ((a[key] ?? "") < (b[key] ?? "") ? -1 : (a[key] ?? "") > (b[key] ?? "") ? 1 : 0));
  return [insertBlock(table, specs, sorted.map((r) => toTuple(r, specs, `${table} ${r[key]}`)))];
}

export function buildRulesSql(input: RulesCsvInput): RulesSqlOutput {
  const sources = parseCsvRecords(input.ruleSources);
  const facts = parseCsvRecords(input.rulesFacts);
  const tiers = parseCsvRecords(input.pitchRestRules);

  const sourceIds = new Set<string>();
  for (const s of sources) {
    const id = s.source_id ?? "";
    if (sourceIds.has(id)) throw new Error(`rule_sources: duplicate source_id ${id}`);
    sourceIds.add(id);
  }

  const factCodes = new Set<string>();
  for (const f of facts) {
    const where = `rules_facts ${f.fact_id}`;
    if (factCodes.has(f.fact_id ?? "")) throw new Error(`${where}: duplicate fact_id`);
    factCodes.add(f.fact_id ?? "");
    if (!sourceIds.has(f.source_id ?? "")) throw new Error(`${where}: unknown source_id ${f.source_id}`);
    if (!SPORTS.has(f.sport ?? "")) throw new Error(`${where}: bad sport ${f.sport}`);
    if (!CALL_TYPES.has(f.call_type ?? "")) throw new Error(`${where}: bad call_type ${f.call_type}`);
  }

  for (const [i, t] of tiers.entries()) {
    const where = `pitch_rest_rules row ${i + 2}`;
    if (!sourceIds.has(t.source_id ?? "")) throw new Error(`${where}: unknown source_id ${t.source_id}`);
    if (t.sport !== "baseball" && t.sport !== "softball") throw new Error(`${where}: bad sport ${t.sport}`);
  }

  const insights = input.coachingInsights === undefined ? [] : parseCsvRecords(input.coachingInsights);
  const insightCodes = new Set<string>();
  for (const c of insights) {
    const where = `coaching_insights ${c.insight_id}`;
    if (insightCodes.has(c.insight_id ?? "")) throw new Error(`${where}: duplicate insight_id`);
    insightCodes.add(c.insight_id ?? "");
    if (!sourceIds.has(c.source_id ?? "")) throw new Error(`${where}: unknown source_id ${c.source_id}`);
    if (!SPORTS.has(c.sport ?? "")) throw new Error(`${where}: bad sport ${c.sport}`);
    if (!AUDIENCES.has(c.audience ?? "")) throw new Error(`${where}: bad audience ${c.audience}`);
    if (!/^[a-z][a-z0-9_]*$/.test(c.topic ?? "")) throw new Error(`${where}: topic must be snake_case`);
  }

  const parseOpt = (text: string | undefined) => (text === undefined ? [] : parseCsvRecords(text));
  const lessons = parseOpt(input.lessons);
  const situations = parseOpt(input.situations);
  const stories = parseOpt(input.stories);

  const uniqueIds = (rows: Record<string, string>[], key: string, table: string): Set<string> => {
    const ids = new Set<string>();
    for (const r of rows) {
      const id = r[key] ?? "";
      if (ids.has(id)) throw new Error(`${table} ${id}: duplicate ${key}`);
      ids.add(id);
      if (!sourceIds.has(r.source_id ?? "")) throw new Error(`${table} ${id}: unknown source_id ${r.source_id}`);
    }
    return ids;
  };
  const checkRefs = (table: string, id: string, refs: string[], known: Set<string>, kind: string) => {
    for (const ref of refs) if (!known.has(ref)) throw new Error(`${table} ${id}: unknown ${kind} ${ref}`);
  };
  const lessonIds = uniqueIds(lessons, "lesson_id", "coaching_lessons");
  const situationIds = uniqueIds(situations, "situation_id", "coaching_situations");
  uniqueIds(stories, "story_id", "coaching_stories");
  for (const l of lessons) {
    for (const tag of splitList(l.tags)) {
      if (!/^[a-z][a-z0-9_]*$/.test(tag)) throw new Error(`coaching_lessons ${l.lesson_id}: tag "${tag}" must be snake_case`);
    }
  }
  for (const s of situations) {
    const id = s.situation_id ?? "";
    if (!/^[a-z][a-z0-9_]*$/.test(s.topic ?? "")) throw new Error(`coaching_situations ${id}: topic must be snake_case`);
    checkRefs("coaching_situations", id, splitList(s.rule_fact_codes), factCodes, "fact");
    checkRefs("coaching_situations", id, splitList(s.lesson_ids), lessonIds, "lesson");
  }
  for (const st of stories) {
    const id = st.story_id ?? "";
    checkRefs("coaching_stories", id, splitList(st.lesson_ids), lessonIds, "lesson");
    checkRefs("coaching_stories", id, splitList(st.situation_ids), situationIds, "situation");
  }

  const byText = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);
  const sortedSources = [...sources].sort((a, b) => byText(a.source_id ?? "", b.source_id ?? ""));
  const sortedFacts = [...facts].sort((a, b) => byText(a.fact_id ?? "", b.fact_id ?? ""));
  const sortedTiers = [...tiers].sort(
    (a, b) =>
      byText(a.sanction ?? "", b.sanction ?? "") ||
      Number(a.age_min) - Number(b.age_min) ||
      Number(a.pitches_min) - Number(b.pitches_min),
  );

  const sql = [
    "-- GENERATED by `npm run rules:build` from data/rules/*.csv. Do not edit by hand.",
    "-- Summaries are our own words; every row cites its source. verified=false until a person checks it.",
    "",
    insertBlock("rule_sources", SOURCE_COLUMNS, sortedSources.map((r) => toTuple(r, SOURCE_COLUMNS, `rule_sources ${r.source_id}`))),
    insertBlock("rules_facts", FACT_COLUMNS, sortedFacts.map((r) => toTuple(r, FACT_COLUMNS, `rules_facts ${r.fact_id}`))),
    insertBlock("pitch_rest_rules", TIER_COLUMNS, sortedTiers.map((r, i) => toTuple(r, TIER_COLUMNS, `pitch_rest_rules row ${i + 2}`))),
    ...(input.coachingInsights === undefined
      ? []
      : [
          insertBlock(
            "coaching_insights",
            INSIGHT_COLUMNS,
            [...insights]
              .sort((a, b) => byText(a.insight_id ?? "", b.insight_id ?? ""))
              .map((r) => toTuple(r, INSIGHT_COLUMNS, `coaching_insights ${r.insight_id}`)),
          ),
        ]),
    ...optionalBlock(input.lessons, "coaching_lessons", LESSON_COLUMNS, lessons, "lesson_id"),
    ...optionalBlock(input.situations, "coaching_situations", SITUATION_COLUMNS, situations, "situation_id"),
    ...optionalBlock(input.stories, "coaching_stories", STORY_COLUMNS, stories, "story_id"),
  ].join("\n");

  return { sql, counts: { sources: sources.length, facts: facts.length, tiers: tiers.length, insights: insights.length, lessons: lessons.length, situations: situations.length, stories: stories.length } };
}
