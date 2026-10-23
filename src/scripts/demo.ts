#!/usr/bin/env tsx
/**
 * npm run demo [-- <name filter>]
 * Runs every input_examples/*.json through the same entry point as POST /run
 * and writes the envelope to output_examples/<same name>. Outputs are written
 * by runs and never read by the app (AGENTS.md rule 5).
 */
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { openMemory } from "../adapters/hmem.js";
import { config } from "../config.js";
import { runOnce } from "../runApi.js";

const filter = process.argv.slice(2).find((a) => !a.startsWith("--"));
const files = readdirSync("input_examples").filter((f) => f.endsWith(".json") && (!filter || f.includes(filter))).sort();
// Examples share one fresh in-memory H-MEM, so later runs can recall earlier ones.
const memory = openMemory();
mkdirSync("output_examples", { recursive: true });

console.log(`Running ${files.length} example(s)${config.SAMPLE_MODE ? " in SAMPLE_MODE" : ""}...`);
for (const file of files) {
  const input = JSON.parse(readFileSync(`input_examples/${file}`, "utf8"));
  process.stderr.write(`\n-> ${file} ... `);
  const envelope = await runOnce(input, { memory });
  writeFileSync(`output_examples/${file}`, `${JSON.stringify(envelope, null, 2)}\n`);
  console.error(`${envelope.status} in ${envelope.execution_time_seconds}s (trace ${envelope.log_file})${envelope.error ? `: ${envelope.error.message}` : ""}`);
}
console.log("\nWrote output_examples/.");
