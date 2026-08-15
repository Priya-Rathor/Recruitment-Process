// =============================================================================
// The "don't silently overwrite" half of the feature.
//
// Bulk intake never applies a parsed field to an existing candidate. It writes
// the proposal to resume_parse_results with reviewed_at null and moves on. What
// makes that safe is Module 6's existing comparison + decision pair, so these
// tests exercise THOSE against intake's scenarios rather than re-testing intake
// plumbing: if applyReviewDecisions ever started writing a field nobody chose,
// bulk intake would be the loudest way to lose data in the product.
// =============================================================================
import { describe, expect, it } from "vitest";
import { applyReviewDecisions, buildFieldComparisons } from "@/lib/resumes/review";
import { pendingReviewSummary, type PendingReview } from "@/lib/resumes/pending";
import type { ParsedResume } from "@/lib/ai/parseResume";
import type { Candidate } from "@/lib/types";

const EXISTING = {
  id: "11111111-1111-1111-1111-111111111111",
  organization_id: "org",
  name: "Ananya Sharma",
  email: "ananya@example.com",
  phone: "+91 98765 43210",
  location: "Gurgaon",
  current_company: "Infosys",
  current_role: "Senior Java Developer",
  total_experience_years: 6,
  expected_salary: 1_800_000,
  notice_period_days: 30,
  skills: ["Java", "Spring"],
  education: [],
  employment_history: [],
  source: "manual",
  archived_at: null,
} as unknown as Candidate;

function parsed(overrides: Partial<ParsedResume> = {}): ParsedResume {
  return {
    name: "Ananya Sharma",
    email: "ananya@example.com",
    phone: "+91 98765 43210",
    location: "Gurgaon",
    currentCompany: "Infosys",
    currentRole: "Senior Java Developer",
    totalExperienceYears: 6,
    skills: ["Java", "Spring"],
    experience: [],
    education: [],
    certifications: [],
    expectedSalary: 1_800_000,
    noticePeriodDays: 30,
    confidence: 0.9,
    ...overrides,
  };
}

describe("a second resume for an existing candidate", () => {
  // The spec's test: "different resume for an existing candidate with a changed
  // expected salary → conflict entry created, application still created".
  it("raises exactly one conflict for a changed expected salary", () => {
    const comparisons = buildFieldComparisons(EXISTING, parsed({ expectedSalary: 2_000_000 }));
    const conflicts = comparisons.filter((c) => c.status === "conflict");

    expect(conflicts).toHaveLength(1);
    expect(conflicts[0].field).toBe("expected_salary");
    expect(conflicts[0].existing).toBe("1800000");
    expect(conflicts[0].proposed).toBe("2000000");
  });

  it("does not touch the candidate until a decision is made", () => {
    const proposal = parsed({ expectedSalary: 2_000_000 });

    // No decisions — the default outcome of the whole bulk flow, where nobody
    // has opened the review screen yet.
    const untouched = applyReviewDecisions({
      candidate: EXISTING,
      parsed: proposal,
      decisions: {},
    });
    expect(untouched.updates).toEqual({});
    expect(untouched.appliedFields).toEqual([]);

    // Explicitly keeping is also not a write.
    const kept = applyReviewDecisions({
      candidate: EXISTING,
      parsed: proposal,
      decisions: { expected_salary: "keep" },
    });
    expect(kept.updates).toEqual({});

    // Only an explicit accept writes.
    const accepted = applyReviewDecisions({
      candidate: EXISTING,
      parsed: proposal,
      decisions: { expected_salary: "accept" },
    });
    expect(accepted.updates).toEqual({ expected_salary: 2_000_000 });
  });

  it("raises no conflict when the resume merely repeats the profile", () => {
    const comparisons = buildFieldComparisons(EXISTING, parsed());
    expect(comparisons.filter((c) => c.status === "conflict")).toHaveLength(0);
  });

  it("treats a field the profile leaves blank as new, not as a conflict", () => {
    const blank = { ...EXISTING, expected_salary: null } as Candidate;
    const comparisons = buildFieldComparisons(blank, parsed({ expectedSalary: 2_000_000 }));
    const salary = comparisons.find((c) => c.field === "expected_salary");

    expect(salary?.status).toBe("new");
    expect(comparisons.filter((c) => c.status === "conflict")).toHaveLength(0);
  });

  it("counts several changed fields independently", () => {
    const comparisons = buildFieldComparisons(
      EXISTING,
      parsed({
        expectedSalary: 2_400_000,
        noticePeriodDays: 60,
        currentCompany: "Zoho",
        location: "Chennai",
      })
    );

    expect(comparisons.filter((c) => c.status === "conflict").map((c) => c.field).sort()).toEqual([
      "current_company",
      "expected_salary",
      "location",
      "notice_period_days",
    ]);
  });

  it("does not parade a casing difference as a conflict", () => {
    const comparisons = buildFieldComparisons(EXISTING, parsed({ location: "  gurgaon " }));
    expect(comparisons.filter((c) => c.status === "conflict")).toHaveLength(0);
  });
});

describe("pendingReviewSummary", () => {
  function review(overrides: Partial<PendingReview> = {}): PendingReview {
    return {
      resumeId: "r1",
      fileName: "ananya.pdf",
      uploadedAt: "2026-08-15T00:00:00.000Z",
      conflictCount: 0,
      newFieldCount: 0,
      ...overrides,
    };
  }

  it("says how many decisions are waiting", () => {
    expect(pendingReviewSummary([review({ conflictCount: 3 })])).toBe(
      "3 profile updates need your review from a recent resume."
    );
  });

  it("uses the singular for one", () => {
    expect(pendingReviewSummary([review({ conflictCount: 1 })])).toBe(
      "1 profile update needs your review from a recent resume."
    );
  });

  it("reports conflicts and new details separately", () => {
    // They ask different things of the reader: one is a judgement call, the
    // other is a freebie. One combined number would hide which is which.
    const line = pendingReviewSummary([review({ conflictCount: 2, newFieldCount: 3 })]);
    expect(line).toContain("2 profile updates need your review");
    expect(line).toContain("3 new details to add");
  });

  it("says nothing when there is nothing to decide", () => {
    expect(pendingReviewSummary([])).toBeNull();
    expect(pendingReviewSummary([review()])).toBeNull();
  });

  it("aggregates across several unreviewed resumes", () => {
    const line = pendingReviewSummary([
      review({ resumeId: "r1", conflictCount: 2 }),
      review({ resumeId: "r2", conflictCount: 1 }),
    ]);
    expect(line).toBe("3 profile updates need your review from 2 recent resumes.");
  });
});
