import { readdirSync, readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";

// A fresh clone with an empty .env: SAMPLE_MODE only.
const KEYS = ["ZETARIS_REST_URL", "ZETARIS_ORG_ID", "ZETARIS_USERNAME", "ZETARIS_PASSWORD", "DIQ_PG_PASSWORD", "LLM_PROVIDER", "OLLAMA_BASE_URL", "OLLAMA_MODEL", "METERLESS_BASE_URL", "METERLESS_RUNTIME_TOKEN", "METERLESS_MODEL"];

describe("SAMPLE_MODE", () => {
  it("runs every input example end to end with no credentials, and outputs follow the inputs", async () => {
    for (const k of KEYS) vi.stubEnv(k, "");
    vi.stubEnv("SAMPLE_MODE", "true");
    vi.resetModules();
    const { runOnce } = await import("../src/runApi.js");
    const { openMemory } = await import("../src/adapters/hmem.js");
    const memory = openMemory();

    const results: Record<string, { status: string; output?: unknown; error?: unknown }> = {};
    for (const file of readdirSync(new URL("../input_examples/", import.meta.url)).filter((f) => f.endsWith(".json")).sort()) {
      const input = JSON.parse(readFileSync(new URL(`../input_examples/${file}`, import.meta.url), "utf8"));
      results[file] = await runOnce(input, { memory });
    }
    for (const [file, r] of Object.entries(results)) expect(r.status, `${file}: ${JSON.stringify(r.error)}`).toBe("success");

    const pitch = results["01-pitch-rest-house-rule.json"]?.output as { computation: { earliest_eligible_date: string; governing: string }; what_happened: { summary: string } };
    expect(pitch.computation).toMatchObject({ earliest_eligible_date: "2026-10-22", governing: "house_rule" });
    const strikeout = results["02-strikeout-game-over.json"]?.output as { intent: string; what_happened: { summary: string } };
    expect(strikeout.intent).toBe("development");
    expect(strikeout.what_happened.summary).toMatch(/umpire's call/);
    const d3k = results["03-dropped-third-strike.json"]?.output as { situations: { name: string }[] };
    expect(d3k.situations[0]?.name).toMatch(/runner on third/);
    const review = results["05-post-game-review.json"]?.output as { pitcher_rest: { eligible_again: string }[]; read: { issues: string[] } };
    expect(review.read.issues).toEqual([]);
    expect(review.pitcher_rest.map((p) => p.eligible_again)).toEqual(["2026-10-22", "2026-10-19"]);
    vi.unstubAllEnvs();
  }, 60_000);
});
