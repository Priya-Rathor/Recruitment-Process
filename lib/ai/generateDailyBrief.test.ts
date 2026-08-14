import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  allowedNumbers,
  findUnsupportedNumbers,
  generateDailyBrief,
  type DailyBriefInput,
} from "./generateDailyBrief";

const input: DailyBriefInput = {
  counts: { newCandidates: 42, screeningsCompleted: 18, interviewsToday: 8 },
  attentionCount: 5,
  overdueDays: 3,
  scope: "organization",
};

describe("allowedNumbers", () => {
  it("permits exactly the supplied figures, the threshold, the queue size and 0", () => {
    expect([...allowedNumbers(input)].sort((a, b) => a - b)).toEqual([0, 3, 5, 8, 18, 42]);
  });
});

describe("findUnsupportedNumbers — the guard behind 'never contradicts the tiles'", () => {
  const allowed = allowedNumbers(input);

  it("accepts a brief that only cites supplied figures", () => {
    const text = "You received 42 candidates. 18 completed AI screening and 8 interviews are set.";
    expect(findUnsupportedNumbers(text, allowed)).toEqual([]);
  });

  it("accepts the overdue threshold, since it is part of the input", () => {
    expect(findUnsupportedNumbers("5 items have waited more than 3 days.", allowed)).toEqual([]);
  });

  it("accepts 0 for a figure that did not occur", () => {
    expect(findUnsupportedNumbers("0 screening calls failed.", allowed)).toEqual([]);
  });

  it("REJECTS an invented figure", () => {
    // 37 was never supplied — the hallucination case that must not ship.
    expect(findUnsupportedNumbers("You received 37 candidates.", allowed)).toEqual(["37"]);
  });

  it("REJECTS a number the model derived by doing arithmetic", () => {
    // 42 + 18 = 60. Plausible, unsupplied, and wrong beside the tiles.
    expect(findUnsupportedNumbers("That is 60 records in total.", allowed)).toEqual(["60"]);
  });

  it("REJECTS a percentage it computed itself", () => {
    expect(findUnsupportedNumbers("Screening conversion was 43%.", allowed)).toEqual(["43%"]);
  });

  it("REJECTS a percentage even when the digits happen to be allowed", () => {
    // 42 is a real candidate count, but "42%" is a ratio the model computed —
    // the value being in the allowed set is a coincidence, not permission.
    expect(findUnsupportedNumbers("Screening conversion was 42%.", allowed)).toEqual(["42%"]);
  });

  it("REJECTS spelled-out numbers, which bypass a digit-only check", () => {
    // The spec's own example brief spells figures out ("Five strong-match
    // candidates"), and those figures were never computed.
    expect(
      findUnsupportedNumbers("Five strong-match candidates await review.", allowed)
    ).toEqual(["five"]);
    expect(findUnsupportedNumbers("Three screening calls failed.", allowed)).toEqual(["three"]);
  });

  it("REJECTS a non-integer even when the digits look familiar", () => {
    expect(findUnsupportedNumbers("Average was 4.2 per recruiter.", allowed)).toEqual(["4.2"]);
  });

  it("does NOT split a thousands separator into false offenders", () => {
    // "1,234" read as 1 and 234 would permanently break the brief for any
    // organization with a four-digit metric.
    const large = allowedNumbers({ ...input, counts: { newCandidates: 1234 } });
    expect(findUnsupportedNumbers("You received 1,234 candidates.", large)).toEqual([]);
  });

  it("catches every offender, not just the first", () => {
    expect(findUnsupportedNumbers("We saw 37 and 60 and 42.", allowed)).toEqual(["37", "60"]);
  });

  it("ignores text with no numbers at all", () => {
    expect(findUnsupportedNumbers("Several candidates are awaiting review.", allowed)).toEqual([]);
  });
});

describe("generateDailyBrief", () => {
  // Pinned explicitly so these never depend on the developer's shell, and never
  // make a real network call if a key happens to be exported.
  const savedKey = process.env.OPENAI_API_KEY;
  beforeEach(() => {
    delete process.env.OPENAI_API_KEY;
  });
  afterEach(() => {
    if (savedKey === undefined) delete process.env.OPENAI_API_KEY;
    else process.env.OPENAI_API_KEY = savedKey;
  });

  it("returns a real 'quiet day' brief without calling the provider", async () => {
    // Would fail with not_configured if it reached the provider — proving this
    // path short-circuits before spending a token.
    const result = await generateDailyBrief({
      counts: { newCandidates: 0, screeningsCompleted: 0 },
      attentionCount: 0,
      overdueDays: 3,
      scope: "organization",
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.summary).toContain("No activity recorded yet today");
      expect(result.data.focus).toEqual([]);
    }
  });

  it("uses second-person wording for a recruiter's own scope", async () => {
    const result = await generateDailyBrief({
      counts: {},
      attentionCount: 0,
      overdueDays: 3,
      scope: "own",
    });

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.data.summary).toContain("Nothing needs your attention");
  });

  it("degrades to not_configured (never throws) when there is activity but no API key", async () => {
    const result = await generateDailyBrief(input);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe("not_configured");
      // The message must be something a recruiter can act on.
      expect(result.message).toMatch(/not configured/i);
    }
  });
});
