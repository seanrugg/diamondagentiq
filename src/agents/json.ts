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

const FENCE_PATTERN = /```(?:json)?\s*([\s\S]*?)\s*```/i;

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
 * The first complete top-level JSON object substring in text, or null.
 */
function firstJsonObject(text: string): string | null {
  let searchFrom = 0;
  for (;;) {
    const open = text.indexOf("{", searchFrom);
    if (open === -1) {
      return null;
    }
    const close = matchingCloseBrace(text, open);
    if (close !== -1) {
      return text.slice(open, close + 1);
    }
    searchFrom = open + 1;
  }
}

/**
 * Extract the text to parse: the contents of the first fenced block when one
 * is present, otherwise the whole text (surrounding prose is ignored by the
 * object scan below).
 */
function extractBody(text: string): string {
  const fence = text.match(FENCE_PATTERN);
  return fence ? fence[1] : text;
}

/**
 * Parse a model's JSON reply. Strips markdown fences and surrounding prose,
 * extracts the first complete top-level JSON object, then JSON.parse.
 */
export function parseModelJson(text: string): JsonResult {
  const body = extractBody(text);
  const objectText = firstJsonObject(body);
  if (objectText === null) {
    return { ok: false, error: "No JSON object found in model output" };
  }

  let value: unknown;
  try {
    value = JSON.parse(objectText);
  } catch (error) {
    return {
      ok: false,
      error: `Invalid JSON: ${error instanceof Error ? error.message : String(error)}`,
    };
  }

  return { ok: true, value };
}
