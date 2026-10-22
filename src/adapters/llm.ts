import OpenAI from "openai";
import type {
  ChatCompletionMessageParam,
  ChatCompletionTool,
} from "openai/resources/chat/completions";
import { config } from "../config.js";

const REQUEST_TIMEOUT_MS = 120_000;

export type GeneratorOpts = {
  tools?: ChatCompletionTool[];
  model?: string;
  temperature?: number;
};

export type GeneratorResult = {
  content: string | null;
  toolCalls: NonNullable<
    OpenAI.Chat.Completions.ChatCompletionMessage["tool_calls"]
  >;
  reasoning: unknown;
  model: string;
  provider: "ollama" | "meterless";
};

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
    (provider === "meterless" ? config.METERLESS_MODEL : config.OLLAMA_MODEL);
  const client = createClient();

  const completion = await client.chat.completions.create(
    {
      model,
      messages,
      ...(opts?.tools ? { tools: opts.tools } : {}),
      ...(opts?.temperature !== undefined
        ? { temperature: opts.temperature }
        : {}),
    },
    { timeout: REQUEST_TIMEOUT_MS },
  );

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
  };
}
