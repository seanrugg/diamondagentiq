#!/usr/bin/env tsx
/**
 * npm run check:vision [-- <model id> ...]
 * Sends the synthetic box score (data/samples/box-score-demo.png) to a vision
 * model through Nightshift and prints what it read, with the receipt. Tells us
 * whether Nightshift passes images to Nemotron Super VL. Default: the Super tier.
 */
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { generator } from "../adapters/llm.js";
import { meterlessModelForTier } from "../config.js";

const image = readFileSync(new URL("../../data/samples/box-score-demo.png", import.meta.url)).toString("base64");
const ids = process.argv.slice(2).filter((a) => !a.startsWith("--"));
const models = ids.length ? ids : [meterlessModelForTier("super")];

for (const model of models) {
  const started = Date.now();
  try {
    const r = await generator(
      [
        {
          role: "user",
          content: [
            { type: "text", text: "Read this box score. Reply with ONLY JSON: {\"final\": \"<team> <runs>, <team> <runs>\", \"pitchers\": [{\"name\": \"...\", \"pitches\": <number>}], \"team_strikeouts_batting\": <number>}" },
            { type: "image_url", image_url: { url: `data:image/png;base64,${image}` } },
          ],
        },
      ],
      { model, nonce: randomUUID(), agent: "scorebookAgent" },
    );
    const phases = r.receipt?.phases.map((p) => `${p.phase} ${p.model.replace("nvidia/", "")} ${p.ms}ms in=${p.tokensIn}`).join(", ") ?? "no receipt";
    console.log(`${model}  ${((Date.now() - started) / 1000).toFixed(1)}s  served ${r.receipt?.routed_model ?? r.model}  [${phases}]`);
    console.log(`  read: ${(r.content ?? "").replace(/\s+/g, " ").slice(0, 500)}`);
    console.log(`  expected: Riverside Comets 4, Demo Hawks 3; J Ortiz 71 and M Chen 34 pitches; 9 strikeouts\n`);
  } catch (error) {
    console.log(`${model}  ${((Date.now() - started) / 1000).toFixed(1)}s  FAILED: ${error instanceof Error ? error.message : String(error)}\n`);
  }
}
