/**
 * Deterministic pitch-count rest math.
 *
 * Pure functions: no I/O, no network, no randomness. Tier rows are the
 * `pitch_rest_rules` shape (age_min, age_max, pitches_min, pitches_max,
 * rest_days). Zetaris returns values as strings, so every numeric input is
 * converted with Number() before comparing.
 */

export type PitchRestTier = {
  age_min: number;
  age_max: number;
  pitches_min: number;
  pitches_max: number;
  rest_days: number;
};

// A raw tier row as returned by Zetaris: every field may arrive as a string.
export type RestTierRow = {
  age_min: string | number;
  age_max: string | number;
  pitches_min: string | number;
  pitches_max: string | number;
  rest_days: string | number;
};

type RestDaysMatch = {
  kind: "match";
  rest_days: number;
  tier: PitchRestTier;
};

type RestDaysNoMatch = {
  kind: "no_match";
  rest_days: null;
  tier: null;
};

export type RestDaysResult = RestDaysMatch | RestDaysNoMatch;

function toNumber(value: string | number): number {
  return Number(value);
}

function asTier(row: RestTierRow): PitchRestTier {
  return {
    age_min: toNumber(row.age_min),
    age_max: toNumber(row.age_max),
    pitches_min: toNumber(row.pitches_min),
    pitches_max: toNumber(row.pitches_max),
    rest_days: toNumber(row.rest_days),
  };
}

/**
 * Find the rest tier matching a pitcher's age and pitch count, returning the
 * required rest days plus the matched tier. Returns a "no_match" result when
 * no tier covers the (age, pitches) pair.
 */
export function restDaysRequired(
  pitches: string | number,
  age: string | number,
  tiers: readonly RestTierRow[],
): RestDaysResult {
  const p = toNumber(pitches);
  const a = toNumber(age);

  for (const row of tiers) {
    const tier = asTier(row);
    if (
      a >= tier.age_min &&
      a <= tier.age_max &&
      p >= tier.pitches_min &&
      p <= tier.pitches_max
    ) {
      return { kind: "match", rest_days: tier.rest_days, tier };
    }
  }

  return { kind: "no_match", rest_days: null, tier: null };
}

const ISO_DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;

/**
 * The first date a pitcher is eligible to pitch again.
 *
 * A pitcher with N rest days needs N full calendar days off, counting the day
 * after the last pitched date as day one of rest. So a pitcher who last threw
 * on Friday with 2 days of rest is off Saturday and Sunday and is eligible
 * again on Monday.
 *
 * All arithmetic is done in UTC so the result is deterministic regardless of
 * the process timezone (e.g. across US DST changes). Only strict YYYY-MM-DD
 * input is accepted; anything else throws a clear error.
 */
export function earliestEligibleDate(
  lastPitchedDate: string,
  restDays: number,
): string {
  const match = ISO_DATE_PATTERN.exec(lastPitchedDate);
  if (!match) {
    throw new Error(
      `Invalid date "${lastPitchedDate}": expected YYYY-MM-DD`,
    );
  }

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);

  const ms = Date.UTC(year, month - 1, day);
  if (Number.isNaN(ms)) {
    throw new Error(`Invalid date "${lastPitchedDate}": expected YYYY-MM-DD`);
  }

  const d = new Date(ms);
  // Round-trip check: reject out-of-range components (e.g. 2026-13-45) that
  // Date.UTC would otherwise roll over into a different date.
  if (
    d.getUTCFullYear() !== year ||
    d.getUTCMonth() + 1 !== month ||
    d.getUTCDate() !== day
  ) {
    throw new Error(`Invalid date "${lastPitchedDate}": expected YYYY-MM-DD`);
  }

  d.setUTCDate(d.getUTCDate() + restDays + 1);
  return formatUtcDate(d);
}

function formatUtcDate(d: Date): string {
  const year = d.getUTCFullYear();
  const month = String(d.getUTCMonth() + 1).padStart(2, "0");
  const date = String(d.getUTCDate()).padStart(2, "0");
  return `${year}-${month}-${date}`;
}

/**
 * Resolve the sanction rest days against an optional house rule, using the
 * stricter (larger) value.
 *
 * `conflict` is true whenever the house rule and the sanction disagree, i.e.
 * there is an actual rule conflict to resolve and disclose.
 */
export function applyHouseRule(
  sanctionRestDays: string | number,
  houseRuleRestDays?: string | number,
): {
  rest_days: number;
  governing: "sanction" | "house_rule";
  conflict: boolean;
} {
  const sanction = toNumber(sanctionRestDays);

  if (houseRuleRestDays === undefined || houseRuleRestDays === "") {
    return { rest_days: sanction, governing: "sanction", conflict: false };
  }

  const house = toNumber(houseRuleRestDays);

  if (house === sanction) {
    return { rest_days: sanction, governing: "sanction", conflict: false };
  }

  if (house > sanction) {
    return { rest_days: house, governing: "house_rule", conflict: true };
  }

  return { rest_days: sanction, governing: "sanction", conflict: true };
}

/**
 * A house or tournament rule expressed as structure (extracted from its text
 * by an agent; applied here by code):
 * - add_days: outings of at least `min_pitches` need `days` extra rest days
 * - absolute: the event's own rest requirement, in days
 */
export type HouseRuleAdjustment =
  | { kind: "add_days"; min_pitches: number; days: number }
  | { kind: "absolute"; rest_days: number };

/**
 * Combine the sanction's rest days with an optional house-rule adjustment.
 * The stricter (larger) requirement governs. `conflict` is true when the house
 * rule changes the answer, so the conflict can be disclosed.
 */
export function applyHouseRuleAdjustment(
  sanctionRestDays: string | number,
  pitches: string | number,
  adjustment?: HouseRuleAdjustment,
): { rest_days: number; governing: "sanction" | "house_rule"; conflict: boolean } {
  const sanction = toNumber(sanctionRestDays);
  if (!adjustment) {
    return { rest_days: sanction, governing: "sanction", conflict: false };
  }

  const house =
    adjustment.kind === "add_days"
      ? toNumber(pitches) >= adjustment.min_pitches
        ? sanction + adjustment.days
        : sanction
      : adjustment.rest_days;

  if (house > sanction) {
    return { rest_days: house, governing: "house_rule", conflict: true };
  }
  return { rest_days: sanction, governing: "sanction", conflict: false };
}
