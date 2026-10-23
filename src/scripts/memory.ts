#!/usr/bin/env tsx
/**
 * npm run memory [-- --team "Demo Hawks"]
 * Shows what MemoryAgent (H-MEM) remembers, with confidence, and the trust
 * ledger counts. Reads DIQ_MEMORY_DIR; no network.
 */
import { openMemory } from "../adapters/hmem.js";
import { config } from "../config.js";

const teamIndex = process.argv.indexOf("--team");
const team = teamIndex >= 0 ? process.argv[teamIndex + 1] : undefined;
const chatId = team ? `team:${team.trim().toLowerCase()}` : undefined;

const hmem = openMemory({ dir: config.DIQ_MEMORY_DIR });
const records = hmem.store
  .all()
  .filter((m) => !chatId || m.chatId === chatId)
  .sort((a, b) => a.timestamp - b.timestamp);

console.log(`H-MEM at ${config.DIQ_MEMORY_DIR}: ${records.length} memories${chatId ? ` for ${chatId}` : ""}\n`);
for (const m of records) {
  console.log(`${m.id}  [${m.chatId ?? "-"}] conf ${m.confidence.toFixed(2)} · ${m.layer} · used ${m.accessCount}x\n  ${m.content}\n  source: ${m.source}\n`);
}
console.log("Ledger:", JSON.stringify(hmem.ledger.stats()));
