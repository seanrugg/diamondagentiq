import { describe, expect, it } from "vitest";
import { resolveDate } from "../src/calculators/dates.js";

// 2026-10-18 is a Sunday.
const reference = "2026-10-18";

describe("resolveDate", () => {
  it("resolves a weekday on_or_before the reference", () => {
    expect(resolveDate("Friday", reference, "on_or_before")).toBe(
      "2026-10-16",
    );
    expect(resolveDate("fri", reference, "on_or_before")).toBe("2026-10-16");
    expect(resolveDate("FRIDAY", reference, "on_or_before")).toBe(
      "2026-10-16",
    );
  });

  it("resolves a weekday on_or_after the reference", () => {
    expect(resolveDate("Sunday", reference, "on_or_after")).toBe(
      "2026-10-18",
    );
    expect(resolveDate("Friday", reference, "on_or_after")).toBe(
      "2026-10-23",
    );
    expect(resolveDate("sun", reference, "on_or_after")).toBe("2026-10-18");
  });

  it("returns the reference date when it is the weekday in either direction", () => {
    expect(resolveDate("Sunday", reference, "on_or_before")).toBe(
      "2026-10-18",
    );
    expect(resolveDate("Sunday", reference, "on_or_after")).toBe(
      "2026-10-18",
    );
  });

  it("resolves an ISO date as-is", () => {
    expect(resolveDate("2026-10-20", reference, "on_or_before")).toBe(
      "2026-10-20",
    );
    expect(resolveDate("2026-10-20", reference, "on_or_after")).toBe(
      "2026-10-20",
    );
  });

  it("resolves today/yesterday/tomorrow relative to the reference", () => {
    expect(resolveDate("today", reference, "on_or_before")).toBe(
      "2026-10-18",
    );
    expect(resolveDate("yesterday", reference, "on_or_after")).toBe(
      "2026-10-17",
    );
    expect(resolveDate("tomorrow", reference, "on_or_before")).toBe(
      "2026-10-19",
    );
  });

  it.each(["next week", "Mondayy", "2026-13-01", "2026-02-30", "", "2026/10/18", "10-18-2026"])(
    "returns null for unparseable input %s",
    (input) => {
      expect(resolveDate(input, reference, "on_or_before")).toBeNull();
    },
  );

  it("returns null for an invalid reference date", () => {
    expect(resolveDate("Friday", "not-a-date", "on_or_before")).toBeNull();
    expect(resolveDate("Friday", "2026-13-01", "on_or_after")).toBeNull();
  });
});
