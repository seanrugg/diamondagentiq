#!/usr/bin/env tsx
/**
 * npm run ask -- --role coach --sport baseball --sanction little_league --age 12 \
 *   [--event "Fall Classic 12U"] [--today 2026-10-18] [--save] "<question>"
 *
 * Runs the whole agent team live and prints the answer. --save also writes the
 * input and output to output_examples/ (written by runs, never read by the app).
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { runSituation } from "../orchestrator.js";
import { SituationRequestSchema } from "../schemas/situation.js";
import { getTracePath } from "../trace.js";

/** Flags that never take a value, so they can't swallow the question. */
const BOOLEAN_FLAGS = new Set(["save"]);

function parseArgs(argv: string[]): { args: Record<string, string>; positional: string[] } {
  const args: Record<string, string> = {};
  const positional: string[] = [];
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i] ?? "";
    if (arg.startsWith("--")) {
      const next = argv[i + 1];
      if (!BOOLEAN_FLAGS.has(arg.slice(2)) && next !== undefined && !next.startsWith("--")) {
        args[arg.slice(2)] = next;
        i += 1;
      } else {
        args[arg.slice(2)] = "true";
      }
    } else {
      positional.push(arg);
    }
  }
  return { args, positional };
}

const localToday = () =>
  new Intl.DateTimeFormat("en-CA", { year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());

async function main(): Promise<void> {
  const { args, positional } = parseArgs(process.argv.slice(2));
  const question = positional.join(" ").trim();
  if (!question) {
    console.error('Usage: npm run ask -- --role <role> --sport <sport> --sanction <sanction> --age <age> [--event "<name>"] [--today YYYY-MM-DD] [--save] "<question>"');
    process.exitCode = 1;
    return;
  }
  const today = args.today ?? localToday();
  const request = SituationRequestSchema.parse({
    question,
    role: args.role,
    sport: args.sport,
    sanction: args.sanction,
    age: args.age === undefined ? undefined : Number(args.age),
    edition: args.edition,
    event_name: args.event ?? args.event_name,
  });

  const started = Date.now();
  const result = await runSituation(request, today);
  const seconds = ((Date.now() - started) / 1000).toFixed(1);

  console.log("\n=== Answer ===");
  console.log(JSON.stringify(result.ok ? result.answer : result.error, null, 2));
  console.log(`\nTook ${seconds}s. Trace: ${getTracePath()}`);

  if (args.save === "true") {
    mkdirSync("output_examples", { recursive: true });
    const name = `output_examples/${new Date().toISOString().replaceAll(":", "-")}.json`;
    writeFileSync(name, JSON.stringify({ request, today, result }, null, 2));
    console.log(`Saved ${name}`);
  }
  if (!result.ok) process.exitCode = 1;
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
