import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";

const env: Record<string, string> = {
  ZETARIS_REST_URL: "http://localhost:8888/api/v1.0", ZETARIS_ORG_ID: "1", ZETARIS_USERNAME: "u", ZETARIS_PASSWORD: "p",
  DIQ_PG_PASSWORD: "p", LLM_PROVIDER: "meterless", OLLAMA_BASE_URL: "http://localhost:11434/v1", OLLAMA_MODEL: "m",
  METERLESS_BASE_URL: "http://127.0.0.1:8088/v1", METERLESS_RUNTIME_TOKEN: "secret-token", METERLESS_MODEL: "m",
};

describe("server publicStep", () => {
  it("never streams reasoning, and reduces the receipt to routing and timings", async () => {
    for (const [k, v] of Object.entries(env)) vi.stubEnv(k, v);
    vi.stubEnv("DIQ_MEMORY_DIR", mkdtempSync(join(tmpdir(), "diq-mem-")));
    const { publicStep } = await import("../src/server.js");
    const step = publicStep({
      timestamp: "t", run_id: "r", agent_name: "criticAgent", action: "review_draft", input_summary: "in", output_summary: "out",
      model: "nvidia/nemotron-3.5-super-vl-120b-a12b", provider: "meterless", reasoning: "private chain of thought", status: "ok",
      receipt: { receipt_id: "x", requested_model: "lightning", routed_model: "super", winning_route: { model: "super", provider: "nvidia" },
        phases: [{ phase: "planning", model: "super", ms: 45000, tokensIn: 10, tokensOut: 20 }] },
    });
    expect(JSON.stringify(step)).not.toContain("private chain of thought");
    expect(JSON.stringify(step)).not.toContain("secret-token");
    expect(step.receipt).toEqual({ requested_model: "lightning", routed_model: "super", provider: "nvidia", ms: 45000, tokens_out: 20 });
    vi.unstubAllEnvs();
  });
});
