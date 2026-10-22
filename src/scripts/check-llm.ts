import type { ChatCompletionTool } from "openai/resources/chat/completions";
import { generator } from "../adapters/llm.js";
import { config } from "../config.js";
import { trace } from "../trace.js";

const runSqlTool: ChatCompletionTool = {
  type: "function",
  function: {
    name: "run_sql",
    description: "Run a single SQL statement against Zetaris.",
    parameters: {
      type: "object",
      properties: {
        sql: { type: "string", description: "One SQL statement" },
      },
      required: ["sql"],
    },
  },
};

try {
  const ready = await generator([
    {
      role: "user",
      content: 'Reply with exactly the word "ready" and nothing else.',
    },
  ]);

  trace({
    agent_name: "check",
    action: "llm_ready",
    input_summary: "ask model to reply ready",
    output_summary: String(ready.content ?? "").slice(0, 200),
    model: ready.model,
    provider: ready.provider,
    status: "ok",
  });

  console.log("provider:", config.LLM_PROVIDER);
  console.log("model:", ready.model);
  console.log("ready reply:", ready.content);

  const toolTest = await generator(
    [
      {
        role: "user",
        content: "Call the run_sql tool with sql set to SELECT 1.",
      },
    ],
    { tools: [runSqlTool] },
  );

  const hasToolCalls = toolTest.toolCalls.length > 0;
  trace({
    agent_name: "check",
    action: "llm_tool_call",
    input_summary: "run_sql tool test",
    output_summary: `tool_calls=${hasToolCalls} count=${toolTest.toolCalls.length}`,
    model: toolTest.model,
    provider: toolTest.provider,
    status: hasToolCalls ? "ok" : "error",
  });

  console.log("tool_calls present:", hasToolCalls);
  console.log("tool_calls count:", toolTest.toolCalls.length);
  if (!hasToolCalls) {
    process.exitCode = 1;
  }
} catch (error) {
  const message = error instanceof Error ? error.message : "unknown error";
  trace({
    agent_name: "check",
    action: "llm_check",
    input_summary: "ready + tool call",
    output_summary: message,
    status: "error",
  });
  process.exitCode = 1;
  console.error(message);
}
