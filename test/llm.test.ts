import { afterEach, describe, expect, it, vi } from "vitest";

// Fixture is passed to the mocked OpenAI client through a global so each
// test can swap it in before the generator module is (re)imported.
const FIXTURE_KEY = "__diamondagentiq_llm_fixture";

function setFixture(fixture: unknown): void {
  (globalThis as Record<string, unknown>)[FIXTURE_KEY] = fixture;
}

function clearFixture(): void {
  delete (globalThis as Record<string, unknown>)[FIXTURE_KEY];
}

// Captures the options passed to chat.completions.create so tests can assert
// which model the generator actually requested.
let lastCreateOptions: unknown = null;

vi.mock("openai", () => ({
  default: vi.fn(function OpenAIMock(this: any) {
    this.chat = {
      completions: {
        create: async (options: unknown) => {
          lastCreateOptions = options;
          return (globalThis as Record<string, unknown>)[FIXTURE_KEY];
        },
      },
    };
  }),
}));

function lastModel(): string | undefined {
  return (lastCreateOptions as { model?: string } | null)?.model;
}

const baseEnv: Record<string, string> = {
  ZETARIS_REST_URL: "http://localhost:8888/api/v1.0",
  ZETARIS_ORG_ID: "1",
  ZETARIS_AUTH_MODE: "login",
  ZETARIS_BASE_URL: "http://localhost:3000",
  ZETARIS_USERNAME: "diq",
  ZETARIS_PASSWORD: "password",
  DIQ_PG_PASSWORD: "password",
  LLM_PROVIDER: "meterless",
  OLLAMA_BASE_URL: "http://localhost:11434/v1",
  OLLAMA_MODEL: "nemotron-3.5-super",
  METERLESS_BASE_URL: "http://127.0.0.1:8088/v1",
  METERLESS_RUNTIME_TOKEN: "runtime-token",
  METERLESS_MODEL: "meterless/auto",
};

const originalEnv = { ...process.env };
const touched = new Set<string>();

function setEnv(overrides: Record<string, string | undefined> = {}) {
  for (const key of Object.keys(baseEnv)) {
    touched.add(key);
    process.env[key] = baseEnv[key];
  }
  for (const [key, value] of Object.entries(overrides)) {
    touched.add(key);
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }
}

afterEach(() => {
  lastCreateOptions = null;
  clearFixture();
  for (const key of touched) {
    const previous = originalEnv[key];
    if (previous === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = previous;
    }
  }
  touched.clear();
  vi.resetModules();
});

async function loadGenerator(
  overrides: Record<string, string | undefined> = {},
): Promise<typeof import("../src/adapters/llm.js")> {
  setEnv(overrides);
  vi.resetModules();
  return import("../src/adapters/llm.js");
}

const meterlessResponse = {
  id: "cmpl-test-1",
  object: "chat.completion",
  created: 1_700_000_000,
  model: "meterless/auto",
  choices: [
    {
      index: 0,
      message: { role: "assistant", content: "Hello" },
      finish_reason: "stop",
    },
  ],
  meterless: {
    receipt_id: "rcpt-test-1",
    requested_model: "nvidia/nemotron-3.5-super-vl-120b-a12b",
    routed_model: "nvidia/nemotron-3.5-lightning-30b-a3b",
    winning_route: {
      model: "nvidia/nemotron-3.5-lightning-30b-a3b",
      provider: "nightshift",
      extra: "dropped",
    },
    phases: [
      {
        phase: "prefill",
        model: "nvidia/nemotron-3.5-lightning-30b-a3b",
        ms: 5,
        tokensIn: 10,
        tokensOut: 4,
        extra: "dropped",
      },
      {
        phase: "decode",
        model: "nvidia/nemotron-3.5-lightning-30b-a3b",
        ms: 20,
        tokensIn: 10,
        tokensOut: 40,
      },
    ],
    not_in_schema: "dropped",
  },
};

const expectedReceipt = {
  receipt_id: "rcpt-test-1",
  requested_model: "nvidia/nemotron-3.5-super-vl-120b-a12b",
  routed_model: "nvidia/nemotron-3.5-lightning-30b-a3b",
  winning_route: {
    model: "nvidia/nemotron-3.5-lightning-30b-a3b",
    provider: "nightshift",
  },
  phases: [
    {
      phase: "prefill",
      model: "nvidia/nemotron-3.5-lightning-30b-a3b",
      ms: 5,
      tokensIn: 10,
      tokensOut: 4,
    },
    {
      phase: "decode",
      model: "nvidia/nemotron-3.5-lightning-30b-a3b",
      ms: 20,
      tokensIn: 10,
      tokensOut: 40,
    },
  ],
};

describe("generator meterless receipt", () => {
  it("picks only the documented receipt fields from a meterless response", async () => {
    setFixture(meterlessResponse);
    const { generator } = await loadGenerator();
    const result = await generator([
      { role: "user", content: "Say hello." },
    ]);

    expect(result.content).toBe("Hello");
    expect(result.provider).toBe("meterless");
    expect(result.receipt).toEqual(expectedReceipt);
  });

  it("omits the receipt when the meterless response has no meterless object", async () => {
    const { meterless, ...responseWithoutReceipt } = meterlessResponse;
    setFixture(responseWithoutReceipt);
    const { generator } = await loadGenerator();
    const result = await generator([
      { role: "user", content: "Say hello." },
    ]);

    expect(result.receipt).toBeUndefined();
  });

  it("omits the receipt when the meterless object does not match the schema", async () => {
    setFixture({
      ...meterlessResponse,
      meterless: { ...meterlessResponse.meterless, receipt_id: 123 },
    });
    const { generator } = await loadGenerator();
    const result = await generator([
      { role: "user", content: "Say hello." },
    ]);

    expect(result.receipt).toBeUndefined();
  });

  it("omits the receipt for the ollama provider", async () => {
    setFixture(meterlessResponse);
    const { generator } = await loadGenerator({ LLM_PROVIDER: "ollama" });
    const result = await generator([
      { role: "user", content: "Say hello." },
    ]);

    expect(result.provider).toBe("ollama");
    expect(result.receipt).toBeUndefined();
  });
});

describe("generator model selection (tier pinning)", () => {
  it("meterless tier super uses METERLESS_MODEL_SUPER", async () => {
    setFixture(meterlessResponse);
    setEnv({
      METERLESS_MODEL_SUPER: "nvidia/nemotron-3.5-super-vl-120b-a12b",
    });
    const { generator } = await loadGenerator();
    await generator([{ role: "user", content: "Say hello." }], {
      tier: "super",
    });

    expect(lastModel()).toBe("nvidia/nemotron-3.5-super-vl-120b-a12b");
  });

  it("meterless tier lightning uses METERLESS_MODEL_LIGHTNING", async () => {
    setFixture(meterlessResponse);
    setEnv({
      METERLESS_MODEL_LIGHTNING: "nvidia/nemotron-3.5-lightning-30b-a3b",
    });
    const { generator } = await loadGenerator();
    await generator([{ role: "user", content: "Say hello." }], {
      tier: "lightning",
    });

    expect(lastModel()).toBe("nvidia/nemotron-3.5-lightning-30b-a3b");
  });

  it("meterless tier falls back to METERLESS_MODEL when the tier var is unset", async () => {
    setFixture(meterlessResponse);
    setEnv({ METERLESS_MODEL_SUPER: undefined, METERLESS_MODEL_LIGHTNING: undefined });
    const { generator } = await loadGenerator();
    await generator([{ role: "user", content: "Say hello." }], {
      tier: "super",
    });

    expect(lastModel()).toBe("meterless/auto");
  });

  it("explicit opts.model wins over the tier", async () => {
    setFixture(meterlessResponse);
    setEnv({
      METERLESS_MODEL_SUPER: "nvidia/nemotron-3.5-super-vl-120b-a12b",
    });
    const { generator } = await loadGenerator();
    await generator([{ role: "user", content: "Say hello." }], {
      model: "explicit-pinned-model",
      tier: "super",
    });

    expect(lastModel()).toBe("explicit-pinned-model");
  });

  it("ollama always uses OLLAMA_MODEL regardless of tier", async () => {
    setFixture(meterlessResponse);
    const { generator } = await loadGenerator({
      LLM_PROVIDER: "ollama",
      METERLESS_MODEL_SUPER: "nvidia/nemotron-3.5-super-vl-120b-a12b",
    });
    await generator([{ role: "user", content: "Say hello." }], {
      tier: "super",
    });

    expect(lastModel()).toBe("nemotron-3.5-super");
  });
});

describe("isRetryableLlmError", () => {
  it("retries only a provider-dropped request (499)", async () => {
    setEnv();
    const { isRetryableLlmError } = await import("../src/adapters/llm.js");
    expect(isRetryableLlmError({ status: 499 })).toBe(true);
    expect(isRetryableLlmError({ status: 400 })).toBe(false);
    expect(isRetryableLlmError(new Error("boom"))).toBe(false);
    expect(isRetryableLlmError(null)).toBe(false);
  });
});

describe("METERLESS_DIRECT_MODE", () => {
  it("off by default: plain requests carry no tools", async () => {
    setFixture(meterlessResponse);
    const { generator } = await loadGenerator();
    await generator([{ role: "user", content: "hi" }], { tier: "lightning" });
    expect((lastCreateOptions as { tools?: unknown }).tools).toBeUndefined();
  });

  it("tools: plain requests get the inert tool with tool_choice none, and it never surfaces as a tool call", async () => {
    setFixture({
      ...meterlessResponse,
      choices: [{ index: 0, message: { role: "assistant", content: "{}", tool_calls: [{ id: "x", type: "function", function: { name: "no_op", arguments: "{}" } }] }, finish_reason: "stop" }],
    });
    const { generator } = await loadGenerator({ METERLESS_DIRECT_MODE: "tools" });
    const result = await generator([{ role: "user", content: "hi" }], { tier: "lightning" });
    const sent = lastCreateOptions as { tools?: { function: { name: string } }[]; tool_choice?: string };
    expect(sent.tools?.map((t) => t.function.name)).toEqual(["no_op"]);
    expect(sent.tool_choice).toBe("none");
    expect(result.toolCalls).toEqual([]);
  });

  it("tools: requests that bring their own tools are left alone", async () => {
    setFixture(meterlessResponse);
    const { generator } = await loadGenerator({ METERLESS_DIRECT_MODE: "tools" });
    const own = { type: "function" as const, function: { name: "run_sql", parameters: { type: "object", properties: {} } } };
    await generator([{ role: "user", content: "hi" }], { tier: "super", tools: [own] });
    const sent = lastCreateOptions as { tools?: { function: { name: string } }[]; tool_choice?: string };
    expect(sent.tools?.map((t) => t.function.name)).toEqual(["run_sql"]);
    expect(sent.tool_choice).toBeUndefined();
  });
});
