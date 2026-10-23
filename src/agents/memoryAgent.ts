/**
 * MemoryAgent: the team's memory across questions, built on the Meterless
 * H-MEM engine (src/adapters/hmem.ts).
 *
 * 1. recall (code): hybrid H-MEM retrieval of what we know about this team
 *    before the other agents run, so answers can build on earlier work
 *    ("last week: plate coverage; next step: ...").
 * 2. mine (Lightning): after the answer, extract durable facts from the
 *    question (what the player struggles with, what they're working on)
 *    through H-MEM's model-mining hook.
 * 3. remember (code): store a summary of the answer (focus, lessons, date).
 * 4. feedback (code): memories CoachingAgent says it used are marked helpful
 *    when the Critic passes the answer, not_helpful when it doesn't, so H-MEM
 *    trusts them more or less next time.
 * Every step lands in H-MEM's append-only ledger and in our trace.
 */
import { modelMiner, type Hmem } from "../adapters/hmem.js";
import type { SituationAnswer, SituationRequest } from "../schemas/situation.js";
import { trace } from "../trace.js";
import type { ContextOutput } from "./contextAgent.js";
import { callModel } from "./modelJson.js";

export const RECALL_TOP_N = 3;
/** The mock embedder scores paraphrases low, so recall uses a lower bar than H-MEM's 0.35 default. */
export const RECALL_THRESHOLD = 0.15;
const AGENT = "memoryAgent";

export type RecalledMemory = { id: string; content: string; relevance: number; confidence: number };

export function memoryKey(request: SituationRequest): string {
  return `team:${(request.team ?? "default").trim().toLowerCase() || "default"}`;
}

export function recall(hmem: Hmem, request: SituationRequest, context: ContextOutput): RecalledMemory[] {
  const query = `${request.question} ${context.topic}`;
  const result = hmem.query(query, { topN: RECALL_TOP_N, threshold: RECALL_THRESHOLD, chatId: memoryKey(request) });
  const recalled = result.memories.map(({ memory, relevance }) => ({
    id: memory.id,
    content: memory.content,
    relevance: Number(relevance.toFixed(3)),
    confidence: Number(memory.confidence.toFixed(3)),
  }));
  trace({
    agent_name: AGENT,
    action: "recall",
    input_summary: `${memoryKey(request)}: ${query}`.slice(0, 300),
    output_summary: recalled.length ? recalled.map((m) => `${m.id} (${m.relevance}): ${m.content.slice(0, 80)}`).join(" | ") : "nothing relevant yet",
    status: "ok",
  });
  return recalled;
}

export function memoryText(recalled: RecalledMemory[]): string {
  if (recalled.length === 0) return "";
  return `What we remember about this team from earlier questions (use only if it helps; list the ids you use in memory_used):
${recalled.map((m) => `- ${m.id}: ${m.content}`).join("\n")}`;
}

const MINING_PROMPT = `You are the MemoryAgent for DiamondAgentIQ, a youth baseball/softball learning tool. From the parent, coach, player or umpire question below, extract durable facts worth remembering to help this team later: what a player struggles with or is working on, the team's situation, goals. Each fact is one short sentence in plain words.
Never include names, contact details, health or medical details, or anything about a child's safety or family situation. Never include the answer we gave. If nothing is worth remembering, return [].
Reply with ONLY a JSON array of strings.`;

/** Mine the question for durable facts (Lightning), then store the answer summary. Returns new memory ids. */
export async function remember(
  hmem: Hmem,
  request: SituationRequest,
  context: ContextOutput,
  answer: SituationAnswer,
  opts: { mine?: boolean; referenceDate: string },
): Promise<string[]> {
  const chatId = memoryKey(request);
  const saved: string[] = [];

  if (opts.mine !== false) {
    try {
      const miner = modelMiner(hmem, async (prompt) => {
        const result = await callModel(AGENT, [
          { role: "system", content: MINING_PROMPT },
          { role: "user", content: prompt },
        ], "lightning");
        trace({
          agent_name: AGENT,
          action: "mine_question",
          input_summary: `lightning; requested ${result.requested_model}${result.model !== result.requested_model ? `; provider served ${result.model}` : ""}`,
          output_summary: (result.content ?? "").slice(0, 400),
          model: result.model,
          provider: result.provider,
          reasoning: result.reasoning,
          receipt: result.receipt,
          status: "ok",
        });
        return result.content ?? "[]";
      });
      const mined = await miner.mineInteraction("chat_message", `(${request.role}, ${context.sport}, age ${context.age}) ${request.question}`, { chatId, layer: "working" });
      saved.push(...mined.map((m) => m.id));
    } catch (error) {
      trace({ agent_name: AGENT, action: "mine_question", input_summary: chatId, output_summary: `skipped: ${error instanceof Error ? error.message.slice(0, 200) : "error"}`, status: "error" });
    }
  }

  const parts = [
    `${opts.referenceDate}: a ${request.role} asked about ${context.topic}.`,
    answer.focus ? `Focus given: ${answer.focus}.` : "",
    answer.life_lesson?.lessons.length ? `Lesson: ${answer.life_lesson.lessons.map((l) => l.title).join("; ")}.` : "",
    typeof answer.computation?.earliest_eligible_date === "string" ? `Pitcher eligible again ${answer.computation.earliest_eligible_date}.` : "",
  ].filter(Boolean);
  const summary = hmem.add({
    content: parts.join(" "),
    type: "factual",
    layer: "working",
    tags: ["session", answer.intent ?? "ruling", ...(answer.life_lesson?.lessons.map((l) => l.id) ?? [])],
    confidence: Math.max(0.3, answer.confidence),
    source: `diamondagentiq:answer:${answer.trace_id}`,
    provenance: { origin: "plan_completion", learnedAt: hmem.clock(), label: "answer summary", refs: answer.sources.map((s) => `${s.table}:${s.id}`) },
    chatId,
  });
  saved.push(summary.id);

  trace({ agent_name: AGENT, action: "remember", input_summary: chatId, output_summary: `saved ${saved.join(", ")}`, status: "ok" });
  return saved;
}

/** Critic outcome -> H-MEM confidence for the memories the answer used. */
export function feedback(hmem: Hmem, used: string[], passed: boolean): void {
  for (const id of used) {
    if (!hmem.store.get(id)) continue;
    hmem.feedback(id, passed ? "helpful" : "not_helpful");
  }
  if (used.length) {
    trace({ agent_name: AGENT, action: "feedback", input_summary: used.join(", "), output_summary: passed ? "helpful (critic passed)" : "not_helpful (critic did not pass)", status: "ok" });
  }
}
