import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  allowedSummaryNumbers,
  findUnsupportedSummaryNumbers,
  generateApplicationSummary,
  type ApplicationSummaryInput,
} from "./generateApplicationSummary";

const input: ApplicationSummaryInput = {
  candidateName: "Rahul Sharma",
  jobTitle: "Senior Java Developer",
  stage: "director_round",
  matchScore: 89,
  daysInCurrentStage: 2,
  ageDays: 11,
  assignedRecruiterName: "Priya",
  noteCount: 3,
  latestNote: "Client asked for a second opinion.",
};

describe("allowedSummaryNumbers", () => {
  it("permits exactly the supplied figures plus 0", () => {
    expect([...allowedSummaryNumbers(input)].sort((a, b) => a - b)).toEqual([0, 2, 3, 11, 89]);
  });

  it("permits the rounded form of a decimal match score", () => {
    // A score stored as 88.50 is legitimately written "89" (or "88.5").
    const allowed = allowedSummaryNumbers({ ...input, matchScore: 88.5 });
    expect(allowed.has(88.5)).toBe(true);
    expect(allowed.has(89)).toBe(true);
  });

  it("omits a match score that has not been calculated", () => {
    const allowed = allowedSummaryNumbers({ ...input, matchScore: null });
    expect(allowed.has(89)).toBe(false);
  });
});

describe("findUnsupportedSummaryNumbers — the anti-contradiction guard", () => {
  const allowed = allowedSummaryNumbers(input);

  it("accepts a summary citing only supplied figures", () => {
    const text =
      "Rahul Sharma is in Client Review for the Senior Java Developer role with an 89% match. He has been in this stage for 2 days, 11 days after applying.";
    expect(findUnsupportedSummaryNumbers(text, allowed)).toEqual([]);
  });

  it("REJECTS an invented match score", () => {
    // The headline contradiction: fields say 89%, the paragraph says 92%.
    expect(findUnsupportedSummaryNumbers("Match was 92%.", allowed)).toEqual(["92%"]);
  });

  it("REJECTS a number the model derived by arithmetic", () => {
    expect(findUnsupportedSummaryNumbers("That is 9 days longer than usual.", allowed)).toEqual([
      "9",
    ]);
  });

  it("REJECTS spelled-out numbers outright", () => {
    // A digit-only check would let "eighty-nine percent" past unchecked; the
    // prompt requires digits precisely so this guard can work.
    expect(findUnsupportedSummaryNumbers("Client feedback pending for two days.", allowed)).toEqual([
      "two",
    ]);
    expect(findUnsupportedSummaryNumbers("Match was eighty-nine percent.", allowed)).toContain(
      "eighty"
    );
  });

  it("does NOT split a thousands separator into two false offenders", () => {
    // "1,234" must not be read as 1 and 234 — that false positive would break
    // the feature permanently for any large figure.
    const withSalary = allowedSummaryNumbers({ ...input, ageDays: 1234 });
    expect(findUnsupportedSummaryNumbers("Applied 1,234 days ago.", withSalary)).toEqual([]);
  });

  it("accepts 0 as a real figure", () => {
    expect(findUnsupportedSummaryNumbers("0 notes have been added.", allowed)).toEqual([]);
  });

  it("reports every offender, not just the first", () => {
    expect(findUnsupportedSummaryNumbers("Scores of 92 and 95.", allowed)).toEqual(["92", "95"]);
  });

  it("accepts a summary with no numbers at all", () => {
    expect(
      findUnsupportedSummaryNumbers("Rahul Sharma is awaiting client feedback.", allowed)
    ).toEqual([]);
  });

  it("rejects a figure about a fact that was never supplied", () => {
    // matchScore is null here, so ANY percentage is a fabrication.
    const noScore = allowedSummaryNumbers({ ...input, matchScore: null });
    expect(findUnsupportedSummaryNumbers("Resume match was 89%.", noScore)).toEqual(["89%"]);
  });
});

describe("generateApplicationSummary", () => {
  const savedKey = process.env.OPENAI_API_KEY;
  beforeEach(() => {
    delete process.env.OPENAI_API_KEY;
  });
  afterEach(() => {
    if (savedKey === undefined) delete process.env.OPENAI_API_KEY;
    else process.env.OPENAI_API_KEY = savedKey;
  });

  it("degrades to not_configured rather than throwing", async () => {
    const result = await generateApplicationSummary(input);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("not_configured");
  });
});
