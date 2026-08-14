import { describe, expect, it } from "vitest";
import {
  applyReviewDecisions,
  buildFieldComparisons,
  countConflicts,
  parseReviewDecisions,
  REVIEWABLE_FIELDS,
} from "./review";
import type { ParsedResume } from "@/lib/ai/parseResume";
import type { Candidate } from "@/lib/types";

const candidate: Candidate = {
  id: "c1",
  organization_id: "o1",
  name: "R. Sharma",
  email: "rahul@example.com",
  phone: null,
  email_normalized: "rahul@example.com",
  phone_normalized: null,
  location: "Gurgaon",
  current_company: "Infosys",
  current_role: null,
  total_experience_years: 5,
  skills: ["Java"],
  expected_salary: 1_800_000,
  notice_period_days: null,
  source: "manual",
  resume_url: null,
  archived_at: null,
  created_at: "2026-08-01T00:00:00Z",
  updated_at: "2026-08-01T00:00:00Z",
};

const emptyParsed: ParsedResume = {
  name: null,
  email: null,
  phone: null,
  location: null,
  currentCompany: null,
  currentRole: null,
  totalExperienceYears: null,
  skills: [],
  experience: [],
  education: [],
  certifications: [],
  expectedSalary: null,
  noticePeriodDays: null,
  confidence: null,
};

const parsed: ParsedResume = {
  ...emptyParsed,
  name: "Rahul Sharma",
  email: "rahul@example.com",
  phone: "9876543210",
  location: "gurgaon",
  currentCompany: "Infosys",
  currentRole: "Software Engineer",
  totalExperienceYears: 5.5,
  skills: ["Java", "Spring Boot"],
  // The spec's own example: resume says 20 LPA, profile says 18 LPA.
  expectedSalary: 2_000_000,
  confidence: 0.9,
};

describe("buildFieldComparisons", () => {
  const comparisons = buildFieldComparisons(candidate, parsed);
  const byField = Object.fromEntries(comparisons.map((c) => [c.field, c]));

  it("covers every reviewable field, including ones with nothing to decide", () => {
    expect(comparisons).toHaveLength(REVIEWABLE_FIELDS.length);
  });

  it("marks a differing value as a conflict", () => {
    expect(byField.expected_salary.status).toBe("conflict");
    expect(byField.expected_salary.existing).toBe("1800000");
    expect(byField.expected_salary.proposed).toBe("2000000");
  });

  it("marks a blank profile field with a resume value as new", () => {
    expect(byField.current_role.status).toBe("new");
    expect(byField.current_role.existing).toBeNull();
    expect(byField.current_role.proposed).toBe("Software Engineer");
  });

  it("marks a matching value as same", () => {
    expect(byField.email.status).toBe("same");
  });

  it("does NOT parade a case difference as a conflict", () => {
    // "gurgaon" vs "Gurgaon" is not a decision worth a recruiter's attention.
    expect(byField.location.status).toBe("same");
  });

  it("marks a field the resume never mentioned as missing", () => {
    expect(byField.notice_period_days.status).toBe("missing");
    expect(byField.notice_period_days.proposed).toBeNull();
  });

  it("treats a changed number as a conflict", () => {
    expect(byField.total_experience_years.status).toBe("conflict");
    expect(byField.total_experience_years.existing).toBe("5");
    expect(byField.total_experience_years.proposed).toBe("5.5");
  });

  it("renders skills as a readable list", () => {
    expect(byField.skills.existing).toBe("Java");
    expect(byField.skills.proposed).toBe("Java, Spring Boot");
    expect(byField.skills.status).toBe("conflict");
  });

  it("counts only genuine conflicts", () => {
    expect(countConflicts(comparisons)).toBe(4);
  });
});

describe("applyReviewDecisions — 'the recruiter's chosen value always wins'", () => {
  it("writes NOTHING when there are no decisions", () => {
    // The default outcome of doing nothing must be that nothing changes.
    const result = applyReviewDecisions({ candidate, parsed, decisions: {} });
    expect(result.updates).toEqual({});
    expect(result.appliedFields).toEqual([]);
  });

  it("writes only the fields explicitly accepted", () => {
    const result = applyReviewDecisions({
      candidate,
      parsed,
      decisions: { current_role: "accept", phone: "accept" },
    });
    expect(result.updates).toEqual({
      current_role: "Software Engineer",
      phone: "9876543210",
    });
    expect(result.appliedFields).toEqual(["phone", "current_role"]);
  });

  it("KEEPS the existing value when the recruiter chooses keep", () => {
    // The headline safety property: 18 LPA stays 18 LPA.
    const result = applyReviewDecisions({
      candidate,
      parsed,
      decisions: { expected_salary: "keep" },
    });
    expect(result.updates).not.toHaveProperty("expected_salary");
    expect(result.appliedFields).toEqual([]);
  });

  it("overwrites only when the recruiter says accept", () => {
    const result = applyReviewDecisions({
      candidate,
      parsed,
      decisions: { expected_salary: "accept" },
    });
    expect(result.updates.expected_salary).toBe(2_000_000);
  });

  it("ignores an accept for a field the resume never proposed", () => {
    // Otherwise a stray decision could blank a stored value with null.
    const result = applyReviewDecisions({
      candidate,
      parsed,
      decisions: { notice_period_days: "accept" },
    });
    expect(result.updates).toEqual({});
  });

  it("ignores an accept whose proposal is an empty list", () => {
    const result = applyReviewDecisions({
      candidate,
      parsed: { ...parsed, skills: [] },
      decisions: { skills: "accept" },
    });
    expect(result.updates).toEqual({});
  });

  it("skips a write that would change nothing", () => {
    const result = applyReviewDecisions({
      candidate,
      parsed,
      decisions: { email: "accept", location: "accept" },
    });
    // Email matches exactly; location differs only by case.
    expect(result.updates).toEqual({});
    expect(result.appliedFields).toEqual([]);
  });

  it("accepts 0 as a real proposed value", () => {
    // An immediate joiner's notice period is 0, not "nothing proposed".
    const result = applyReviewDecisions({
      candidate,
      parsed: { ...parsed, noticePeriodDays: 0 },
      decisions: { notice_period_days: "accept" },
    });
    expect(result.updates.notice_period_days).toBe(0);
  });

  it("never returns a key outside the reviewable set", () => {
    const result = applyReviewDecisions({
      candidate,
      parsed,
      decisions: { name: "accept", current_role: "accept" },
    });
    for (const key of Object.keys(result.updates)) {
      expect(REVIEWABLE_FIELDS).toContain(key);
    }
  });

  it("does not mutate the candidate", () => {
    applyReviewDecisions({ candidate, parsed, decisions: { name: "accept" } });
    expect(candidate.name).toBe("R. Sharma");
  });
});

describe("parseReviewDecisions", () => {
  it("keeps only recognised fields and decisions", () => {
    expect(
      parseReviewDecisions({
        name: "accept",
        email: "keep",
        organization_id: "accept",
        archived_at: "accept",
        phone: "maybe",
      })
    ).toEqual({ name: "accept", email: "keep" });
  });

  it("returns nothing for a malformed body", () => {
    expect(parseReviewDecisions(null)).toEqual({});
    expect(parseReviewDecisions("accept everything")).toEqual({});
    expect(parseReviewDecisions(42)).toEqual({});
  });

  it("cannot be used to smuggle an arbitrary column update", () => {
    // The decisions payload names FIELDS, never values — there is no path from
    // request body to an attacker-chosen value.
    const decisions = parseReviewDecisions({ id: "accept", "'; drop table": "accept" });
    expect(decisions).toEqual({});
  });
});
