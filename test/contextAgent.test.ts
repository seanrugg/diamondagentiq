import { describe, expect, it, beforeEach, vi } from "vitest";
import { contextAgent } from "../src/agents/contextAgent.js";
import { generator } from "../src/adapters/llm.js";
import type { SituationRequest } from "../src/schemas/situation.js";

vi.mock("../src/adapters/llm.js", () => ({
  generator: vi.fn(),
}));

const mockedGenerator = generator as unknown as ReturnType<typeof vi.fn>;

const baseRequest: SituationRequest = {
  question: "My 12U pitcher threw 68 pitches Friday. Can she pitch Sunday?",
  role: "coach",
  sport: "baseball",
  sanction: "little_league",
  age: 12,
};

const validContext = {
  sport: "baseball",
  sanction: "little_league",
  age: 12,
  topic: "pitch rest eligibility",
  entities: { pitches: 68, last_pitched_date: "2026-04-10" },
  missing_facts: ["game date"],
};

function generatorResult(content: string | null) {
  return {
    content,
    toolCalls: [],
    reasoning: null,
    model: "test-model",
    provider: "ollama" as const,
  };
}

beforeEach(() => {
  mockedGenerator.mockReset();
});

describe("contextAgent", () => {
  it("returns parsed context on valid JSON on the first attempt", async () => {
    mockedGenerator.mockResolvedValueOnce(generatorResult(JSON.stringify(validContext)));

    const result = await contextAgent(baseRequest);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.context).toMatchObject(validContext);
      expect(result.context.missing_facts).toContain("game date");
    }
    expect(mockedGenerator).toHaveBeenCalledTimes(1);
    expect(mockedGenerator).toHaveBeenLastCalledWith(
      expect.anything(),
      { tier: "super", agent: "contextAgent" },
    );
  });

  it("retries once, including the validation error, when the first response is invalid JSON", async () => {
    mockedGenerator
      .mockResolvedValueOnce(generatorResult("not json at all"))
      .mockResolvedValueOnce(generatorResult(JSON.stringify(validContext)));

    const result = await contextAgent(baseRequest);
    expect(result.ok).toBe(true);
    expect(mockedGenerator).toHaveBeenCalledTimes(2);

    const secondPrompt = mockedGenerator.mock.calls[1]?.[0]?.[0]?.content;
    expect(secondPrompt).toContain("Invalid JSON");
  });

  it("returns a structured error after two invalid attempts", async () => {
    mockedGenerator
      .mockResolvedValueOnce(generatorResult("bad"))
      .mockResolvedValueOnce(generatorResult("also bad"));

    const result = await contextAgent(baseRequest);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.attempts).toBe(2);
      expect(result.error.message).toContain("Invalid JSON");
    }
  });

  it("returns a structured error when the model returns no content", async () => {
    mockedGenerator
      .mockResolvedValueOnce(generatorResult(null))
      .mockResolvedValueOnce(generatorResult(null));

    const result = await contextAgent(baseRequest);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.attempts).toBe(2);
    }
  });
});
