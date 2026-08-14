import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { parseCandidateSearch, validateSearchFilters } from "./parseCandidateSearch";
import { describeFilters, isEmptyFilters } from "@/lib/candidates/filters";

describe("validateSearchFilters", () => {
  it("accepts a well-formed filter object", () => {
    const filters = validateSearchFilters({
      text: null,
      skills: ["Java", "Spring Boot"],
      location: "Gurgaon",
      experienceMin: 4,
      experienceMax: 7,
      noticePeriodMaxDays: 45,
      expectedSalaryMax: 2_000_000,
      source: null,
    });

    expect(filters).toEqual({
      text: null,
      skills: ["Java", "Spring Boot"],
      location: "Gurgaon",
      experienceMin: 4,
      experienceMax: 7,
      noticePeriodMaxDays: 45,
      expectedSalaryMax: 2_000_000,
      source: null,
    });
  });

  it("REJECTS output with no usable constraint", () => {
    // Critical: an unfiltered search would return every candidate in the
    // organization and look like a successful, meaningful result.
    expect(validateSearchFilters({})).toBeNull();
    expect(
      validateSearchFilters({ text: "", skills: [], location: null, experienceMin: null })
    ).toBeNull();
    expect(validateSearchFilters(null)).toBeNull();
    expect(validateSearchFilters("not an object")).toBeNull();
  });

  it("swaps a transposed experience range rather than returning an empty set", () => {
    const filters = validateSearchFilters({ experienceMin: 7, experienceMax: 4 });
    expect(filters?.experienceMin).toBe(4);
    expect(filters?.experienceMax).toBe(7);
  });

  it("drops out-of-range and non-numeric values", () => {
    expect(validateSearchFilters({ experienceMin: -3, skills: ["Java"] })?.experienceMin).toBeNull();
    expect(validateSearchFilters({ experienceMax: 900, skills: ["Java"] })?.experienceMax).toBeNull();
    expect(
      validateSearchFilters({ noticePeriodMaxDays: 5000, skills: ["Java"] })?.noticePeriodMaxDays
    ).toBeNull();
    expect(validateSearchFilters({ experienceMin: "soon", skills: ["Java"] })?.experienceMin).toBeNull();
  });

  it("accepts 0 for immediate joiners", () => {
    // 0 is a real constraint, not a missing one — a falsy-check bug here would
    // silently drop "immediate joiners only".
    expect(validateSearchFilters({ noticePeriodMaxDays: 0 })?.noticePeriodMaxDays).toBe(0);
  });

  it("accepts only known intake sources", () => {
    expect(validateSearchFilters({ source: "referral" })?.source).toBe("referral");
    expect(validateSearchFilters({ source: "Agency Database" })?.source).toBe("agency_database");
    expect(validateSearchFilters({ source: "linkedin", skills: ["Java"] })?.source).toBeNull();
  });

  it("de-duplicates skills case-insensitively", () => {
    expect(validateSearchFilters({ skills: ["AWS", "aws", "Aws", "Java"] })?.skills).toEqual([
      "AWS",
      "Java",
    ]);
  });

  it("ignores non-string skill entries", () => {
    expect(validateSearchFilters({ skills: ["Java", 42, null, "  "] })?.skills).toEqual(["Java"]);
  });

  it("caps a runaway skills list", () => {
    const many = Array.from({ length: 50 }, (_, i) => `skill-${i}`);
    expect(validateSearchFilters({ skills: many })?.skills).toHaveLength(20);
  });

  it("never produces filters that would match everything", () => {
    // Belt and braces: whatever it returns must narrow something.
    const filters = validateSearchFilters({ skills: ["Java"] });
    expect(filters).not.toBeNull();
    expect(isEmptyFilters(filters!)).toBe(false);
  });
});

describe("the spec's example query, once translated", () => {
  // "Show me Java candidates in Gurgaon with 4-7 years experience and
  //  less than 45 days notice"
  const translated = validateSearchFilters({
    skills: ["Java"],
    location: "Gurgaon",
    experienceMin: 4,
    experienceMax: 7,
    noticePeriodMaxDays: 45,
  })!;

  it("produces exactly the filters a recruiter would set by hand", () => {
    expect(translated).toEqual({
      text: null,
      skills: ["Java"],
      location: "Gurgaon",
      experienceMin: 4,
      experienceMax: 7,
      noticePeriodMaxDays: 45,
      expectedSalaryMax: null,
      source: null,
    });
  });

  it("is explainable back to the recruiter", () => {
    expect(describeFilters(translated)).toEqual([
      "with Java",
      "in Gurgaon",
      "4-7 years experience",
      "notice period 45 days or less",
    ]);
  });
});

describe("parseCandidateSearch", () => {
  const savedKey = process.env.OPENAI_API_KEY;
  beforeEach(() => {
    delete process.env.OPENAI_API_KEY;
  });
  afterEach(() => {
    if (savedKey === undefined) delete process.env.OPENAI_API_KEY;
    else process.env.OPENAI_API_KEY = savedKey;
  });

  it("rejects a too-short query before spending a token", async () => {
    const result = await parseCandidateSearch("hi");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("invalid_output");
  });

  it("degrades to not_configured rather than throwing", async () => {
    const result = await parseCandidateSearch("Java developers in Gurgaon");
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe("not_configured");
      // The recruiter must be told they can still use the manual filters.
      expect(result.message).toMatch(/not configured/i);
    }
  });
});
