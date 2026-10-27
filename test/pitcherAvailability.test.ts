import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it, vi } from "vitest";

const runAgentRows = vi.fn();
vi.mock("../src/adapters/dataTools.js", () => ({ runAgentRows }));
vi.mock("../src/trace.js", () => ({ trace: vi.fn() }));

const { pitcherAvailability, parsePitchLogCsv } = await import("../src/agents/pitcherAvailability.js");

const LL_URL = "https://www.littleleague.org/playing-rules/pitch-count/";
const tiers = [
  [1, 20, 0],
  [21, 35, 1],
  [36, 50, 2],
  [51, 65, 3],
  [66, 85, 4],
].map(([min, max, rest]) => ({
  age_min: "11", age_max: "12", pitches_min: String(min), pitches_max: String(max), rest_days: String(rest),
  edition: "page modified 2026-02-11", source_url: LL_URL, verified: "true",
}));

// Same rows as the bundled CSV, shaped like Zetaris returns them (strings).
const csvRows = parsePitchLogCsv(readFileSync(new URL("../data/demo/pitch_log_synthetic.csv", import.meta.url), "utf8"));
const viewRows = csvRows.map((r) => ({
  team: r.team, pitcher_name: r.pitcher_name, age: String(r.age), sanction: r.sanction, sport: r.sport,
  game_date: r.game_date, pitches: String(r.pitches), synthetic: "true", rest_days: "",
}));

const byName = (answer: { pitchers: { pitcher: string }[] }) =>
  Object.fromEntries(answer.pitchers.map((p) => [p.pitcher.replace(" (synthetic)", ""), p]));

describe("pitcherAvailability", () => {
  beforeEach(() => runAgentRows.mockReset());

  it("reads the mart view and computes Saturday's availability in code", async () => {
    runAgentRows.mockResolvedValueOnce(viewRows).mockResolvedValueOnce(tiers);
    const result = await pitcherAvailability({ date: "Saturday" }, "2026-10-27", { mart: "diamondagentiq_knowledge" });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const a = result.answer;
    expect(a.game_date).toBe("2026-10-31");
    expect(a.read_from).toMatch(/^diamondagentiq_knowledge\.pitcher_availability/);
    expect(runAgentRows.mock.calls[0]?.[1]).toEqual({ schema: "diamondagentiq_knowledge", tables: ["pitcher_availability"] });
    const p = byName(a);
    expect(p["Alex Rivera"]).toMatchObject({ rest_days: 4, earliest_eligible: "2026-10-29", available: true });
    expect(p["Jordan Lee"]).toMatchObject({ rest_days: 1, earliest_eligible: "2026-10-26", available: true });
    expect(p["Sam Patel"]).toMatchObject({ rest_days: 3, earliest_eligible: "2026-10-31", available: true });
    expect(p["Casey Brooks"]).toMatchObject({ rest_days: 0, earliest_eligible: "2026-10-29", available: true });
    expect(p["Riley Chen"]).toMatchObject({ rest_days: 4, earliest_eligible: "2026-11-02", available: false });
    expect(p["Morgan Diaz"]).toMatchObject({ rest_days: 2, earliest_eligible: "2026-11-01", available: false });
    expect(a.pitchers.slice(0, 4).every((x) => x.available)).toBe(true);
    expect(a).toMatchObject({ verified: true, synthetic: true, source_url: LL_URL });
  });

  it("falls back from the mart to the diq view, and notes a view that disagrees with code", async () => {
    const wrong = viewRows.map((r) => (r.pitcher_name.startsWith("Riley") ? { ...r, rest_days: "1" } : r));
    runAgentRows.mockRejectedValueOnce(new Error("no mart")).mockResolvedValueOnce(wrong).mockResolvedValueOnce(tiers);
    const result = await pitcherAvailability({ date: "2026-10-31" }, "2026-10-27", { mart: "diamondagentiq_knowledge" });
    expect(result.ok && result.answer.read_from).toMatch(/^diq\.pitcher_availability/);
    if (!result.ok) return;
    expect(byName(result.answer)["Riley Chen"]).toMatchObject({ rest_days: 4, available: false, note: expect.stringMatching(/view said 1/) });
  });

  it("uses the bundled CSV in sample mode and reports unreadable dates", async () => {
    runAgentRows.mockResolvedValueOnce(tiers);
    const result = await pitcherAvailability({ date: "Saturday", team: "Fall Classic 12U Navy" }, "2026-10-27", { sampleMode: true });
    expect(result.ok && result.answer.pitchers).toHaveLength(6);
    expect(runAgentRows).toHaveBeenCalledTimes(1);
    expect(await pitcherAvailability({ date: "someday" }, "2026-10-27", { sampleMode: true })).toMatchObject({ ok: false });
  });

  it("says when every Zetaris source fails instead of guessing", async () => {
    runAgentRows.mockRejectedValueOnce(new Error("Zetaris down")).mockRejectedValueOnce(new Error("Zetaris down"));
    const result = await pitcherAvailability({ date: "Saturday" }, "2026-10-27", { mart: null });
    expect(result.ok).toBe(false);
    expect(!result.ok && result.message).toMatch(/isn't available in Zetaris/);
  });
});
