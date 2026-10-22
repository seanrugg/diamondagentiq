import { afterEach, describe, expect, it, vi } from "vitest";

// Every key that src/config.ts validates, with sane placeholder values.
const baseEnv: Record<string, string> = {
  ZETARIS_REST_URL: "http://localhost:8888/api/v1.0",
  ZETARIS_ORG_ID: "1",
  ZETARIS_AUTH_MODE: "login",
  ZETARIS_BASE_URL: "http://localhost:3000",
  ZETARIS_USERNAME: "diq",
  ZETARIS_PASSWORD: "password",
  DIQ_PG_PASSWORD: "password",
  LLM_PROVIDER: "ollama",
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

async function loadConfig(): Promise<typeof import("../src/config.js")> {
  vi.resetModules();
  return import("../src/config.js");
}

describe("config env trimming", () => {
  it("trims trailing spaces from every string env value before validation", async () => {
    setEnv({
      LLM_PROVIDER: " meterless ",
      ZETARIS_REST_URL: "  http://localhost:8888/api/v1.0  ",
      OLLAMA_MODEL: "\t nemotron-3.5-super ",
      METERLESS_RUNTIME_TOKEN: "  runtime-token  ",
      SAMPLE_MODE: " true ",
    });
    const { config } = await loadConfig();
    expect(config.LLM_PROVIDER).toBe("meterless");
    expect(config.ZETARIS_REST_URL).toBe("http://localhost:8888/api/v1.0");
    expect(config.OLLAMA_MODEL).toBe("nemotron-3.5-super");
    expect(config.METERLESS_RUNTIME_TOKEN).toBe("runtime-token");
    expect(config.SAMPLE_MODE).toBe(true);
  });

  it("treats a whitespace-only required value as invalid after trimming", async () => {
    setEnv({ DIQ_PG_PASSWORD: "   " });
    await expect(loadConfig()).rejects.toThrow(
      /Invalid environment configuration/,
    );
  });
});
