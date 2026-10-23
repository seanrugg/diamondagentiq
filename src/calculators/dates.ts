/**
 * Deterministic date resolution for situation entities.
 *
 * All arithmetic is done in UTC, so results do not depend on the process
 * timezone.
 *
 * Input may be:
 * - an ISO date ("YYYY-MM-DD") — returned as-is when it is a real calendar date
 * - a weekday name ("Friday", "fri", case-insensitive; full or three-letter)
 * - "today", "yesterday", "tomorrow" — relative to the reference date
 *
 * Anything else resolves to null.
 */

export type DateDirection = "on_or_before" | "on_or_after";

const ISO_DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;

const WEEKDAYS: Record<string, number> = {
  sunday: 0,
  sun: 0,
  monday: 1,
  mon: 1,
  tuesday: 2,
  tue: 2,
  wednesday: 3,
  wed: 3,
  thursday: 4,
  thu: 4,
  friday: 5,
  fri: 5,
  saturday: 6,
  sat: 6,
};

function parseIsoDate(text: string): Date | null {
  const match = ISO_DATE_PATTERN.exec(text);
  if (!match) {
    return null;
  }

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const ms = Date.UTC(year, month - 1, day);
  if (Number.isNaN(ms)) {
    return null;
  }

  const d = new Date(ms);
  if (
    d.getUTCFullYear() !== year ||
    d.getUTCMonth() + 1 !== month ||
    d.getUTCDate() !== day
  ) {
    return null;
  }
  return d;
}

function cloneUtc(d: Date): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}

function addUtcDays(d: Date, days: number): Date {
  const result = cloneUtc(d);
  result.setUTCDate(result.getUTCDate() + days);
  return result;
}

function formatUtcDate(d: Date): string {
  const year = d.getUTCFullYear();
  const month = String(d.getUTCMonth() + 1).padStart(2, "0");
  const date = String(d.getUTCDate()).padStart(2, "0");
  return `${year}-${month}-${date}`;
}

/**
 * Resolve `input` to a "YYYY-MM-DD" relative to `referenceDate` (itself a
 * "YYYY-MM-DD"), applying `direction` for weekday inputs:
 * - "on_or_before": the latest matching date on or before the reference
 * - "on_or_after": the earliest matching date on or after the reference
 *
 * Returns null for an unparseable input or an invalid reference date.
 */
export function resolveDate(
  input: string,
  referenceDate: string,
  direction: DateDirection,
): string | null {
  const ref = parseIsoDate(referenceDate);
  if (ref === null) {
    return null;
  }

  const trimmed = input.trim();
  const iso = parseIsoDate(trimmed);
  if (iso !== null) {
    return formatUtcDate(iso);
  }

  const key = trimmed.toLowerCase();
  let target: Date | null = null;

  if (key === "today") {
    target = cloneUtc(ref);
  } else if (key === "yesterday") {
    target = addUtcDays(ref, -1);
  } else if (key === "tomorrow") {
    target = addUtcDays(ref, 1);
  } else {
    const weekday = WEEKDAYS[key];
    if (weekday === undefined) {
      return null;
    }
    const refWeekday = ref.getUTCDay(); // 0 = Sunday
    let offset = (weekday - refWeekday + 7) % 7;
    if (direction === "on_or_before") {
      offset = offset === 0 ? 0 : offset - 7;
    } else {
      offset = offset === 0 ? 0 : offset;
    }
    target = addUtcDays(ref, offset);
  }

  return formatUtcDate(target);
}
