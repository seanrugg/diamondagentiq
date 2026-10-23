import OpenAI from "openai";
import { z } from "zod";
import type {
  ChatCompletionMessageParam,
  ChatCompletionTool,
} from "openai/resources/chat/completions";
import { config, meterlessModelForTier } from "../config.js";

const REQUEST_TIMEOUT_MS = 120_000;
const LLM_RETRY_DELAY_MS = 1_500;

/** True for provider-side drops worth one more try (HTTP 499). */
export function isRetryableLlmError(error: unknown): boolean {
  const status = (error as { status?: unknown } | null)?.status;
  return status === 499;
}

export type GeneratorOpts = {
  tools?: ChatCompletionTool[];
  model?: string;
  temperature?: number;
  tier?: "super" | "lightning";
};

export type MeterlessReceipt = {
  receipt_id: string;
  requested_model: string;
  routed_model: string;
  winning_route: { model: string; provider: string };
  phases: {
    phase: string;
    model: string;
    ms: number;
    tokensIn: number;
    tokensOut: number;
  }[];
};

// meterless.compute_receipt.v1: keep only the fields the trace needs.
// Unknown fields (and anything else in the provider response) are dropped,
// so receipts never leak provider internals into user-facing output.
const MeterlessReceiptSchema = z.object({
  receipt_id: z.string(),
  requested_model: z.string(),
  routed_model: z.string(),
  winning_route: z.object({
    model: z.string(),
    provider: z.string(),
  }),
  phases: z.array(
    z.object({
      phase: z.string(),
      model: z.string(),
      ms: z.number(),
      tokensIn: z.number(),
      tokensOut: z.number(),
    }),
  ),
});

export type GeneratorResult = {
  content: string | null;
  toolCalls: NonNullable<
    OpenAI.Chat.Completions.ChatCompletionMessage["tool_calls"]
  >;
  reasoning: unknown;
  model: string;
  provider: "ollama" | "meterless";
  receipt?: MeterlessReceipt;
};

function extractMeterlessReceipt(
  completion: unknown,
): MeterlessReceipt | undefined {
  if (config.LLM_PROVIDER !== "meterless") {
    return undefined;
  }
  const rawReceipt =
    (completion as Record<string, unknown> | undefined)?.meterless;
  const parsed = MeterlessReceiptSchema.safeParse(rawReceipt);
  return parsed.success ? parsed.data : undefined;
}

function createClient(): OpenAI {
  if (config.LLM_PROVIDER === "meterless") {
    return new OpenAI({
      baseURL: config.METERLESS_BASE_URL,
      apiKey: config.METERLESS_RUNTIME_TOKEN,
      timeout: REQUEST_TIMEOUT_MS,
      defaultHeaders: {
        "meterless-app": "diamondagentiq",
        "meterless-scope": "user",
      },
    });
  }

  return new OpenAI({
    baseURL: config.OLLAMA_BASE_URL,
    apiKey: "ollama",
    timeout: REQUEST_TIMEOUT_MS,
  });
}

function extractReasoning(
  message: OpenAI.Chat.Completions.ChatCompletionMessage,
): unknown {
  const extra = message as OpenAI.Chat.Completions.ChatCompletionMessage & {
    reasoning?: unknown;
    reasoning_content?: unknown;
  };
  return extra.reasoning ?? extra.reasoning_content ?? null;
}

export async function generator(
  messages: ChatCompletionMessageParam[],
  opts?: GeneratorOpts,
): Promise<GeneratorResult> {
  const provider = config.LLM_PROVIDER;
  const model =
    opts?.model ??
    (provider === "meterless"
      ? meterlessModelForTier(opts?.tier)
      : config.OLLAMA_MODEL);
  const client = createClient();

  const request = {
    model,
    messages,
    ...(opts?.tools ? { tools: opts.tools } : {}),
    ...(opts?.temperature !== undefined ? { temperature: opts.temperature } : {}),
  };
  let completion;
  try {
    completion = await client.chat.completions.create(request, { timeout: REQUEST_TIMEOUT_MS });
  } catch (error) {
    // One bounded retry for a request the provider dropped (e.g. Nightshift
    // returns 499 while the upstream model is cold). The SDK already retries
    // 408/429/5xx and connection errors itself.
    if (!isRetryableLlmError(error)) throw error;
    await new Promise((resolve) => setTimeout(resolve, LLM_RETRY_DELAY_MS));
    completion = await client.chat.completions.create(request, { timeout: REQUEST_TIMEOUT_MS });
  }

  const message = completion.choices[0]?.message;
  if (!message) {
    throw new Error("LLM returned no completion choices");
  }

  return {
    content: message.content ?? null,
    toolCalls: message.tool_calls ?? [],
    reasoning: extractReasoning(message),
    model: completion.model ?? model,
    provider,
    receipt: extractMeterlessReceipt(completion),
  };
}
