import { describe, expect, it } from "vitest";
import { parseModelJson } from "../src/agents/json.js";

describe("parseModelJson", () => {
  it("parses plain JSON", () => {
    const result = parseModelJson('{"sport": "baseball", "pitches": 68}');
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toEqual({ sport: "baseball", pitches: 68 });
    }
  });

  it("parses a ```json fenced block surrounded by prose", () => {
    const result = parseModelJson(
      "Here is the result:\n```json\n{\"a\": 1, \"b\": 2}\n```\nDone.",
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toEqual({ a: 1, b: 2 });
    }
  });

  it("parses a plain ``` fenced block", () => {
    const result = parseModelJson("```\n{\"x\": true}\n```");
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toEqual({ x: true });
    }
  });

  it("extracts the first object from surrounding prose", () => {
    const result = parseModelJson(
      "The context is {\"topic\": \"pitch rest\"} and nothing else.",
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toEqual({ topic: "pitch rest" });
    }
  });

  it("ignores nested braces inside string literals", () => {
    const result = parseModelJson('{"note": "a {b} c", "d": 1}');
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toEqual({ note: "a {b} c", d: 1 });
    }
  });

  it("rejects input with no JSON object", () => {
    const result = parseModelJson("not json at all");
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain("No JSON object");
    }
  });

  it("rejects an unclosed object", () => {
    const result = parseModelJson("{\"a\": 1");
    expect(result.ok).toBe(false);
  });

  it("rejects invalid JSON inside braces", () => {
    const result = parseModelJson("{not json}");
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain("Invalid JSON");
    }
  });

  it("returns { ok: false, error } shape on failure", () => {
    const result = parseModelJson("garbage");
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(typeof result.error).toBe("string");
    }
  });
});

describe("parseModelJson with reasoning before the answer", () => {
  it("skips a stray brace and an example object, and returns the full answer", () => {
    const reply = 'The user wants a review. I must reply with { headline, priorities } only, like {"headline": "..."}.\n\n{"headline": "A tough one", "priorities": [{"title": "Two-strike approach"}]}';
    const result = parseModelJson(reply);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value).toEqual({ headline: "A tough one", priorities: [{ title: "Two-strike approach" }] });
  });
});
