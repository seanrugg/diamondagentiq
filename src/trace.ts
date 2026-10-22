import { appendFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
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

const runId = randomUUID();
const startedAt = new Date().toISOString().replaceAll(":", "-");
const logDir = join(process.cwd(), "logs");
const logPath = join(logDir, `run-${startedAt}.jsonl`);

mkdirSync(logDir, { recursive: true });

export function getRunId(): string {
  return runId;
}

export function getTracePath(): string {
  return logPath;
}

export function trace(event: TraceEvent): void {
  const line = JSON.stringify({
    timestamp: new Date().toISOString(),
    run_id: runId,
    agent_name: event.agent_name,
    action: event.action,
    input_summary: event.input_summary,
    output_summary: event.output_summary,
    model: event.model ?? null,
    provider: event.provider ?? null,
    reasoning: event.reasoning ?? null,
    receipt: event.receipt ?? null,
    status: event.status,
  });

  appendFileSync(logPath, `${line}\n`);
  process.stdout.write(`${line}\n`);
}
