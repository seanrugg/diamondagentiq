/**
 * Robust JSON parsing for model output.
 *
 * Models often wrap JSON in markdown fences or surround it with prose. This
 * strips ```json / ``` fences, extracts the first complete top-level JSON
 * object (braces inside string literals are ignored), and parses it.
 *
 * Returns { ok: true, value } on success or { ok: false, error } on failure.
 */

export type JsonResult =
  | { ok: true; value: unknown }
  | { ok: false; error: string };

/**
 * Index of the matching closing brace for the opening brace at openIndex,
 * scanning respecting string literals and escapes. Returns -1 when unclosed.
 */
function matchingCloseBrace(text: string, openIndex: number): number {
  let depth = 0;
  let inString = false;
  let escape = false;

  for (let i = openIndex; i < text.length; i += 1) {
    const ch = text[i];
    if (escape) {
      escape = false;
      continue;
    }
    if (inString) {
      if (ch === "\\") {
        escape = true;
      } else if (ch === '"') {
        inString = false;
      }
      continue;
    }
    if (ch === '"') {
      inString = true;
    } else if (ch === "{") {
      depth += 1;
    } else if (ch === "}") {
      depth -= 1;
      if (depth === 0) {
        return i;
      }
    }
  }
  return -1;
}

/**
 * Every complete top-level JSON object substring in text, in order. A brace
 * that never closes is skipped, so prose like "use {curly} braces" before the
 * real answer doesn't hide it.
 */
function jsonObjects(text: string): string[] {
  const found: string[] = [];
  let searchFrom = 0;
  for (;;) {
    const open = text.indexOf("{", searchFrom);
    if (open === -1) return found;
    const close = matchingCloseBrace(text, open);
    if (close === -1) {
      searchFrom = open + 1;
      continue;
    }
    found.push(text.slice(open, close + 1));
    searchFrom = close + 1;
  }
}

/**
 * Parse a model's JSON reply. Reasoning models (Nemotron Ultra on Nightshift's
 * deep lane) often think out loud first, sometimes quoting a fragment like
 * "{...}" or an example object before the answer. So every top-level object in
 * the reply is tried, fenced blocks included, and the largest one that parses
 * wins (the answer is the full object; examples and fragments are smaller).
 */
export function parseModelJson(text: string): JsonResult {
  const candidates = jsonObjects(text);
  if (candidates.length === 0) {
    return { ok: false, error: "No JSON object found in model output" };
  }
  let best: { value: unknown; size: number } | null = null;
  let firstError: string | null = null;
  for (const candidate of candidates) {
    try {
      const value: unknown = JSON.parse(candidate);
      if (!best || candidate.length >= best.size) best = { value, size: candidate.length };
    } catch (error) {
      firstError ??= error instanceof Error ? error.message : String(error);
    }
  }
  if (best) return { ok: true, value: best.value };
  return { ok: false, error: `Invalid JSON: ${firstError}` };
}
