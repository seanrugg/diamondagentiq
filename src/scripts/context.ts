#!/usr/bin/env tsx
/**
 * CLI entry point for the ContextAgent.
 *
 *   npm run context -- --role coach --sport baseball --sanction little_league --age 12 "My 12U pitcher threw 68 pitches Friday. Can she pitch Sunday?"
 *
 * Prints the extracted context JSON. Runs against the live provider (no mock).
 */

import { contextAgent } from "../agents/contextAgent.js";
import { SituationRequestSchema } from "../schemas/situation.js";

function parseArgs(argv: string[]): { args: Record<string, string>; positional: string[] } {
  const args: Record<string, string> = {};
  const positional: string[] = [];
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg.startsWith("--")) {
      const key = arg.slice(2);
      const next = argv[i + 1];
      if (next !== undefined && !next.startsWith("--")) {
        args[key] = next;
        i += 1;
      } else {
        args[key] = "true";
      }
    } else {
      positional.push(arg);
    }
  }
  return { args, positional };
}

async function main(): Promise<void> {
  const { args, positional } = parseArgs(process.argv.slice(2));
  const question = positional.join(" ").trim();
  if (!question) {
    console.error(
      'Usage: context.ts --role <role> --sport <sport> --sanction <sanction> --age <age> "<question>"',
    );
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
    event_name: args.event_name,
  });

  const result = await contextAgent(request);
  if (result.ok) {
    console.log(JSON.stringify(result.context, null, 2));
  } else {
    console.error(JSON.stringify(result.error, null, 2));
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
