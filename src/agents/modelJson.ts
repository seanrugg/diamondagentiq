/**
 * Shared call pattern for agents that answer with one JSON object:
 * generator() -> parseModelJson -> zod. On invalid output, retry once with the
 * validation error, then return a structured error (AGENTS.md rule 6).
 * Every call is traced with the model's reasoning and the Meterless receipt.
 *
 * Lightning-tier calls fall back to Super if the provider rejects the
 * Lightning model (HTTP 400/404). The fallback is traced so the routing is
 * honest in the logs.
 */
import type { ChatCompletionMessageParam } from "openai/resources/chat/completions";
import type { z } from "zod";
import { generator, type GeneratorOpts, type GeneratorResult } from "../adapters/llm.js";
import { trace } from "../trace.js";
import { parseModelJson } from "./json.js";

export type Tier = "super" | "lightning";

export type JsonAgentResult<T> =
  | { ok: true; value: T; model: string }
  | { ok: false; error: { message: string; attempts: number } };

function isModelRejected(error: unknown): boolean {
  const status = (error as { status?: unknown } | null)?.status;
  return status === 400 || status === 404;
}

/** generator() with a traced Lightning -> Super fallback. */
export async function callModel(
  agent: string,
  messages: ChatCompletionMessageParam[],
  tier: Tier,
  extra: Omit<GeneratorOpts, "tier"> = {},
): Promise<GeneratorResult> {
  try {
    return await generator(messages, { ...extra, tier });
  } catch (error) {
    if (tier !== "lightning" || !isModelRejected(error)) throw error;
    trace({
      agent_name: agent,
      action: "tier_fallback",
      input_summary: "lightning model rejected by provider",
      output_summary: `falling back to super: ${error instanceof Error ? error.message.slice(0, 160) : "error"}`,
      status: "error",
    });
    return generator(messages, { ...extra, tier: "super" });
  }
}

export async function askJson<T>(
  agent: string,
  action: string,
  tier: Tier,
  messages: ChatCompletionMessageParam[],
  schema: z.ZodType<T, z.ZodTypeDef, unknown>,
  maxAttempts = 2,
): Promise<JsonAgentResult<T>> {
  const convo = [...messages];
  let issue = "no answer";

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const result = await callModel(agent, convo, tier);
    const content = result.content ?? "";
    const parsed = parseModelJson(content);
    let value: T | null = null;
    if (!parsed.ok) {
      issue = `Invalid JSON: ${parsed.error}`;
    } else {
      const validation = schema.safeParse(parsed.value);
      if (validation.success) value = validation.data;
      else issue = `Schema error: ${validation.error.message}`;
    }

    trace({
      agent_name: agent,
      action,
      input_summary: `attempt ${attempt}/${maxAttempts} (${tier}; requested ${result.requested_model}${result.model !== result.requested_model ? `; provider served ${result.model}` : ""}${result.retries ? `; ${result.retries} retr${result.retries === 1 ? "y" : "ies"} after 499` : ""})`,
      output_summary: value ? content.slice(0, 600) : `${issue.slice(0, 400)} (finish_reason=${result.finish_reason ?? "none"})`,
      model: result.model,
      provider: result.provider,
      reasoning: result.reasoning,
      receipt: result.receipt,
      status: value ? "ok" : "error",
    });
    if (value) return { ok: true, value, model: result.model };

    convo.push({ role: "assistant", content });
    convo.push({ role: "user", content: `${issue}\nReply with only the corrected JSON object.` });
  }
  return { ok: false, error: { message: issue, attempts: maxAttempts } };
}
