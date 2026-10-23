import { describe, expect, it } from "vitest";
import {
  applyHouseRule,
  earliestEligibleDate,
  restDaysRequired,
} from "../src/calculators/pitchRest.js";

// Fixture tier rows, mirroring the pitch_rest_rules shape. Zetaris returns
// values as strings, so several tests pass string values end-to-end.
const tiers = [
  { age_min: "7", age_max: "8", pitches_min: "1", pitches_max: "20", rest_days: "0" },
  { age_min: "7", age_max: "8", pitches_min: "21", pitches_max: "35", rest_days: "1" },
  { age_min: "9", age_max: "10", pitches_min: "1", pitches_max: "20", rest_days: "0" },
  { age_min: "9", age_max: "10", pitches_min: "21", pitches_max: "35", rest_days: "1" },
  { age_min: "9", age_max: "10", pitches_min: "36", pitches_max: "50", rest_days: "2" },
  { age_min: "9", age_max: "10", pitches_min: "51", pitches_max: "65", rest_days: "3" },
];

describe("restDaysRequired", () => {
  it("matches a tier at the exact pitches min boundary", () => {
    const result = restDaysRequired("21", "9", tiers);
    expect(result.kind).toBe("match");
    expect(result.rest_days).toBe(1);
    expect(result.tier?.pitches_min).toBe(21);
  });

  it("matches a tier at the exact pitches max boundary", () => {
    const low = restDaysRequired("35", "9", tiers);
    expect(low.kind).toBe("match");
    expect(low.rest_days).toBe(1);

    const high = restDaysRequired("36", "9", tiers);
    expect(high.kind).toBe("match");
    expect(high.rest_days).toBe(2);
  });

  it("matches across the age boundary", () => {
    const eight = restDaysRequired("20", "8", tiers);
    expect(eight.kind).toBe("match");
    expect(eight.rest_days).toBe(0);

    const nine = restDaysRequired("20", "9", tiers);
    expect(nine.kind).toBe("match");
    expect(nine.rest_days).toBe(0);
  });

  it("accepts string inputs (as Zetaris returns them)", () => {
    const fromStrings = restDaysRequired("51", "10", tiers);
    const fromNumbers = restDaysRequired(51, 10, tiers);
    expect(fromStrings).toEqual(fromNumbers);
    expect(fromStrings.rest_days).toBe(3);
  });

  it("returns a clear no-match result above every tier", () => {
    const result = restDaysRequired("100", "9", tiers);
    expect(result.kind).toBe("no_match");
    expect(result.rest_days).toBeNull();
    expect(result.tier).toBeNull();
  });

  it("returns a clear no-match result below every tier", () => {
    const result = restDaysRequired("10", "6", tiers);
    expect(result.kind).toBe("no_match");
    expect(result.rest_days).toBeNull();
  });
});

describe("earliestEligibleDate", () => {
  it("with zero rest days is eligible the next day", () => {
    expect(earliestEligibleDate("2026-04-10", 0)).toBe("2026-04-11");
  });

  it("counts N full calendar days off across a weekend", () => {
    // Pitched Friday 2026-04-11, two full days off (Sat, Sun), eligible Mon.
    expect(earliestEligibleDate("2026-04-11", 2)).toBe("2026-04-14");
  });

  it("rolls over month and year boundaries", () => {
    expect(earliestEligibleDate("2026-12-30", 2)).toBe("2027-01-02");
    expect(earliestEligibleDate("2026-01-30", 2)).toBe("2026-02-02");
  });
});

describe("earliestEligibleDate: UTC determinism across DST", () => {
  it("crosses the US spring-forward change (2026-03-08)", () => {
    // Pitched Friday 2026-03-06, four full days off, eligible 2026-03-11.
    expect(earliestEligibleDate("2026-03-06", 4)).toBe("2026-03-11");
  });

  it("crosses the US fall-back change (2026-11-01)", () => {
    // Pitched Friday 2026-10-30, four full days off, eligible 2026-11-04.
    expect(earliestEligibleDate("2026-10-30", 4)).toBe("2026-11-04");
  });

  it.each([
    "not-a-date",
    "2026-3-6",
    "2026-13-01",
    "2026-02-30",
    "",
    "2026/03/06",
    "2026-03-06T00:00:00",
  ])("rejects %s with a clear error", (input) => {
    expect(() => earliestEligibleDate(input, 0)).toThrow(
      /expected YYYY-MM-DD/,
    );
  });
});

describe("applyHouseRule", () => {
  it("uses the sanction when there is no house rule", () => {
    expect(applyHouseRule(2)).toEqual({
      rest_days: 2,
      governing: "sanction",
      conflict: false,
    });
  });

  it("uses the stricter house rule when it is stricter (larger)", () => {
    expect(applyHouseRule(1, 3)).toEqual({
      rest_days: 3,
      governing: "house_rule",
      conflict: true,
    });
  });

  it("keeps the sanction when the house rule is looser (smaller)", () => {
    expect(applyHouseRule(3, 1)).toEqual({
      rest_days: 3,
      governing: "sanction",
      conflict: true,
    });
  });

  it("reports no conflict when house rule matches the sanction", () => {
    expect(applyHouseRule(2, 2)).toEqual({
      rest_days: 2,
      governing: "sanction",
      conflict: false,
    });
  });

  it("accepts string inputs", () => {
    expect(applyHouseRule("1", "3")).toEqual({
      rest_days: 3,
      governing: "house_rule",
      conflict: true,
    });
  });
});
