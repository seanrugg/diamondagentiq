import { appendFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { AsyncLocalStorage } from "node:async_hooks";
import type { MeterlessReceipt } from "./adapters/llm.js";

export type TraceStatus = "ok" | "error";

export type TraceEvent = {
  agent_name: string;
  action: string;
  input_summary: string;
  output_summary: string;
  model?: string;
  provider?: string;
  reasoning?: unknown;
  receipt?: MeterlessReceipt;
  status: TraceStatus;
};

const processRunId = randomUUID();

export type TraceRecord = {
  timestamp: string;
  run_id: string;
  agent_name: string;
  action: string;
  input_summary: string;
  output_summary: string;
  model: string | null;
  provider: string | null;
  reasoning: unknown;
  receipt: MeterlessReceipt | null;
  status: TraceStatus;
};

/** Per-request context (the server runs many questions in one process). */
const scope = new AsyncLocalStorage<{ runId: string; listener?: (record: TraceRecord) => void }>();

/** logs/trace-<run_id>.jsonl for a run started with withRun(). */
export function getRunTracePath(runId = getRunId()): string {
  return join(logDir, `trace-${runId}.jsonl`);
}

/**
 * Run fn with its own run id; every trace line inside it carries that id and
 * is also handed to listener (used to stream a live timeline to the web page).
 */
export function withRun<T>(fn: () => Promise<T>, listener?: (record: TraceRecord) => void): Promise<T> {
  return scope.run({ runId: randomUUID(), ...(listener ? { listener } : {}) }, fn);
}
const startedAt = new Date().toISOString().replaceAll(":", "-");
const logDir = join(process.cwd(), "logs");
const logPath = join(logDir, `run-${startedAt}.jsonl`);

mkdirSync(logDir, { recursive: true });

export function getRunId(): string {
  return scope.getStore()?.runId ?? processRunId;
}

export function getTracePath(): string {
  return logPath;
}

export function trace(event: TraceEvent): void {
  const record: TraceRecord = {
    timestamp: new Date().toISOString(),
    run_id: getRunId(),
    agent_name: event.agent_name,
    action: event.action,
    input_summary: event.input_summary,
    output_summary: event.output_summary,
    model: event.model ?? null,
    provider: event.provider ?? null,
    reasoning: event.reasoning ?? null,
    receipt: event.receipt ?? null,
    status: event.status,
  };
  const line = JSON.stringify(record);

  appendFileSync(logPath, `${line}\n`);
  if (scope.getStore()) appendFileSync(getRunTracePath(record.run_id), `${line}\n`);
  process.stdout.write(`${line}\n`);
  try {
    scope.getStore()?.listener?.(record);
  } catch {
    // A broken listener (e.g. a closed browser tab) must never break a run.
  }
}
