import OpenAI from "openai";
import { z } from "zod";
import type {
  ChatCompletionMessageParam,
  ChatCompletionTool,
} from "openai/resources/chat/completions";
import { config, meterlessModelForTier, type ModelTier } from "../config.js";

const REQUEST_TIMEOUT_MS = 120_000;
/** Waits before each retry of a dropped request (HTTP 499): bounded, two retries. */
export const LLM_RETRY_DELAYS_MS = [1_500, 4_000];

/** True for provider-side drops worth one more try (HTTP 499). */
export function isRetryableLlmError(error: unknown): boolean {
  const status = (error as { status?: unknown } | null)?.status;
  return status === 499;
}

export type GeneratorOpts = {
  tools?: ChatCompletionTool[];
  model?: string;
  temperature?: number;
  tier?: ModelTier;
  toolChoice?: "none" | "auto";
  /** Which agent is calling; names its Nightshift app stream when METERLESS_APP_STREAMS=per-agent. */
  agent?: string;
  /**
   * Makes the request unique so Nightshift's response cache can't answer it.
   * A cache hit comes back instantly with no receipt (and has replayed blank
   * replies), so retries and routing checks send a fresh nonce.
   */
  nonce?: string;
};

/** meterless-app value: one stable lowercase id, or one per agent (diamondagentiq-critic). */
export function meterlessAppId(agent?: string): string {
  if (config.METERLESS_APP_STREAMS !== "per-agent" || !agent) return "diamondagentiq";
  const slug = agent.replace(/Agent$/, "").replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`).replace(/[^a-z0-9-]/g, "").replace(/^-+|-+$/g, "");
  return slug ? `diamondagentiq-${slug}` : "diamondagentiq";
}

/**
 * Nightshift serves requests that carry tools straight to the pinned model
 * ("final_synthesis" in the receipt, seconds), but runs plain chat requests
 * through a "planning" phase that re-routes to the Race lane and is cut off
 * at ~45 s (HTTP 499). With METERLESS_DIRECT_MODE=tools, a request without
 * tools gets one inert tool and tool_choice "none", so it takes the direct path.
 */
export const DIRECT_MODE_TOOL: ChatCompletionTool = {
  type: "function",
  function: {
    name: "no_op",
    description: "Unused. Never call this; answer in plain text.",
    parameters: { type: "object", properties: {} },
  },
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
  /** The model the provider says served the request. */
  model: string;
  /** The model we asked for (tier routing); differs from `model` if the provider re-routed. */
  requested_model: string;
  /** Why generation stopped ("stop", "length", "tool_calls"...), for diagnosing blank replies. */
  finish_reason: string | null;
  /** Number of 499 retries this call needed. */
  retries: number;
  provider: "ollama" | "meterless" | "sample";
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
  if (config.SAMPLE_MODE) {
    // No model available: the offline stand-in answers (src/adapters/sampleModel.ts).
    const { sampleReply, SAMPLE_MODEL } = await import("./sampleModel.js");
    const reply = sampleReply(messages, opts?.agent);
    return {
      content: reply.content,
      toolCalls: reply.toolCalls,
      reasoning: null,
      model: SAMPLE_MODEL,
      requested_model: opts?.tier ? `${opts.tier} tier` : "default",
      finish_reason: reply.toolCalls.length ? "tool_calls" : "stop",
      retries: 0,
      provider: "sample",
    };
  }
  const provider = config.LLM_PROVIDER;
  const model =
    opts?.model ??
    (provider === "meterless"
      ? meterlessModelForTier(opts?.tier)
      : config.OLLAMA_MODEL);
  const client = createClient();

  const direct = provider === "meterless" && !opts?.tools && config.METERLESS_DIRECT_MODE === "tools";
  const tools = opts?.tools ?? (direct ? [DIRECT_MODE_TOOL] : undefined);
  const toolChoice = opts?.toolChoice ?? (direct ? "none" : undefined);
  const sentMessages: ChatCompletionMessageParam[] = opts?.nonce
    ? [...messages, { role: "system", content: `(request ${opts.nonce})` }]
    : messages;
  const request = {
    model,
    messages: sentMessages,
    ...(tools ? { tools } : {}),
    ...(toolChoice ? { tool_choice: toolChoice } : {}),
    ...(opts?.temperature !== undefined ? { temperature: opts.temperature } : {}),
  };
  // Bounded retries for a request the provider dropped (Nightshift returns 499
  // while the upstream model is cold or the request was cut off). The SDK
  // already retries 408/429/5xx and connection errors itself.
  let completion;
  let retries = 0;
  for (;;) {
    try {
      completion = await client.chat.completions.create(request, {
        timeout: REQUEST_TIMEOUT_MS,
        ...(provider === "meterless" ? { headers: { "meterless-app": meterlessAppId(opts?.agent) } } : {}),
      });
      break;
    } catch (error) {
      const delay = LLM_RETRY_DELAYS_MS[retries];
      if (!isRetryableLlmError(error) || delay === undefined) throw error;
      retries += 1;
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }

  const message = completion.choices[0]?.message;
  if (!message) {
    throw new Error("LLM returned no completion choices");
  }

  return {
    content: message.content ?? null,
    // The inert direct-mode tool is never a real request for action.
    toolCalls: (message.tool_calls ?? []).filter((c) => c.function?.name !== DIRECT_MODE_TOOL.function.name),
    reasoning: extractReasoning(message),
    model: completion.model ?? model,
    requested_model: model,
    finish_reason: completion.choices[0]?.finish_reason ?? null,
    retries,
    provider,
    receipt: extractMeterlessReceipt(completion),
  };
}
