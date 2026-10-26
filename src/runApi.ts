/**
 * One structured entry point for a single run, shared by POST /run and
 * npm run demo. Takes a situation question or a post-game box score and
 * returns the envelope the hackathon guide describes: run_id, status,
 * output (or a structured error), the agent roster, trace file and timing.
 */
import { z } from "zod";
import type { Hmem } from "./adapters/hmem.js";
import { config, meterlessModelForTier, type ModelTier } from "./config.js";
import { runGameReview } from "./gameReview.js";
import { runSituation } from "./orchestrator.js";
import { GameReviewRequestSchema } from "./schemas/boxScore.js";
import { SituationRequestSchema } from "./schemas/situation.js";
import { getRunId, getRunTracePath, withRun, type TraceRecord } from "./trace.js";

const AGENTS: { name: string; role: string; tier: ModelTier | "code" }[] = [
  { name: "ContextAgent", role: "Reads the question: sport, league, age, what kind of help is needed", tier: "super" },
  { name: "MemoryAgent", role: "Recalls and saves what we know about this team (Meterless H-MEM)", tier: "lightning" },
  { name: "RulesAgent", role: "Queries the rules knowledge base through Zetaris; code does the pitch-rest math", tier: "super" },
  { name: "DevelopmentAgent", role: "Picks the lesson, game situation, story, coaching tips and drills", tier: "lightning" },
  { name: "CallTypeAgent", role: "Umpire's judgment, written rule, or both", tier: "lightning" },
  { name: "CoachingAgent", role: "Writes the answer, teachable moment, life lesson and improvement plan", tier: "super" },
  { name: "CriticAgent", role: "Reviews every draft (with code checks) and sends it back when it falls short", tier: "judge" },
  { name: "TranslatorAgent", role: "Puts the reviewed answer into Spanish, Japanese or Korean; code checks every number and date survives", tier: "super" },
  { name: "ScorebookAgent", role: "Transcribes a box score; code checks the totals and asks for a re-read", tier: "super" },
  { name: "GameReviewAgent", role: "Post-game: what decided the game and the practice priorities", tier: "super" },
];

export function agentRoster() {
  return AGENTS.map((a) => ({
    name: a.name,
    role: a.role,
    model: a.tier === "code" ? "code" : config.LLM_PROVIDER === "meterless" ? meterlessModelForTier(a.tier) : config.OLLAMA_MODEL,
  }));
}

export const RunInputSchema = z.object({
  run_id: z.string().max(80).optional(),
  mode: z.enum(["situation", "review"]).optional(),
  today: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  input: z.record(z.unknown()),
});
export type RunInput = z.infer<typeof RunInputSchema>;

export type RunEnvelope = {
  run_id: string;
  status: "success" | "error";
  mode: "situation" | "review";
  output?: unknown;
  error?: { type: string; message: string; stage?: string; recoverable: boolean; issues?: string[] };
  agents: ReturnType<typeof agentRoster>;
  trace_id: string;
  log_file: string;
  execution_time_seconds: number;
  sample_mode: boolean;
};

const localToday = () =>
  new Intl.DateTimeFormat("en-CA", { year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());

/** Accepts {input: {...}} or a bare request; a box score (image or text) means review mode. */
export function normalizeRunInput(raw: unknown): RunInput {
  const obj = (raw ?? {}) as Record<string, unknown>;
  if (obj.input && typeof obj.input === "object") return RunInputSchema.parse(obj);
  return RunInputSchema.parse({ input: obj, ...(typeof obj.today === "string" ? { today: obj.today } : {}) });
}

export async function runOnce(raw: unknown, opts: { memory?: Hmem | null; listener?: (r: TraceRecord) => void } = {}): Promise<RunEnvelope> {
  const started = Date.now();
  const parsedInput = RunInputSchema.safeParse(raw && typeof raw === "object" && "input" in raw ? raw : { input: raw ?? {} });
  const base = { agents: agentRoster(), sample_mode: config.SAMPLE_MODE };
  if (!parsedInput.success) {
    return { ...base, run_id: "invalid", status: "error", mode: "situation", error: { type: "InvalidInput", message: "Send {\"input\": {...}} with a question or a box score.", recoverable: true, issues: parsedInput.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`) }, trace_id: "", log_file: "", execution_time_seconds: 0 };
  }
  const run = parsedInput.data;
  const input = run.input;
  const mode = run.mode ?? (input.image || input.text ? "review" : "situation");
  const today = run.today ?? (typeof input.today === "string" ? input.today : localToday());

  return withRun(async () => {
    const runId = getRunId();
    const finish = (partial: Pick<RunEnvelope, "status"> & Partial<RunEnvelope>): RunEnvelope => ({
      ...base,
      run_id: run.run_id ?? runId,
      mode,
      trace_id: runId,
      log_file: getRunTracePath(runId).replace(`${process.cwd()}/`, ""),
      execution_time_seconds: Math.round((Date.now() - started) / 100) / 10,
      ...partial,
    });

    if (mode === "review") {
      const req = GameReviewRequestSchema.safeParse(input);
      if (!req.success) return finish({ status: "error", error: { type: "InvalidInput", message: "A review needs sport, sanction, age and a box score (image or text).", recoverable: true, issues: req.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`) } });
      const result = await runGameReview(req.data, today, { memory: opts.memory ?? null });
      return result.ok ? finish({ status: "success", output: result.answer }) : finish({ status: "error", error: { type: "AgentFailed", stage: result.error.stage, message: result.error.message, recoverable: true } });
    }
    const req = SituationRequestSchema.safeParse(input);
    if (!req.success) return finish({ status: "error", error: { type: "InvalidInput", message: "A question needs role, sport, sanction, age and question.", recoverable: true, issues: req.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`) } });
    const result = await runSituation(req.data, today, { memory: opts.memory ?? null });
    return result.ok ? finish({ status: "success", output: result.answer }) : finish({ status: "error", error: { type: "AgentFailed", stage: result.error.stage, message: result.error.message, recoverable: true } });
  }, opts.listener);
}
