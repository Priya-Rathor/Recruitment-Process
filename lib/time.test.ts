import { describe, expect, it } from "vitest";
import {
  dayKeyInZone,
  dayRangeInZone,
  daysSince,
  isValidTimeZone,
  resolveTimeZone,
  startOfDayInZone,
} from "./time";

const HOUR = 60 * 60 * 1000;

describe("startOfDayInZone", () => {
  it("uses the organization's timezone, not UTC (Asia/Kolkata is UTC+5:30)", () => {
    // 13 Aug 2026, 02:00 UTC = 07:30 IST the same day.
    // So the IST day began at 18:30 UTC on the 12th.
    const at = new Date("2026-08-13T02:00:00Z");
    expect(startOfDayInZone("Asia/Kolkata", at).toISOString()).toBe("2026-08-12T18:30:00.000Z");
  });

  it("puts a UTC-morning instant on the PREVIOUS IST day near the boundary", () => {
    // 12 Aug 23:00 UTC = 13 Aug 04:30 IST -> IST day started 12 Aug 18:30 UTC.
    const at = new Date("2026-08-12T23:00:00Z");
    expect(startOfDayInZone("Asia/Kolkata", at).toISOString()).toBe("2026-08-12T18:30:00.000Z");
  });

  it("is identity-ish for UTC", () => {
    const at = new Date("2026-08-13T13:45:12.345Z");
    expect(startOfDayInZone("UTC", at).toISOString()).toBe("2026-08-13T00:00:00.000Z");
  });

  it("handles a whole-hour negative offset (America/New_York, EDT = UTC-4)", () => {
    const at = new Date("2026-08-13T16:00:00Z"); // 12:00 EDT
    expect(startOfDayInZone("America/New_York", at).toISOString()).toBe("2026-08-13T04:00:00.000Z");
  });

  it("falls back to UTC for an invalid timezone instead of throwing", () => {
    const at = new Date("2026-08-13T13:45:00Z");
    expect(startOfDayInZone("Not/AZone", at).toISOString()).toBe("2026-08-13T00:00:00.000Z");
  });
});

describe("startOfDayInZone across DST transitions", () => {
  // US spring-forward 2026: 8 March, 02:00 EST -> 03:00 EDT.
  it("is correct later on a spring-forward day", () => {
    // 8 Mar 2026 20:00 UTC = 16:00 EDT (UTC-4). Midnight that day was EST (UTC-5).
    const at = new Date("2026-03-08T20:00:00Z");
    expect(startOfDayInZone("America/New_York", at).toISOString()).toBe("2026-03-08T05:00:00.000Z");
  });

  // US fall-back 2026: 1 November, 02:00 EDT -> 01:00 EST.
  it("is correct later on a fall-back day", () => {
    // 1 Nov 2026 20:00 UTC = 15:00 EST (UTC-5). Midnight that day was EDT (UTC-4).
    const at = new Date("2026-11-01T20:00:00Z");
    expect(startOfDayInZone("America/New_York", at).toISOString()).toBe("2026-11-01T04:00:00.000Z");
  });
});

describe("startOfDayInZone where local midnight happens TWICE", () => {
  // These zones end DST at 01:00 -> 00:00 local, so 00:00 occurs twice and the
  // day is 25h long starting at the FIRST midnight. A two-pass offset
  // correction lands on the second one and silently loses the day's first hour.
  it("returns the FIRST midnight for America/Havana on 2026-11-01", () => {
    const at = new Date("2026-11-01T18:00:00Z");
    expect(startOfDayInZone("America/Havana", at).toISOString()).toBe("2026-11-01T04:00:00.000Z");
  });

  it("returns the FIRST midnight for Atlantic/Azores on 2026-10-25", () => {
    const at = new Date("2026-10-25T12:00:00Z");
    expect(startOfDayInZone("Atlantic/Azores", at).toISOString()).toBe("2026-10-25T00:00:00.000Z");
  });

  it("counts a record from the ambiguous first hour as part of today", () => {
    // The bug this protects against: a candidate created 04:30Z on 1 Nov in
    // Havana is local 00:30 that day, so it MUST count toward "today".
    const created = new Date("2026-11-01T04:30:00Z");
    const { start, end } = dayRangeInZone("America/Havana", new Date("2026-11-01T18:00:00Z"));
    expect(created.getTime()).toBeGreaterThanOrEqual(start.getTime());
    expect(created.getTime()).toBeLessThan(end.getTime());
    expect(dayKeyInZone("America/Havana", created)).toBe("2026-11-01");
  });

  it("gives Havana a 25-hour day on the transition", () => {
    const { start, end } = dayRangeInZone("America/Havana", new Date("2026-11-01T18:00:00Z"));
    expect(end.getTime() - start.getTime()).toBe(25 * HOUR);
  });

  it("keeps dayKeyInZone and dayRangeInZone agreeing on the boundary", () => {
    // These two are used together (range for queries, key for cache keys), so a
    // disagreement would mis-cache as well as mis-count.
    for (const [zone, iso] of [
      ["America/Havana", "2026-11-01T18:00:00Z"],
      ["Atlantic/Azores", "2026-10-25T12:00:00Z"],
      ["America/New_York", "2026-11-01T20:00:00Z"],
      ["Asia/Kolkata", "2026-08-13T02:00:00Z"],
    ] as const) {
      const at = new Date(iso);
      const { start } = dayRangeInZone(zone, at);
      expect(dayKeyInZone(zone, start)).toBe(dayKeyInZone(zone, at));
      // One millisecond earlier must belong to the previous local day.
      expect(dayKeyInZone(zone, new Date(start.getTime() - 1))).not.toBe(dayKeyInZone(zone, at));
    }
  });
});

describe("dayRangeInZone", () => {
  it("returns a 24h half-open range on a normal day", () => {
    const { start, end } = dayRangeInZone("Asia/Kolkata", new Date("2026-08-13T02:00:00Z"));
    expect(start.toISOString()).toBe("2026-08-12T18:30:00.000Z");
    expect(end.toISOString()).toBe("2026-08-13T18:30:00.000Z");
    expect(end.getTime() - start.getTime()).toBe(24 * HOUR);
  });

  it("returns a 23h day on spring-forward", () => {
    const { start, end } = dayRangeInZone("America/New_York", new Date("2026-03-08T20:00:00Z"));
    expect(end.getTime() - start.getTime()).toBe(23 * HOUR);
  });

  it("returns a 25h day on fall-back", () => {
    const { start, end } = dayRangeInZone("America/New_York", new Date("2026-11-01T20:00:00Z"));
    expect(end.getTime() - start.getTime()).toBe(25 * HOUR);
  });

  it("never lets end precede start", () => {
    for (const zone of ["UTC", "Asia/Kolkata", "America/New_York", "Pacific/Kiritimati"]) {
      const { start, end } = dayRangeInZone(zone, new Date("2026-08-13T02:00:00Z"));
      expect(end.getTime()).toBeGreaterThan(start.getTime());
    }
  });

  it("puts the sampled instant inside its own range", () => {
    // The whole point: a record created "now" must count as created "today".
    for (const zone of ["UTC", "Asia/Kolkata", "America/New_York", "Pacific/Auckland"]) {
      for (const iso of [
        "2026-08-13T00:00:00Z",
        "2026-08-13T12:00:00Z",
        "2026-08-13T23:59:59Z",
        "2026-03-08T06:30:00Z",
        "2026-11-01T05:30:00Z",
      ]) {
        const at = new Date(iso);
        const { start, end } = dayRangeInZone(zone, at);
        expect(at.getTime()).toBeGreaterThanOrEqual(start.getTime());
        expect(at.getTime()).toBeLessThan(end.getTime());
      }
    }
  });
});

describe("dayKeyInZone", () => {
  it("reports the org-local date, which can differ from the UTC date", () => {
    // 22:00 UTC on the 12th is already the 13th in Kolkata (03:30 IST).
    const at = new Date("2026-08-12T22:00:00Z");
    expect(dayKeyInZone("Asia/Kolkata", at)).toBe("2026-08-13");
    expect(dayKeyInZone("UTC", at)).toBe("2026-08-12");
  });
});

describe("helpers", () => {
  it("validates timezones", () => {
    expect(isValidTimeZone("Asia/Kolkata")).toBe(true);
    expect(isValidTimeZone("Mars/Olympus")).toBe(false);
  });

  it("resolves null/invalid timezones to UTC", () => {
    expect(resolveTimeZone(null)).toBe("UTC");
    expect(resolveTimeZone("")).toBe("UTC");
    expect(resolveTimeZone("Nope")).toBe("UTC");
    expect(resolveTimeZone("Asia/Kolkata")).toBe("Asia/Kolkata");
  });

  it("counts whole elapsed days and tolerates bad input", () => {
    const now = new Date("2026-08-13T12:00:00Z");
    expect(daysSince("2026-08-13T11:00:00Z", now)).toBe(0);
    expect(daysSince("2026-08-10T12:00:00Z", now)).toBe(3);
    expect(daysSince("not a date", now)).toBe(0);
  });

  it("returns 0 for null/undefined rather than throwing", () => {
    // A single NULL timestamp in a result set must not take out the whole list.
    const now = new Date("2026-08-13T12:00:00Z");
    expect(daysSince(null, now)).toBe(0);
    expect(daysSince(undefined, now)).toBe(0);
    expect(daysSince(new Date("nope"), now)).toBe(0);
  });
});
