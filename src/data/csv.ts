/**
 * Minimal RFC 4180 CSV parser: quoted fields, escaped quotes (""), commas and
 * newlines inside quotes, CRLF or LF line endings. Pure; no dependencies.
 */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;
  const src = text.startsWith("﻿") ? text.slice(1) : text;

  for (let i = 0; i < src.length; i += 1) {
    const ch = src[i] as string;
    if (inQuotes) {
      if (ch === '"') {
        if (src[i + 1] === '"') {
          field += '"';
          i += 1;
        } else {
          inQuotes = false;
        }
      } else {
        field += ch;
      }
      continue;
    }
    if (ch === '"') {
      inQuotes = true;
    } else if (ch === ",") {
      row.push(field);
      field = "";
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && src[i + 1] === "\n") i += 1;
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else {
      field += ch;
    }
  }
  if (inQuotes) {
    throw new Error("Unterminated quoted field in CSV");
  }
  if (field !== "" || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows.filter((r) => !(r.length === 1 && r[0] === ""));
}

/** Parse CSV text with a header row into objects keyed by header name. */
export function parseCsvRecords(text: string): Array<Record<string, string>> {
  const [header, ...body] = parseCsv(text);
  if (!header) {
    return [];
  }
  return body.map((cells, index) => {
    if (cells.length !== header.length) {
      throw new Error(
        `CSV row ${index + 2} has ${cells.length} fields; header has ${header.length}`,
      );
    }
    return Object.fromEntries(header.map((name, i) => [name, cells[i] ?? ""]));
  });
}
