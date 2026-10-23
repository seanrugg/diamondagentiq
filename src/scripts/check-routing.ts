#!/usr/bin/env tsx
/**
 * npm run check:routing
 * Sends the same small JSON task to Nightshift four ways and prints how each
 * was routed (receipt phase, requested vs served model, time, 499 retries).
 * Tells us whether plain requests get the slow "planning" path and whether the
 * inert-tool workaround (METERLESS_DIRECT_MODE=tools) avoids it. ~4 requests.
 */
import { DIRECT_MODE_TOOL, generator, type GeneratorOpts } from "../adapters/llm.js";
import { config } from "../config.js";

const messages = [
  { role: "system" as const, content: 'Classify the call. Reply with ONLY: {"call_type": "rule"|"judgment", "why": "<one sentence>"}' },
  { role: "user" as const, content: "The umpire called strike three on a pitch the parent thought was outside." },
];

const cases: { name: string; opts: GeneratorOpts }[] = [
  { name: "lightning, plain", opts: { tier: "lightning" } },
  { name: "lightning, inert tool", opts: { tier: "lightning", tools: [DIRECT_MODE_TOOL], toolChoice: "none" } },
  { name: "super, plain", opts: { tier: "super" } },
  { name: "super, inert tool", opts: { tier: "super", tools: [DIRECT_MODE_TOOL], toolChoice: "none" } },
];

console.log(`provider ${config.LLM_PROVIDER}; METERLESS_DIRECT_MODE=${config.METERLESS_DIRECT_MODE}\n`);
for (const c of cases) {
  const started = Date.now();
  try {
    const r = await generator(messages, c.opts);
    const phases = r.receipt?.phases.map((p) => `${p.phase} ${p.ms}ms out=${p.tokensOut}`).join(", ") ?? "no receipt";
    console.log(`${c.name.padEnd(22)} ${((Date.now() - started) / 1000).toFixed(1)}s  requested ${r.requested_model}  served ${r.model}  [${phases}]  finish=${r.finish_reason}  retries=${r.retries}  ok=${/call_type/.test(r.content ?? "")}`);
  } catch (error) {
    console.log(`${c.name.padEnd(22)} ${((Date.now() - started) / 1000).toFixed(1)}s  FAILED: ${error instanceof Error ? error.message : String(error)}`);
  }
}
