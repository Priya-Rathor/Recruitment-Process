import { describe, expect, it } from "vitest";
import { FUNNEL_RAMP, barWidthPercent, rampStep } from "@/app/analytics/charts";

describe("barWidthPercent", () => {
  it("scales relative to the widest bar", () => {
    expect(barWidthPercent(50, 100)).toBe(50);
    expect(barWidthPercent(100, 100)).toBe(100);
  });

  it("never exceeds the track", () => {
    // A value above max would otherwise render a bar overflowing its container.
    expect(barWidthPercent(150, 100)).toBe(100);
  });

  it("gives zero exactly no width", () => {
    // A visible sliver for a zero would say "a little" where the answer is
    // "none" — the same lie as rendering 0% for no data.
    expect(barWidthPercent(0, 100)).toBe(0);
  });

  it("keeps a tiny but real value visible", () => {
    // 1 in 10,000 rounds to 0.01% and disappears, which reads as no data when
    // the data says otherwise.
    expect(barWidthPercent(1, 10_000)).toBe(1.5);
  });

  it("does not divide by zero", () => {
    expect(barWidthPercent(5, 0)).toBe(0);
    expect(Number.isNaN(barWidthPercent(5, 0))).toBe(false);
  });

  it("refuses a negative value rather than drawing backwards", () => {
    expect(barWidthPercent(-10, 100)).toBe(0);
  });

  it("survives non-finite input", () => {
    expect(barWidthPercent(Number.NaN, 100)).toBe(0);
    expect(barWidthPercent(5, Number.POSITIVE_INFINITY)).toBe(0);
  });
});

describe("funnel ramp", () => {
  it("has a step for every funnel stage", () => {
    expect(FUNNEL_RAMP).toHaveLength(6);
  });

  it("clamps rather than returning undefined past the end", () => {
    // A seventh stage added to the pipeline must get a colour, not `undefined`
    // — which renders as no fill at all, i.e. an invisible ring.
    expect(rampStep(0)).toBe(FUNNEL_RAMP[0]);
    expect(rampStep(5)).toBe(FUNNEL_RAMP[5]);
    expect(rampStep(9)).toBe(FUNNEL_RAMP[5]);
    expect(rampStep(99)).toBe(FUNNEL_RAMP[5]);
  });

  it("references design tokens rather than carrying its own hexes", () => {
    /*
      THE COLOUR MATHS MOVED, IT DID NOT DISAPPEAR.

      This file used to assert the ramp's monotonicity and its light-end contrast
      against the hexes declared here. Under FUTURE WORKFORCE the ramp lives in
      app/globals.scss as --ramp-0 .. --ramp-5, and app/theme.test.ts asserts the
      monotone lightness and the step gaps against those real values — closer to
      the source, and it also catches somebody editing the stylesheet without
      touching this component.

      What is worth asserting HERE is that the component did not quietly grow its
      own copy of the palette again, which is exactly how the retired ramp came
      to disagree with the retired tokens.
    */
    for (const step of FUNNEL_RAMP) {
      expect(step).toMatch(/^var\(--ramp-\d\)$/);
    }
  });
});
