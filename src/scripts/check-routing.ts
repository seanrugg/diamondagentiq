#!/usr/bin/env tsx
/**
 * npm run check:routing [-- <model id> ...]
 * Shows which Nightshift route ids exist (GET /v1/models) and how a small JSON
 * task is routed for each model id: receipt phase, requested vs served model,
 * time and 499 retries. Each request carries a nonce so Nightshift's cache
 * can't answer it (cache hits return instantly with no receipt). With no ids it tries our two pinned Nemotron ids and
 * the meterless/fast and meterless/deep routing modes.
 */
import { randomUUID } from "node:crypto";
import { generator } from "../adapters/llm.js";
import { config, meterlessModelForTier } from "../config.js";

const messages = [
  { role: "system" as const, content: 'Classify the call. Reply with ONLY: {"call_type": "rule"|"judgment", "why": "<one sentence>"}' },
  { role: "user" as const, content: "The umpire called strike three on a pitch the parent thought was outside." },
];

const ids = process.argv.slice(2).filter((a) => !a.startsWith("--"));
const models = ids.length
  ? ids
  : [meterlessModelForTier("lightning"), meterlessModelForTier("super"), "meterless/fast", "meterless/deep"];

console.log(`provider ${config.LLM_PROVIDER}; METERLESS_DIRECT_MODE=${config.METERLESS_DIRECT_MODE}\n`);

try {
  const res = await fetch(`${config.METERLESS_BASE_URL.replace(/\/$/, "")}/models`, {
    headers: { Authorization: `Bearer ${config.METERLESS_RUNTIME_TOKEN}`, "meterless-app": "diamondagentiq" },
    signal: AbortSignal.timeout(10_000),
  });
  const body = (await res.json()) as { data?: { id: string }[] };
  const all = (body.data ?? []).map((m) => m.id);
  const show = all.filter((id) => id.startsWith("nvidia/") || /^meterless\/(text\.)?(auto|fast|deep|cheap|fusion)$/.test(id));
  console.log(`GET /v1/models: ${all.length} ids. Nemotron and text routes:\n  ${show.join("\n  ") || "(none)"}\n`);
} catch (error) {
  console.log(`GET /v1/models failed: ${error instanceof Error ? error.message : String(error)}\n`);
}

for (const model of models) {
  const started = Date.now();
  try {
    const r = await generator(messages, { model, nonce: randomUUID() }); // unique, so no cache hits
    const phases = r.receipt?.phases.map((p) => `${p.phase} ${p.model.replace("nvidia/", "")} ${p.ms}ms`).join(", ") ?? "no receipt";
    console.log(`${model.padEnd(40)} ${((Date.now() - started) / 1000).toFixed(1)}s  served ${r.receipt?.routed_model ?? r.model}  [${phases}]  retries=${r.retries}  answered=${/call_type/.test(r.content ?? "")}`);
  } catch (error) {
    console.log(`${model.padEnd(40)} ${((Date.now() - started) / 1000).toFixed(1)}s  FAILED: ${error instanceof Error ? error.message : String(error)}`);
  }
}
