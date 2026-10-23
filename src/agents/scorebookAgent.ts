/**
 * ScorebookAgent (Nemotron Super VL): reads a box score, from a screenshot or
 * pasted text, into structured rows. It only transcribes; code checks that the
 * numbers agree with each other (checkBoxScore) and does all the math. If the
 * totals don't agree, it gets one re-read with the exact disagreements.
 */
import type { ChatCompletionContentPart, ChatCompletionMessageParam } from "openai/resources/chat/completions";
import { checkBoxScore } from "../calculators/boxScore.js";
import { BoxScoreSchema, type BoxScore, type GameReviewRequest } from "../schemas/boxScore.js";
import { trace } from "../trace.js";
import { askJson } from "./modelJson.js";

export const MAX_REREADS = 1;
const AGENT = "scorebookAgent";

const SYSTEM = `You are the ScorebookAgent for DiamondAgentIQ. Transcribe a youth baseball/softball box score exactly as printed. Do not calculate, guess or fix anything: copy the numbers you see. Player names exactly as shown (they may be initials and jersey numbers).
Reply with ONLY this JSON:
{"away_team": "...", "home_team": "...", "date": "YYYY-MM-DD" or null, "event": "..." or null,
 "line_score": {"away": [runs by inning], "home": [runs by inning], "away_rhe": {"r": 0, "h": 0, "e": 0}, "home_rhe": {"r": 0, "h": 0, "e": 0}},
 "stats_team": "<the team whose batting and pitching tables are shown>",
 "batting": [{"player": "...", "ab": 0, "r": 0, "h": 0, "rbi": 0, "bb": 0, "so": 0}],
 "batting_totals": {"ab": 0, "r": 0, "h": 0, "rbi": 0, "bb": 0, "so": 0} or null,
 "pitching": [{"player": "...", "ip": "4.0", "h": 0, "r": 0, "er": 0, "bb": 0, "so": 0, "pitches": 0 or null}],
 "pitching_totals": {"ip": "6.0", "h": 0, "r": 0, "er": 0, "bb": 0, "so": 0, "pitches": 0 or null} or null}`;

export type ScorebookResult =
  | { ok: true; boxScore: BoxScore; issues: string[]; reads: number }
  | { ok: false; error: { message: string; attempts: number } };

function inputPart(request: GameReviewRequest): ChatCompletionContentPart[] {
  if (request.image) {
    return [
      { type: "text", text: "Transcribe this box score." },
      { type: "image_url", image_url: { url: request.image } },
    ];
  }
  return [{ type: "text", text: `Transcribe this box score:\n\n${request.text ?? ""}` }];
}

export async function scorebookAgent(request: GameReviewRequest): Promise<ScorebookResult> {
  const messages: ChatCompletionMessageParam[] = [
    { role: "system", content: SYSTEM },
    { role: "user", content: inputPart(request) },
  ];
  let best: { boxScore: BoxScore; issues: string[] } | null = null;
  let reads = 0;

  for (let read = 0; read <= MAX_REREADS; read += 1) {
    let result;
    try {
      result = await askJson(AGENT, read === 0 ? "read_box_score" : "reread_box_score", "super", messages, BoxScoreSchema);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (request.image && /cannot serve vision/i.test(message)) {
        return { ok: false, error: { message: "Nightshift has no lane that can read images yet. Paste the box score as text instead (in GameChanger, copy the box score or export the stats)", attempts: read + 1 } };
      }
      throw error;
    }
    if (!result.ok) return best ? { ok: true, ...best, reads } : { ok: false, error: result.error };
    reads += 1;
    const issues = checkBoxScore(result.value);
    trace({
      agent_name: AGENT,
      action: "check_totals",
      input_summary: `read ${read + 1}: ${result.value.away_team} at ${result.value.home_team}, ${result.value.batting.length} batters, ${result.value.pitching.length} pitchers`,
      output_summary: issues.length ? `totals disagree: ${issues.join(" | ")}`.slice(0, 600) : "all totals agree",
      status: issues.length ? "error" : "ok",
    });
    if (!best || issues.length < best.issues.length) best = { boxScore: result.value, issues };
    if (issues.length === 0) break;
    if (read < MAX_REREADS) {
      messages.push({ role: "assistant", content: JSON.stringify(result.value) });
      messages.push({
        role: "user",
        content: `Some numbers don't agree with each other, which usually means a digit was misread:\n${issues.map((i) => `- ${i}`).join("\n")}\nLook at the box score again and reply with the corrected JSON only. Copy what is printed; don't force totals to match.`,
      });
    }
  }
  return best ? { ok: true, ...best, reads } : { ok: false, error: { message: "no read", attempts: 0 } };
}
