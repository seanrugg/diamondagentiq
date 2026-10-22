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

/**
 * The first date a pitcher is eligible to pitch again.
 *
 * A pitcher with N rest days needs N full calendar days off, counting the day
 * after the last pitched date as day one of rest. So a pitcher who last threw
 * on Friday with 2 days of rest is off Saturday and Sunday and is eligible
 * again on Monday.
 */
export function earliestEligibleDate(
  lastPitchedDate: string,
  restDays: number,
): string {
  const d = new Date(lastPitchedDate);
  d.setDate(d.getDate() + restDays + 1);
  return d.toISOString().slice(0, 10);
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
