/**
 * The one place DiamondAgentIQ touches the vendored Meterless H-MEM reference
 * (vendor/hmem, pinned, never edited: AGENTS.md rule 8).
 *
 * The vendor code is loaded by URL so our stricter compiler settings
 * (noUncheckedIndexedAccess) don't type-check it; it has its own test suite
 * (npm run test:hmem). The types below describe only the surface we use.
 *
 * State lives in DIQ_MEMORY_DIR (state.json + the append-only ledger.jsonl),
 * which is local and gitignored: memories can describe real players.
 */

export type MemoryLayer = "short_term" | "working" | "long_term";
export type MemoryType = "personal" | "factual" | "preference" | "general";
export type FeedbackKind = "helpful" | "not_helpful" | "wrong";

export interface MemoryRecord {
  id: string;
  content: string;
  type: MemoryType;
  layer: MemoryLayer;
  tags: string[];
  confidence: number;
  source: string;
  chatId?: string;
  domain: string;
  accessCount: number;
  timestamp: number;
}

export interface AddInput {
  content: string;
  type?: MemoryType;
  layer?: MemoryLayer;
  tags?: string[];
  confidence?: number;
  source: string;
  provenance?: { origin: string; learnedAt: number; label: string; refs?: string[] };
  chatId?: string;
}

export interface QueryResult {
  memories: { memory: MemoryRecord; relevance: number }[];
  context: string;
  trace: { retrievalReason: string; strategy: string; scores: Record<string, number> };
}

export interface LedgerEntry {
  memoryId: string;
  action: string;
  actor: string;
  timestamp: number;
  details?: Record<string, unknown>;
}

export interface Hmem {
  readonly clock: () => number;
  readonly store: { all(): MemoryRecord[]; get(id: string): MemoryRecord | undefined };
  readonly ledger: { all(): readonly LedgerEntry[]; stats(): Record<string, number> };
  add(input: AddInput): MemoryRecord;
  query(query: string, opts?: { topN?: number; threshold?: number; chatId?: string }): QueryResult;
  feedback(memoryId: string, kind: FeedbackKind): void;
}

export interface MiningService {
  mineInteraction(event: "chat_message" | "model_response", text: string, opts?: { chatId?: string; layer?: MemoryLayer }): Promise<MemoryRecord[]>;
}

type VendorModule = {
  HMEM: new (opts: { clock?: () => number; persistDir?: string; actor?: string }) => Hmem;
  MemoryMiningService: new (store: unknown, clock: () => number, minerFn?: (prompt: string) => Promise<string>) => MiningService;
};

const vendorUrl = new URL("../../vendor/hmem/src/index.ts", import.meta.url).href;
const vendor = (await import(vendorUrl)) as VendorModule;

export type OpenMemoryOptions = { dir?: string | null; clock?: () => number; actor?: string };

/** Open (or create) the H-MEM store. dir null/undefined = in memory only (tests, sample runs). */
export function openMemory(opts: OpenMemoryOptions = {}): Hmem {
  return new vendor.HMEM({
    ...(opts.dir ? { persistDir: opts.dir } : {}),
    ...(opts.clock ? { clock: opts.clock } : {}),
    actor: opts.actor ?? "memoryAgent",
  });
}

/** Mining that uses a model to extract memories (the H-MEM minerFn hook, spec section 4). */
export function modelMiner(hmem: Hmem, minerFn: (prompt: string) => Promise<string>): MiningService {
  return new vendor.MemoryMiningService(hmem.store, hmem.clock, minerFn);
}
