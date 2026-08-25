import { describe, expect, it } from "vitest";
import {
  COST_COMPONENTS,
  formatCentsPerMinute,
  segmentPercent,
  summarizeUsage,
  type UsageEvent,
} from "@/lib/voice/costModel";
import { buildChatSystemPrompt } from "@/lib/ai/chatAsAgent";
import { defaultAgentSettings, normalizeAgentSettings } from "@/lib/voice/settings";

const event = (
  component: UsageEvent["component"],
  costCents: number,
  seconds: number
): UsageEvent => ({ component, costCents, seconds });

describe("summarizeUsage", () => {
  it("divides cost by MINUTES, not by seconds", () => {
    // 60 cents over 600 seconds = 10 minutes = 6 cents/min. Getting the unit
    // wrong here is a 60x error in a number people budget against.
    const result = summarizeUsage([event("llm", 60, 600)]);
    expect(result?.centsPerMinute).toBeCloseTo(6, 6);
    expect(result?.minutesSampled).toBeCloseTo(10, 6);
  });

  it("returns null when there is nothing to divide by", () => {
    // The caller must NOT turn this into a zero — that is the whole point.
    expect(summarizeUsage([])).toBeNull();
    expect(summarizeUsage([event("llm", 10, 0)])).toBeNull();
    expect(summarizeUsage([event("llm", 10, -5)])).toBeNull();
  });

  it("drops unusable rows rather than poisoning the average with NaN", () => {
    const result = summarizeUsage([
      event("llm", Number.NaN, 60),
      event("tts", 30, 60),
      event("stt", -5, 60),
    ]);
    expect(result?.centsPerMinute).toBeCloseTo(30, 6);
  });

  it("sums several rows for the same component into one segment", () => {
    const result = summarizeUsage([event("llm", 10, 60), event("llm", 20, 60)]);
    expect(result?.segments).toHaveLength(1);
    // 30 cents over 2 minutes.
    expect(result?.segments[0].centsPerMinute).toBeCloseTo(15, 6);
  });

  it("orders segments along the audio path, not by size", () => {
    // Colour encodes WHICH component; length encodes how much. Ordering by size
    // as well would make the two say the same thing — the analytics charts warn
    // about exactly this for bars.
    const result = summarizeUsage([
      event("tts", 40, 60),
      event("telephony", 5, 60),
      event("llm", 30, 60),
      event("stt", 10, 60),
    ]);
    expect(result?.segments.map((segment) => segment.component)).toEqual([
      ...COST_COMPONENTS,
    ]);
  });

  it("OMITS a component with no rows instead of showing it as zero", () => {
    // "We did not measure this" and "this cost nothing" are different facts.
    const result = summarizeUsage([event("llm", 10, 60)]);
    expect(result?.segments.map((segment) => segment.component)).toEqual(["llm"]);
  });

  it("reports a real zero total with no segments to draw", () => {
    // A free tier or a self-hosted model. Zero is the honest answer, and there
    // are no proportions.
    const result = summarizeUsage([event("llm", 0, 120)]);
    expect(result?.centsPerMinute).toBe(0);
    expect(result?.segments).toEqual([]);
  });

  it("has percentages that sum to about 100 for a full breakdown", () => {
    const result = summarizeUsage([
      event("telephony", 25, 60),
      event("stt", 25, 60),
      event("llm", 25, 60),
      event("tts", 25, 60),
    ]);
    const total = (result?.segments ?? []).reduce((sum, s) => sum + s.percent, 0);
    expect(total).toBeCloseTo(100, 5);
  });
});

describe("segmentPercent", () => {
  it("keeps a real-but-tiny component visible instead of vanishing", () => {
    // 0.05% would round to a zero-width segment and read as "not measured".
    expect(segmentPercent(1, 2000)).toBeGreaterThanOrEqual(1.5);
  });

  it("gives a genuine zero no width at all", () => {
    expect(segmentPercent(0, 100)).toBe(0);
  });

  it("never divides by zero or exceeds the bar", () => {
    expect(segmentPercent(10, 0)).toBe(0);
    expect(segmentPercent(10, Number.NaN)).toBe(0);
    expect(segmentPercent(500, 100)).toBe(100);
  });
});

describe("formatCentsPerMinute", () => {
  it("shows three decimals below a dollar, so models are distinguishable", () => {
    // Two decimals would render 9.8c and 10.4c both as "$0.10".
    expect(formatCentsPerMinute(9.8)).toBe("$0.098");
    expect(formatCentsPerMinute(10.4)).toBe("$0.104");
  });

  it("switches to two decimals at a dollar and above", () => {
    expect(formatCentsPerMinute(250)).toBe("$2.50");
  });

  it("formats a real zero as a zero", () => {
    expect(formatCentsPerMinute(0)).toBe("$0.000");
  });
});

// -----------------------------------------------------------------------------
// The chat rehearsal must test the SAME configuration a call would use.
// -----------------------------------------------------------------------------
describe("buildChatSystemPrompt", () => {
  it("puts the guardrails last, where a model weights them most", () => {
    const settings = normalizeAgentSettings({
      brain: {
        persona: "A recruitment coordinator.",
        systemPrompt: "Ask the questions in order.",
        guardrails: ["Never state a hiring decision."],
      },
    });

    const prompt = buildChatSystemPrompt(settings);
    expect(prompt.indexOf("Never state a hiring decision.")).toBeGreaterThan(
      prompt.indexOf("Ask the questions in order.")
    );
  });

  it("carries the persona, tone and instructions the call would use", () => {
    const settings = normalizeAgentSettings(
      {
        brain: { persona: "Calm and unhurried.", tone: "formal", systemPrompt: "One question at a time." },
      },
      { companyName: "Webbee Global" }
    );

    const prompt = buildChatSystemPrompt(settings);
    expect(prompt).toContain("Calm and unhurried.");
    expect(prompt).toContain("formal");
    expect(prompt).toContain("One question at a time.");
    expect(prompt).toContain("Webbee Global");
  });

  it("does NOT replay the consent disclosure", () => {
    /*
      Nobody is being recorded in a text sandbox. Replaying the disclosure here
      would train operators to read past the one line that is a legal obligation
      on a real call — where buildCallScript() still emits it and no setting can
      switch it off.
    */
    const prompt = buildChatSystemPrompt(defaultAgentSettings()).toLowerCase();
    expect(prompt).not.toContain("may be recorded");
  });

  it("names itself a rehearsal, so the agent does not treat it as a live call", () => {
    expect(buildChatSystemPrompt(defaultAgentSettings())).toContain("TEXT REHEARSAL");
  });
});
