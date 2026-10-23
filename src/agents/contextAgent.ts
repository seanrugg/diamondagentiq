/**
 * ContextAgent: extracts structured context from a situation request using the
 * configured LLM (via generator()). Purely an extraction step — no data
 * lookups (those go through dataTools/Zetaris) and no orchestration.
 *
 * On invalid JSON or a failed zod validation, retries once with the validation
 * error included, then returns a structured error. The model's reasoning and
 * the Meterless receipt are logged into the trace, never into the returned
 * context.
 */

import { z } from "zod";
import { generator } from "../adapters/llm.js";
import { parseModelJson } from "./json.js";
import type { SituationRequest } from "../schemas/situation.js";
import { trace } from "../trace.js";

export const ContextOutputSchema = z.object({
  sport: z.enum(["baseball", "softball"]),
  sanction: z.string().min(1),
  age: z.number().int().nonnegative(),
  topic: z.string().min(1),
  entities: z
    .object({
      pitches: z.number().int().nonnegative().optional(),
      last_pitched_date: z.string().optional(),
      game_date: z.string().optional(),
    })
    .passthrough(),
  missing_facts: z.array(z.string()),
});

export type ContextOutput = z.infer<typeof ContextOutputSchema>;

export type ContextAgentResult =
  | { ok: true; context: ContextOutput }
  | {
      ok: false;
      error: {
        message: string;
        attempts: number;
        lastInput?: string | null;
        lastValidationIssue?: string;
      };
    };

const MAX_ATTEMPTS = 2;

function buildPrompt(request: SituationRequest): string {
  const editionLine = request.edition ? `- edition: ${request.edition}` : "";
  const eventLine = request.event_name ? `- event_name: ${request.event_name}` : "";

  return `You are the ContextAgent for DiamondAgentIQ, a baseball/softball ruling assistant.

Extract structured context from the situation request below. Return ONLY a JSON object (no markdown fences, no prose) matching this schema:

{
  "sport": "baseball" | "softball",
  "sanction": string,            // e.g. "little_league"
  "age": number (int, >= 0),
  "topic": string,               // short description of what the situation is about
  "entities": {
    "pitches"?: number,          // pitch count mentioned, if any
    "last_pitched_date"?: string,// date the player last pitched, if mentioned
    "game_date"?: string,        // date of the game in question, if mentioned
    ... any other relevant entities
  },
  "missing_facts": string[]      // facts needed to answer that are not provided
}

Situation request:
- question: ${request.question}
- role: ${request.role}
- sport: ${request.sport}
- sanction: ${request.sanction}
- age: ${request.age}
${editionLine}
${eventLine}

Output the JSON object only.`;
}

export async function contextAgent(
  request: SituationRequest,
): Promise<ContextAgentResult> {
  const agentName = "contextAgent";
  const action = "extract_context";
  const prompt = buildPrompt(request);

  let validationIssue: string | undefined;
  let lastInput: string | null = null;
  let result: Awaited<ReturnType<typeof generator>> | undefined;

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
    const attemptPrompt = validationIssue
      ? `${prompt}\n\nThe previous response was invalid: ${validationIssue}. Please fix the JSON and output only the corrected JSON object.`
      : prompt;

    result = await generator([{ role: "user", content: attemptPrompt }], {
      tier: "super",
    });
    lastInput = result.content ?? null;

    if (lastInput === null) {
      validationIssue = "Model returned no content.";
      continue;
    }

    const parsedJson = parseModelJson(lastInput);
    if (!parsedJson.ok) {
      validationIssue = `Invalid JSON: ${parsedJson.error}`;
      continue;
    }
    const parsed = parsedJson.value;

    const validation = ContextOutputSchema.safeParse(parsed);
    if (!validation.success) {
      validationIssue = validation.error.message;
      continue;
    }

    // Success — log reasoning and receipt into the trace, never into output.
    const context = validation.data;
    trace({
      agent_name: agentName,
      action,
      input_summary: `question: ${request.question} role=${request.role} sport=${request.sport} sanction=${request.sanction} age=${request.age}`,
      output_summary: JSON.stringify({
        topic: context.topic,
        entities: context.entities,
        missing_facts_count: context.missing_facts.length,
      }),
      model: result.model,
      provider: result.provider,
      reasoning: result.reasoning,
      receipt: result.receipt,
      status: "ok",
    });
    return { ok: true, context };
  }

  // Exhausted retries — structured error.
  const errorMessage = validationIssue ?? "Failed to produce valid context output.";
  trace({
    agent_name: agentName,
    action,
    input_summary: `question: ${request.question} role=${request.role}`,
    output_summary: errorMessage,
    model: result?.model ?? null,
    provider: result?.provider ?? null,
    status: "error",
  });
  return {
    ok: false,
    error: {
      message: errorMessage,
      attempts: MAX_ATTEMPTS,
      lastInput,
      lastValidationIssue: validationIssue,
    },
  };
}
