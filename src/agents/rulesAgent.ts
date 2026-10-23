/**
 * RulesAgent: finds the rules that apply to a situation and, for pitch-rest
 * questions, works out eligibility.
 *
 * Division of labour (AGENTS.md rule 4):
 * - The model decides WHAT applies. It looks up rules_facts and house_rules
 *   through the read-only run_sql tool (max 4 calls), cites what it used, and
 *   turns house-rule text into structure (e.g. "+1 day after 21+ pitches").
 * - Code does the numbers. It checks every cited id was actually returned by
 *   a lookup, fetches the pitch-rest tiers and source details itself, resolves
 *   dates, and computes rest days and the earliest eligible date.
 *
 * The model's reasoning and the Meterless receipt go to the trace only.
 */
import type { ChatCompletionMessageParam } from "openai/resources/chat/completions";
import { generator } from "../adapters/llm.js";
import { runAgentRows, run_sql } from "../adapters/dataTools.js";
import type { Row } from "../adapters/rows.js";
import { resolveDate } from "../calculators/dates.js";
import {
  applyHouseRuleAdjustment,
  earliestEligibleDate,
  restDaysRequired,
  type HouseRuleAdjustment,
} from "../calculators/pitchRest.js";
import {
  RulesModelOutputSchema,
  type PitchRestComputation,
  type RuleSource,
  type RulesModelOutput,
  type RulesResult,
} from "../schemas/rules.js";
import type { SituationRequest } from "../schemas/situation.js";
import { trace } from "../trace.js";
import type { ContextOutput } from "./contextAgent.js";
import { parseModelJson } from "./json.js";

export const MAX_TOOL_CALLS = 4;
const MAX_ANSWER_ATTEMPTS = 2;
const MAX_MODEL_CALLS = MAX_TOOL_CALLS + MAX_ANSWER_ATTEMPTS + 2;
const TOOL_RESULT_CHAR_LIMIT = 6000;
const AGENT = "rulesAgent";

type Seen = { rules_facts: Set<string>; house_rules: Set<string> };

function systemPrompt(): string {
  return `You are the RulesAgent for DiamondAgentIQ, which helps parents, coaches and umpires understand youth baseball and softball rulings.

Your job: find the rules that apply to the situation, using the run_sql tool, then report them as JSON.

Data (Zetaris, schema diq_pg). Always list columns explicitly; never SELECT *.
- diq_pg.rules_facts: fact_code, sanction, sport ('baseball'|'softball'|'both'), division, age_min, age_max, topic, fact_key, fact_value, unit, rule_ref, call_type ('rule'|'judgment'|'mixed'), summary, verified
  topic values include: pitch_count, pitch_rest, pitching_innings, catcher, protest, judgment, obstruction, uncaught_third_strike, courtesy_runner, equipment, baserunning, field, age, conduct, channel
- diq_pg.house_rules: id, event_name, sanction, sport, age_group, topic, rule_text, overrides_fact_key, synthetic
- Filter rules_facts by sanction, and by sport IN ('<sport>', 'both'). Age columns may be NULL (applies to all ages).
- If the request names an event, look up house_rules for that event_name.

Rules you must follow:
- Cite only fact_code values (rules_facts) and id values (house_rules) that your queries actually returned.
- Never invent rule numbers and never quote a rulebook. Your summary is in your own words, built from the facts you found.
- Do NOT calculate rest days or dates yourself, and do NOT search for the pitch-count rest chart. Code looks up the chart
  (pitch_rest_rules), turns weekday names into dates, and computes the rest days and the earliest eligible date. Just say
  whether the pitch-rest calculation applies, and don't list the chart, rest thresholds or calendar dates as missing facts.
- Your summary should explain which rules apply and why. Don't hedge about the eligible date; code reports it alongside your summary.
- If a house rule changes pitching rest, express it as structure:
  {"house_rule_id": "<id>", "kind": "add_days", "min_pitches": <n>, "days": <n>}  (extra days after outings of at least n pitches)
  or {"house_rule_id": "<id>", "kind": "absolute", "rest_days": <n>}
- Judgment calls (balls and strikes, safe or out, whether obstruction happened) belong to the umpire. Never rule on them; say which part is judgment.
- You have at most ${MAX_TOOL_CALLS} tool calls. Two or three are usually enough.

When you are done, reply with ONLY this JSON object (no prose, no code fences):
{
  "facts_used": [{"table": "rules_facts" | "house_rules", "id": "<fact_code or house rule id>"}],
  "applies_pitch_rest": true | false,
  "house_rule_adjustment": { ... } | null,
  "summary": "<2-4 sentences in your own words>",
  "call_type_hint": "rule" | "judgment" | "mixed",
  "missing_facts": ["<facts needed but not provided>"]
}`;
}

function userPrompt(request: SituationRequest, context: ContextOutput, referenceDate: string): string {
  return `Situation:
- question: ${request.question}
- role: ${request.role}
- sport: ${context.sport}
- sanction: ${context.sanction}
- age: ${context.age}
- event: ${request.event_name ?? "(none)"}
- today: ${referenceDate}
- extracted entities: ${JSON.stringify(context.entities)}
- topic: ${context.topic}`;
}

function rememberIds(sql: string, rows: Row[], seen: Seen): void {
  const mentionsFacts = /\brules_facts\b/i.test(sql);
  const mentionsHouse = /\bhouse_rules\b/i.test(sql);
  for (const row of rows) {
    if (row.fact_code) seen.rules_facts.add(row.fact_code);
    if (row.id && mentionsHouse && !mentionsFacts) seen.house_rules.add(row.id);
  }
}

function unknownCitations(output: RulesModelOutput, seen: Seen): string[] {
  const unknown = output.facts_used
    .filter((f) => !seen[f.table].has(f.id))
    .map((f) => `${f.table}:${f.id}`);
  const adj = output.house_rule_adjustment;
  if (adj && !seen.house_rules.has(adj.house_rule_id)) {
    unknown.push(`house_rules:${adj.house_rule_id}`);
  }
  return unknown;
}

const isTrue = (v: string | null | undefined) => /^(true|t|1)$/i.test(String(v ?? ""));
const quoteList = (ids: string[]) => ids.map((id) => `'${id}'`).join(", ");

async function runToolCall(sql: string, seen: Seen): Promise<string> {
  try {
    const rows = await runAgentRows(sql);
    rememberIds(sql, rows, seen);
    const text = JSON.stringify(rows);
    return text.length > TOOL_RESULT_CHAR_LIMIT
      ? `${text.slice(0, TOOL_RESULT_CHAR_LIMIT)} ... (truncated; ${rows.length} rows total, narrow the query)`
      : text;
  } catch (error) {
    return `ERROR: ${error instanceof Error ? error.message : String(error)}`;
  }
}

/** Ask the model, run its lookups, and return a validated, citation-checked answer. */
async function askModel(
  request: SituationRequest,
  context: ContextOutput,
  referenceDate: string,
): Promise<{ ok: true; output: RulesModelOutput } | { ok: false; message: string; attempts: number }> {
  const seen: Seen = { rules_facts: new Set(), house_rules: new Set() };
  const messages: ChatCompletionMessageParam[] = [
    { role: "system", content: systemPrompt() },
    { role: "user", content: userPrompt(request, context, referenceDate) },
  ];
  let toolCallsUsed = 0;
  let answerAttempts = 0;
  let lastIssue = "no answer";

  for (let step = 0; step < MAX_MODEL_CALLS; step += 1) {
    const toolsAllowed = toolCallsUsed < MAX_TOOL_CALLS;
    const result = await generator(messages, {
      tier: "super",
      ...(toolsAllowed ? { tools: [run_sql] } : {}),
    });
    trace({
      agent_name: AGENT,
      action: "model_step",
      input_summary: `step ${step + 1}; tool calls used ${toolCallsUsed}/${MAX_TOOL_CALLS}`,
      output_summary: result.toolCalls.length
        ? `requested ${result.toolCalls.length} tool call(s)`
        : (result.content ?? "(no content)").slice(0, 300),
      model: result.model,
      provider: result.provider,
      reasoning: result.reasoning,
      receipt: result.receipt,
      status: "ok",
    });

    if (result.toolCalls.length > 0) {
      messages.push({ role: "assistant", content: result.content ?? null, tool_calls: result.toolCalls });
      for (const call of result.toolCalls) {
        let content: string;
        if (toolCallsUsed >= MAX_TOOL_CALLS) {
          content = "ERROR: tool budget used up. Answer now with the JSON object.";
        } else {
          toolCallsUsed += 1;
          let sql = "";
          try {
            sql = String((JSON.parse(call.function.arguments) as { sql?: unknown }).sql ?? "");
          } catch {
            sql = "";
          }
          content = sql ? await runToolCall(sql, seen) : 'ERROR: arguments must be JSON like {"sql": "SELECT ..."}';
        }
        messages.push({ role: "tool", tool_call_id: call.id, content });
      }
      if (toolCallsUsed >= MAX_TOOL_CALLS) {
        messages.push({
          role: "user",
          content: "You have used all your tool calls. Reply now with only the JSON object.",
        });
      }
      continue;
    }

    answerAttempts += 1;
    const parsed = parseModelJson(result.content ?? "");
    let issue: string | null = null;
    let output: RulesModelOutput | null = null;
    if (!parsed.ok) {
      issue = `Invalid JSON: ${parsed.error}`;
    } else {
      const validation = RulesModelOutputSchema.safeParse(parsed.value);
      if (!validation.success) {
        issue = `Schema error: ${validation.error.message}`;
      } else {
        const unknown = unknownCitations(validation.data, seen);
        if (unknown.length > 0) {
          issue = `You cited ids your queries never returned: ${unknown.join(", ")}. Cite only returned fact_code/id values, or remove them.`;
        } else {
          output = validation.data;
        }
      }
    }

    if (output) {
      return { ok: true, output };
    }
    lastIssue = issue ?? "invalid answer";
    trace({ agent_name: AGENT, action: "validate_answer", input_summary: `attempt ${answerAttempts}`, output_summary: lastIssue, status: "error" });
    if (answerAttempts >= MAX_ANSWER_ATTEMPTS) {
      return { ok: false, message: lastIssue, attempts: answerAttempts };
    }
    messages.push({ role: "assistant", content: result.content ?? "" });
    messages.push({ role: "user", content: `${lastIssue}\nReply with only the corrected JSON object.` });
  }

  return { ok: false, message: `Stopped after ${MAX_MODEL_CALLS} model calls: ${lastIssue}`, attempts: answerAttempts };
}

async function fetchFactSources(codes: string[]): Promise<RuleSource[]> {
  const safe = codes.filter((c) => /^F\d+$/.test(c));
  if (safe.length === 0) return [];
  const rows = await runAgentRows(
    `SELECT f.fact_code, f.rule_ref, f.verified, s.url, s.edition FROM diq_pg.rules_facts f JOIN diq_pg.rule_sources s ON f.source_id = s.source_id WHERE f.fact_code IN (${quoteList(safe)})`,
  );
  return rows.map((r) => ({
    table: "rules_facts" as const,
    id: r.fact_code ?? "",
    rule_ref: r.rule_ref ?? null,
    source_url: r.url ?? null,
    edition: r.edition ?? null,
    verified: isTrue(r.verified),
    synthetic: false,
  }));
}

async function fetchHouseRuleSources(ids: string[]): Promise<RuleSource[]> {
  const safe = ids.filter((id) => /^[0-9a-f-]{36}$/i.test(id));
  if (safe.length === 0) return [];
  const rows = await runAgentRows(
    `SELECT id, event_name, section, source_file, synthetic FROM diq_pg.house_rules WHERE id IN (${quoteList(safe)})`,
  );
  return rows.map((r) => ({
    table: "house_rules" as const,
    id: r.id ?? "",
    rule_ref: [r.event_name, r.section].filter(Boolean).join(", ") || null,
    source_url: r.source_file ?? null,
    edition: null,
    verified: false,
    synthetic: isTrue(r.synthetic),
  }));
}

async function computePitchRest(
  context: ContextOutput,
  referenceDate: string,
  adjustment: RulesModelOutput["house_rule_adjustment"],
  missing: string[],
): Promise<{ computation: PitchRestComputation | null; tierSource: RuleSource | null }> {
  const pitches = context.entities.pitches;
  const lastRaw = context.entities.last_pitched_date;
  const gameRaw = context.entities.game_date;

  if (pitches === undefined) missing.push("pitch count from the last outing");
  const last = lastRaw ? resolveDate(String(lastRaw), referenceDate, "on_or_before") : null;
  if (!last) missing.push("date of the last outing");
  const game = gameRaw ? resolveDate(String(gameRaw), referenceDate, "on_or_after") : null;
  if (gameRaw && !game) missing.push("date of the upcoming game");
  if (pitches === undefined || !last) return { computation: null, tierSource: null };

  if (!/^[a-z_]+$/.test(context.sanction) || !/^(baseball|softball)$/.test(context.sport)) {
    missing.push("a recognised sanction and sport");
    return { computation: null, tierSource: null };
  }
  const tiers = await runAgentRows(
    `SELECT age_min, age_max, pitches_min, pitches_max, rest_days, source_id, verified FROM diq_pg.pitch_rest_rules WHERE sanction = '${context.sanction}' AND sport = '${context.sport}'`,
  );
  const tierRows = tiers.map((t) => ({
    age_min: t.age_min ?? "",
    age_max: t.age_max ?? "",
    pitches_min: t.pitches_min ?? "",
    pitches_max: t.pitches_max ?? "",
    rest_days: t.rest_days ?? "",
  }));
  const match = restDaysRequired(pitches, context.age, tierRows);
  if (match.kind !== "match") {
    missing.push(
      `a pitch-rest tier for age ${context.age} and ${pitches} pitches under ${context.sanction} (it may use innings limits instead)`,
    );
    return { computation: null, tierSource: null };
  }

  const matchedRow = tiers.find(
    (t) =>
      Number(t.age_min) === match.tier.age_min &&
      Number(t.pitches_min) === match.tier.pitches_min,
  );
  let tierSource: RuleSource | null = null;
  if (matchedRow?.source_id && /^[A-Za-z0-9-]+$/.test(matchedRow.source_id)) {
    const [src] = await runAgentRows(
      `SELECT source_id, url, edition FROM diq_pg.rule_sources WHERE source_id = '${matchedRow.source_id}'`,
    );
    tierSource = {
      table: "pitch_rest_rules",
      id: `${matchedRow.source_id}: age ${match.tier.age_min}-${match.tier.age_max}, ${match.tier.pitches_min}-${match.tier.pitches_max} pitches`,
      rule_ref: null,
      source_url: src?.url ?? null,
      edition: src?.edition ?? null,
      verified: isTrue(matchedRow.verified),
      synthetic: false,
    };
  }

  const houseAdjustment: HouseRuleAdjustment | undefined = adjustment
    ? adjustment.kind === "add_days"
      ? { kind: "add_days", min_pitches: adjustment.min_pitches, days: adjustment.days }
      : { kind: "absolute", rest_days: adjustment.rest_days }
    : undefined;
  const resolved = applyHouseRuleAdjustment(match.rest_days, pitches, houseAdjustment);
  const earliest = earliestEligibleDate(last, resolved.rest_days);

  return {
    computation: {
      pitches,
      age: context.age,
      last_pitched_date: last,
      game_date: game,
      sanction_rest_days: match.rest_days,
      rest_days: resolved.rest_days,
      governing: resolved.governing,
      conflict: resolved.conflict,
      house_rule_id: adjustment?.house_rule_id ?? null,
      earliest_eligible_date: earliest,
      eligible_on_game_date: game ? game >= earliest : null,
    },
    tierSource,
  };
}

export async function rulesAgent(
  request: SituationRequest,
  context: ContextOutput,
  referenceDate: string,
): Promise<RulesResult> {
  const answer = await askModel(request, context, referenceDate);
  if (!answer.ok) {
    trace({ agent_name: AGENT, action: "rules_result", input_summary: request.question, output_summary: answer.message, status: "error" });
    return { ok: false, error: { message: answer.message, attempts: answer.attempts } };
  }
  const output = answer.output;
  const missing = [...output.missing_facts];

  const factCodes = output.facts_used.filter((f) => f.table === "rules_facts").map((f) => f.id);
  const houseIds = [
    ...output.facts_used.filter((f) => f.table === "house_rules").map((f) => f.id),
    ...(output.house_rule_adjustment ? [output.house_rule_adjustment.house_rule_id] : []),
  ];
  const sources: RuleSource[] = [
    ...(await fetchFactSources([...new Set(factCodes)])),
    ...(await fetchHouseRuleSources([...new Set(houseIds)])),
  ];

  let computation: PitchRestComputation | null = null;
  if (output.applies_pitch_rest) {
    const computed = await computePitchRest(context, referenceDate, output.house_rule_adjustment, missing);
    computation = computed.computation;
    if (computed.tierSource) sources.push(computed.tierSource);
  }

  // When code computed the eligibility, drop model "missing facts" that the
  // computation answered (the rest chart, thresholds, calendar dates).
  if (computation) {
    const answered = /(rest[- ]?day|threshold|pitch[- ]count chart|rest chart|calendar|exact date|which date|eligib)/i;
    for (let i = missing.length - 1; i >= 0; i -= 1) {
      if (answered.test(missing[i] ?? "")) missing.splice(i, 1);
    }
  }

  const draftData = sources.some((s) => !s.verified);
  trace({
    agent_name: AGENT,
    action: "rules_result",
    input_summary: request.question,
    output_summary: JSON.stringify({
      sources: sources.map((s) => `${s.table}:${s.id}`),
      computation,
      draft_data: draftData,
      missing_facts: missing,
    }).slice(0, 1000),
    status: "ok",
  });

  return {
    ok: true,
    summary: output.summary,
    call_type_hint: output.call_type_hint,
    sources,
    computation,
    draft_data: draftData,
    missing_facts: [...new Set(missing)],
  };
}
