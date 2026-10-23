import { describe, expect, it } from "vitest";
import { modelMiner, openMemory } from "../src/adapters/hmem.js";

const T0 = 1_790_000_000_000;

describe("hmem adapter", () => {
  it("adds, retrieves and adjusts confidence through the vendored H-MEM", async () => {
    const hmem = openMemory({ clock: () => T0 });
    const m = hmem.add({ content: "Player is working on plate coverage against pitchers who miss away.", source: "test", confidence: 0.7, chatId: "team:a" });
    const found = hmem.query("still striking out on outside pitches, plate coverage", { threshold: 0.1, chatId: "team:a" });
    expect(found.memories[0]?.memory.id).toBe(m.id);
    hmem.feedback(m.id, "helpful");
    expect(hmem.store.get(m.id)?.confidence).toBeCloseTo(0.75, 5);
    expect(hmem.ledger.stats()).toMatchObject({ create: 1, read: 1, feedback: 1 });

    const mined = await modelMiner(hmem, async () => '```json\n["Player gets nervous after being hit by a pitch."]\n```').mineInteraction("chat_message", "x", { chatId: "team:a" });
    expect(mined.map((r) => r.content)).toEqual(["Player gets nervous after being hit by a pitch."]);
  });
});
