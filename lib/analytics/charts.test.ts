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
    // A seventh stage would otherwise paint `undefined` as a background colour,
    // silently rendering a transparent bar.
    expect(rampStep(99)).toBe(FUNNEL_RAMP[FUNNEL_RAMP.length - 1]);
    expect(rampStep(0)).toBe(FUNNEL_RAMP[0]);
  });

  it("is monotonically DARKER down the funnel, so the ramp reads in order", () => {
    // The validated property, asserted here so an edit that breaks the ordinal
    // ramp fails a test rather than only looking slightly wrong.
    const luminance = (hex: string) => {
      const value = hex.replace("#", "");
      const channel = (offset: number) => {
        const srgb = parseInt(value.slice(offset, offset + 2), 16) / 255;
        return srgb <= 0.03928 ? srgb / 12.92 : ((srgb + 0.055) / 1.055) ** 2.4;
      };
      return 0.2126 * channel(0) + 0.7152 * channel(2) + 0.0722 * channel(4);
    };

    for (let i = 1; i < FUNNEL_RAMP.length; i++) {
      expect(
        luminance(FUNNEL_RAMP[i]),
        `${FUNNEL_RAMP[i]} is not darker than ${FUNNEL_RAMP[i - 1]}`
      ).toBeLessThan(luminance(FUNNEL_RAMP[i - 1]));
    }
  });

  it("keeps the lightest step visible against a white card", () => {
    // The check the obvious Tailwind ramp fails: #C7D2FE sits at 1.49:1 on
    // white and effectively disappears.
    const relativeLuminance = (hex: string) => {
      const value = hex.replace("#", "");
      const channel = (offset: number) => {
        const srgb = parseInt(value.slice(offset, offset + 2), 16) / 255;
        return srgb <= 0.03928 ? srgb / 12.92 : ((srgb + 0.055) / 1.055) ** 2.4;
      };
      return 0.2126 * channel(0) + 0.7152 * channel(2) + 0.0722 * channel(4);
    };

    const lightest = FUNNEL_RAMP[0];
    const contrast = (1.0 + 0.05) / (relativeLuminance(lightest) + 0.05);

    expect(contrast).toBeGreaterThanOrEqual(2);
  });
});
