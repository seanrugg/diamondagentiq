/**
 * "Who can pitch on <date>?" for a team's pitch log.
 *
 * Data comes through Zetaris. The coach's pitch log is a CSV file in the
 * Zetaris NDP file store, registered as DIQ_FILES.pitch_log. The Zetaris
 * view diq.pitcher_availability joins it to diq_pg.pitch_rest_rules (a file
 * joined to Postgres in one query), and the view is published in the
 * diamondagentiq_knowledge data mart. In SAMPLE_MODE the bundled copy of the
 * same CSV is read instead.
 *
 * All math is done here in code, not by the view or a model. Code recomputes
 * each pitcher's rest days from the rest tiers (and says when it disagrees
 * with the view), then computes the earliest eligible date and compares it
 * with the game date.
 */
import { readFileSync } from "node:fs";
import { z } from "zod";
import { runAgentRows } from "../adapters/dataTools.js";
import type { Row } from "../adapters/rows.js";
import { resolveDate } from "../calculators/dates.js";
import { earliestEligibleDate, restDaysRequired } from "../calculators/pitchRest.js";
import { trace } from "../trace.js";

const AGENT = "pitcherAvailability";

/** Where the pitch log can be read, in order of preference. */
type LogSource = { label: string; schema: string; table: string };

export const PitcherStatusSchema = z.object({
  pitcher: z.string(),
  age: z.number().int(),
  last_outing: z.string(),
  pitches: z.number().int(),
  rest_days: z.number().int().nullable(),
  earliest_eligible: z.string().nullable(),
  available: z.boolean().nullable(),
  note: z.string().nullable(),
});

export const AvailabilitySchema = z.object({
  game_date: z.string(),
  team: z.string().nullable(),
  sanction: z.string(),
  sport: z.string(),
  pitchers: z.array(PitcherStatusSchema),
  read_from: z.string(),
  source_url: z.string().nullable(),
  edition: z.string().nullable(),
  verified: z.boolean(),
  synthetic: z.boolean(),
});

export type PitcherStatus = z.infer<typeof PitcherStatusSchema>;
export type Availability = z.infer<typeof AvailabilitySchema>;

export type AvailabilityResult = { ok: true; answer: Availability } | { ok: false; message: string };

type LogRow = {
  team: string;
  pitcher_name: string;
  age: number;
  sanction: string;
  sport: string;
  game_date: string;
  pitches: number;
  synthetic: boolean;
  view_rest_days: number | null;
};

const isTrue = (v: unknown) => v === true || String(v).toLowerCase() === "true";
const toInt = (v: unknown) => Math.trunc(Number(v));
/** Zetaris may return dates as ISO strings or timestamps; keep YYYY-MM-DD. */
const isoDay = (v: unknown) => String(v ?? "").slice(0, 10);

function toLogRow(r: Row): LogRow {
  return {
    team: String(r.team ?? ""),
    pitcher_name: String(r.pitcher_name ?? ""),
    age: toInt(r.age),
    sanction: String(r.sanction ?? ""),
    sport: String(r.sport ?? ""),
    game_date: isoDay(r.game_date),
    pitches: toInt(r.pitches),
    synthetic: isTrue(r.synthetic),
    view_rest_days: r.rest_days === undefined || r.rest_days === null || r.rest_days === "" ? null : toInt(r.rest_days),
  };
}

/** The bundled pitch log (data/demo), used only in SAMPLE_MODE. */
export function parsePitchLogCsv(text: string): LogRow[] {
  const [header, ...lines] = text.trim().split(/\r?\n/);
  const cols = (header ?? "").split(",").map((c) => c.trim());
  return lines
    .filter((l) => l.trim())
    .map((line) => {
      const cells = line.split(",");
      const row: Row = {};
      cols.forEach((c, i) => {
        row[c] = (cells[i] ?? "").trim();
      });
      return toLogRow(row);
    });
}

async function readLog(mart: string | null, sampleMode: boolean): Promise<{ rows: LogRow[]; readFrom: string }> {
  if (sampleMode) {
    const text = readFileSync(new URL("../../data/demo/pitch_log_synthetic.csv", import.meta.url), "utf8");
    return { rows: parsePitchLogCsv(text), readFrom: "bundled pitch log (sample mode)" };
  }
  const cols = "team, pitcher_name, age, sanction, sport, game_date, pitches, synthetic";
  const sources: LogSource[] = [
    ...(mart ? [{ label: `${mart} data mart`, schema: mart, table: "pitcher_availability" }] : []),
    { label: "diq view", schema: "diq", table: "pitcher_availability" },
  ];
  let lastError = "";
  for (const s of sources) {
    try {
      const rows = await runAgentRows(`SELECT ${cols}, rest_days FROM ${s.schema}.${s.table}`, { schema: s.schema, tables: [s.table] });
      return { rows: rows.map(toLogRow), readFrom: `${s.schema}.${s.table} (${s.label}: the coach's CSV joined to pitch_rest_rules)` };
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
      trace({ agent_name: AGENT, action: "read_fallback", input_summary: `${s.schema}.${s.table}`, output_summary: lastError, status: "error" });
    }
  }
  // Last resort: the registered file itself, with rest days computed in code below.
  try {
    const rows = await runAgentRows(`SELECT ${cols} FROM DIQ_FILES.pitch_log`, { schema: "DIQ_FILES", tables: ["pitch_log"] });
    return { rows: rows.map(toLogRow), readFrom: "DIQ_FILES.pitch_log (the coach's CSV in the Zetaris file store)" };
  } catch (error) {
    lastError = error instanceof Error ? error.message : String(error);
  }
  throw new Error(`The pitch log isn't available in Zetaris: ${lastError}`);
}

/** Keep each pitcher's most recent outing (the one that sets their rest). */
function latestOutings(rows: LogRow[]): LogRow[] {
  const latest = new Map<string, LogRow>();
  for (const r of rows) {
    const prev = latest.get(r.pitcher_name);
    if (!prev || r.game_date > prev.game_date) latest.set(r.pitcher_name, r);
  }
  return [...latest.values()];
}

export async function pitcherAvailability(
  input: { date: string; team?: string },
  today: string,
  options: { mart?: string | null; sampleMode?: boolean } = {},
): Promise<AvailabilityResult> {
  const gameDate = resolveDate(input.date, today, "on_or_after");
  if (!gameDate) return { ok: false, message: `I couldn't read "${input.date}" as a date. Try a weekday such as Saturday, or YYYY-MM-DD.` };

  let log: { rows: LogRow[]; readFrom: string };
  try {
    log = await readLog(options.mart ?? null, options.sampleMode ?? false);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    trace({ agent_name: AGENT, action: "read_log", input_summary: input.date, output_summary: message, status: "error" });
    return { ok: false, message };
  }

  const team = input.team?.trim() || null;
  const rows = latestOutings(log.rows.filter((r) => !team || r.team.toLowerCase() === team.toLowerCase()));
  if (rows.length === 0) return { ok: false, message: team ? `No pitch log rows for ${team}.` : "The pitch log is empty." };

  const sanctions = [...new Set(rows.map((r) => r.sanction))];
  const sports = [...new Set(rows.map((r) => r.sport))];
  const sanction = sanctions[0] ?? "";
  const sport = sports[0] ?? "";
  if (sanctions.length !== 1 || sports.length !== 1 || !/^[a-z_]+$/.test(sanction) || !/^(baseball|softball)$/.test(sport)) {
    return { ok: false, message: "The pitch log mixes leagues or sports; ask about one team at a time." };
  }

  const tiers = await runAgentRows(
    `SELECT age_min, age_max, pitches_min, pitches_max, rest_days, edition, source_url, verified FROM diq_pg.pitch_rest_rules WHERE sanction = '${sanction}' AND sport = '${sport}'`,
  );
  const tierRows = tiers.map((t) => ({
    age_min: t.age_min ?? "",
    age_max: t.age_max ?? "",
    pitches_min: t.pitches_min ?? "",
    pitches_max: t.pitches_max ?? "",
    rest_days: t.rest_days ?? "",
  }));

  const pitchers: PitcherStatus[] = rows
    .map((r) => {
      const match = restDaysRequired(r.pitches, r.age, tierRows);
      if (match.kind !== "match") {
        return { pitcher: r.pitcher_name, age: r.age, last_outing: r.game_date, pitches: r.pitches, rest_days: null, earliest_eligible: null, available: null, note: `No ${sanction} rest tier for age ${r.age} and ${r.pitches} pitches; check the league's rules.` };
      }
      const earliest = earliestEligibleDate(r.game_date, match.rest_days);
      const note =
        r.view_rest_days !== null && r.view_rest_days !== match.rest_days
          ? `The Zetaris view said ${r.view_rest_days} rest days; code computed ${match.rest_days} from the tiers and used that.`
          : null;
      return { pitcher: r.pitcher_name, age: r.age, last_outing: r.game_date, pitches: r.pitches, rest_days: match.rest_days, earliest_eligible: earliest, available: gameDate >= earliest, note };
    })
    .sort((a, b) => Number(b.available === true) - Number(a.available === true) || a.pitcher.localeCompare(b.pitcher));

  const first = tiers[0];
  const answer = AvailabilitySchema.parse({
    game_date: gameDate,
    team,
    sanction,
    sport,
    pitchers,
    read_from: log.readFrom,
    source_url: first?.source_url ?? null,
    edition: first?.edition ?? null,
    verified: tiers.length > 0 && tiers.every((t) => isTrue(t.verified)),
    synthetic: rows.every((r) => r.synthetic),
  });
  trace({
    agent_name: AGENT,
    action: "computed_availability",
    input_summary: `${input.date} -> ${gameDate}${team ? `, ${team}` : ""}`,
    output_summary: pitchers.map((p) => `${p.pitcher}: ${p.available === null ? "unknown" : p.available ? "available" : `not until ${p.earliest_eligible}`}`).join("; "),
    status: "ok",
  });
  return { ok: true, answer };
}
