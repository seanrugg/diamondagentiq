#!/usr/bin/env tsx
/**
 * The DiamondAgentIQ web page plus a small JSON API, on 127.0.0.1.
 *
 *   GET  /              the page (web/index.html)
 *   GET  /healthz       provider, models and memory status (no secrets)
 *   POST /run           SituationRequest JSON -> SituationAnswer JSON
 *   POST /run/stream    same, streamed as NDJSON: one {"type":"step"} per trace
 *                       line (the live agent timeline), then {"type":"answer"}
 *                       or {"type":"error"}
 *
 * One question at a time: Nightshift drops concurrent requests, so a second
 * request while one is running gets 409. Model reasoning stays in the trace
 * files and is never streamed to the page.
 */
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { readFileSync } from "node:fs";
import { openMemory } from "./adapters/hmem.js";
import { config, meterlessModelForTier } from "./config.js";
import { runSituation, type OrchestratorResult } from "./orchestrator.js";
import { SituationRequestSchema } from "./schemas/situation.js";
import { withRun, type TraceRecord } from "./trace.js";

const MAX_BODY_BYTES = 20_000;
const memory = openMemory({ dir: config.DIQ_MEMORY_DIR });
let busy = false;

const localToday = () =>
  new Intl.DateTimeFormat("en-CA", { year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());

/** What the page may see of a trace line: no reasoning, receipt reduced to routing and timings. */
export function publicStep(r: TraceRecord) {
  const receipt = r.receipt
    ? {
        receipt_id: r.receipt.receipt_id,
        requested_model: r.receipt.requested_model,
        routed_model: r.receipt.routed_model,
        provider: r.receipt.winning_route?.provider ?? null,
        ms: r.receipt.phases?.reduce((sum, p) => sum + (p.ms ?? 0), 0) ?? null,
        tokens_out: r.receipt.phases?.reduce((sum, p) => sum + (p.tokensOut ?? 0), 0) ?? null,
      }
    : null;
  return {
    type: "step" as const,
    timestamp: r.timestamp,
    agent: r.agent_name,
    action: r.action,
    input: r.input_summary.slice(0, 400),
    output: r.output_summary.slice(0, 600),
    model: r.model,
    status: r.status,
    receipt,
  };
}

async function readJson(req: IncomingMessage): Promise<unknown> {
  let size = 0;
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    size += (chunk as Buffer).length;
    if (size > MAX_BODY_BYTES) throw Object.assign(new Error("Request body is too large"), { status: 413 });
    chunks.push(chunk as Buffer);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}");
  } catch {
    throw Object.assign(new Error("Request body must be JSON"), { status: 400 });
  }
}

function send(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { "content-type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(body));
}

async function handleRun(req: IncomingMessage, res: ServerResponse, stream: boolean): Promise<void> {
  const raw = (await readJson(req)) as Record<string, unknown>;
  const parsed = SituationRequestSchema.safeParse(raw);
  if (!parsed.success) return send(res, 400, { error: "Check the question and its details.", issues: parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`) });
  const today = typeof raw.today === "string" && /^\d{4}-\d{2}-\d{2}$/.test(raw.today) ? raw.today : localToday();
  if (busy) return send(res, 409, { error: "Another question is still running. Ask again when it finishes." });

  busy = true;
  try {
    if (!stream) {
      const result: OrchestratorResult = await withRun(() => runSituation(parsed.data, today, { memory }));
      return send(res, result.ok ? 200 : 502, result.ok ? result.answer : result.error);
    }
    res.writeHead(200, { "content-type": "application/x-ndjson; charset=utf-8", "cache-control": "no-store" });
    const write = (obj: unknown) => {
      if (!res.writableEnded) res.write(`${JSON.stringify(obj)}\n`);
    };
    write({ type: "start", today });
    const result = await withRun(() => runSituation(parsed.data, today, { memory }), (r) => write(publicStep(r)));
    write(result.ok ? { type: "answer", answer: result.answer } : { type: "error", error: result.error });
    res.end();
  } finally {
    busy = false;
  }
}

export const server = createServer((req, res) => {
  const url = new URL(req.url ?? "/", "http://localhost");
  const route = `${req.method} ${url.pathname}`;
  (async () => {
    if (route === "GET /") {
      res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      return res.end(readFileSync(new URL("../web/index.html", import.meta.url)));
    }
    if (route === "GET /healthz") {
      return send(res, 200, {
        ok: true,
        busy,
        provider: config.LLM_PROVIDER,
        models: config.LLM_PROVIDER === "meterless" ? { super: meterlessModelForTier("super"), lightning: meterlessModelForTier("lightning"), judge: meterlessModelForTier("judge"), app_streams: config.METERLESS_APP_STREAMS } : { local: config.OLLAMA_MODEL },
        memory: { memories: memory.store.all().length, ledger: memory.ledger.stats() },
      });
    }
    if (route === "POST /run") return handleRun(req, res, false);
    if (route === "POST /run/stream") return handleRun(req, res, true);
    return send(res, 404, { error: `No route for ${route}` });
  })().catch((error: unknown) => {
    const status = (error as { status?: number }).status ?? 500;
    if (!res.headersSent) send(res, status, { error: error instanceof Error ? error.message : String(error) });
    else res.end();
  });
});

/** Listen on 127.0.0.1 (see src/scripts/start.ts). */
export function startServer(port = config.DIQ_PORT): void {
  server.listen(port, "127.0.0.1", () => {
    console.log(`DiamondAgentIQ is running: open http://127.0.0.1:${port} (Ctrl+C to stop)`);
  });
}
