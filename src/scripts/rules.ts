#!/usr/bin/env tsx
/**
 * CLI: ContextAgent then RulesAgent, live (Nightshift + Zetaris).
 *
 *   npm run rules -- --role coach --sport baseball --sanction little_league --age 12 \
 *     --event "Fall Classic 12U" --today 2026-10-18 \
 *     "My 12U pitcher threw 68 pitches Friday. Can she pitch Sunday?"
 *
 * --today defaults to this computer's local date (YYYY-MM-DD).
 */
import { contextAgent } from "../agents/contextAgent.js";
import { rulesAgent } from "../agents/rulesAgent.js";
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

function localToday(): string {
  // en-CA formats as YYYY-MM-DD in the computer's own time zone.
  return new Intl.DateTimeFormat("en-CA", { year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
}

async function main(): Promise<void> {
  const { args, positional } = parseArgs(process.argv.slice(2));
  const question = positional.join(" ").trim();
  if (!question) {
    console.error('Usage: npm run rules -- --role <role> --sport <sport> --sanction <sanction> --age <age> [--event "<name>"] [--today YYYY-MM-DD] "<question>"');
    process.exitCode = 1;
    return;
  }
  const today = args.today ?? localToday();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(today)) {
    console.error("--today must be YYYY-MM-DD");
    process.exitCode = 1;
    return;
  }

  const request = SituationRequestSchema.parse({
    question,
    role: args.role,
    sport: args.sport,
    sanction: args.sanction,
    age: args.age === undefined ? undefined : Number(args.age),
    edition: args.edition,
    event_name: args.event ?? args.event_name,
  });

  const context = await contextAgent(request);
  console.log("=== ContextAgent ===");
  console.log(JSON.stringify(context.ok ? context.context : context.error, null, 2));
  if (!context.ok) {
    process.exitCode = 1;
    return;
  }

  const rules = await rulesAgent(request, context.context, today);
  console.log("\n=== RulesAgent ===");
  console.log(JSON.stringify(rules.ok ? rules : rules.error, null, 2));
  console.log(`\nTrace: ${getTracePath()}`);
  if (!rules.ok) process.exitCode = 1;
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
