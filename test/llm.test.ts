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

vi.mock("openai", () => ({
  default: vi.fn(function OpenAIMock(this: any) {
    this.chat = {
      completions: {
        create: async () =>
          (globalThis as Record<string, unknown>)[FIXTURE_KEY],
      },
    };
  }),
}));

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
