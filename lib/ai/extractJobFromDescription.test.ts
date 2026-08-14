import { describe, expect, it } from "vitest";
import { mergeProposal, type JobProposal } from "./extractJobFromDescription";
import type { WorkMode } from "@/lib/types";

const emptyProposal: JobProposal = {
  title: null,
  experienceMin: null,
  experienceMax: null,
  requiredSkills: [],
  preferredSkills: [],
  location: null,
  workMode: null,
  salaryMin: null,
  salaryMax: null,
  screeningQuestions: [],
  interviewQuestions: [],
};

type Form = {
  title: string | null;
  experienceMin: number | null;
  experienceMax: number | null;
  location: string | null;
  workMode: WorkMode | null;
  salaryMin: number | null;
  salaryMax: number | null;
};

const blankForm: Form = {
  title: null,
  experienceMin: null,
  experienceMax: null,
  location: null,
  workMode: null,
  salaryMin: null,
  salaryMax: null,
};

describe("mergeProposal — 'AI proposes, it never silently overwrites'", () => {
  it("fills fields the recruiter left blank", () => {
    const { merged, conflicts } = mergeProposal(blankForm, {
      ...emptyProposal,
      title: "Senior Java Developer",
      location: "Gurgaon",
      workMode: "hybrid",
      experienceMin: 5,
    });

    expect(merged.title).toBe("Senior Java Developer");
    expect(merged.location).toBe("Gurgaon");
    expect(merged.workMode).toBe("hybrid");
    expect(merged.experienceMin).toBe(5);
    expect(conflicts).toEqual([]);
  });

  it("KEEPS the recruiter's value and reports a conflict when they differ", () => {
    const typed: Form = { ...blankForm, title: "Backend Engineer II" };
    const { merged, conflicts } = mergeProposal(typed, {
      ...emptyProposal,
      title: "Senior Java Developer",
    });

    // The recruiter's text survives — this is the whole point of the rule.
    expect(merged.title).toBe("Backend Engineer II");
    expect(conflicts).toEqual([
      { field: "Title", existing: "Backend Engineer II", proposed: "Senior Java Developer" },
    ]);
  });

  it("reports no conflict when the values agree", () => {
    const typed: Form = { ...blankForm, location: "Gurgaon" };
    const { merged, conflicts } = mergeProposal(typed, { ...emptyProposal, location: "Gurgaon" });
    expect(merged.location).toBe("Gurgaon");
    expect(conflicts).toEqual([]);
  });

  it("treats a whitespace-only value as blank and fills it", () => {
    const typed: Form = { ...blankForm, title: "   " };
    const { merged, conflicts } = mergeProposal(typed, { ...emptyProposal, title: "QA Engineer" });
    expect(merged.title).toBe("QA Engineer");
    expect(conflicts).toEqual([]);
  });

  it("does not clear a recruiter value when the proposal has null for it", () => {
    const typed: Form = { ...blankForm, title: "Data Engineer", salaryMin: 1_200_000 };
    const { merged, conflicts } = mergeProposal(typed, emptyProposal);
    expect(merged.title).toBe("Data Engineer");
    expect(merged.salaryMin).toBe(1_200_000);
    expect(conflicts).toEqual([]);
  });

  it("treats 0 as a real recruiter value, not a blank", () => {
    // A genuine "0 years minimum" must not be silently overwritten by "2".
    const typed: Form = { ...blankForm, experienceMin: 0 };
    const { merged, conflicts } = mergeProposal(typed, { ...emptyProposal, experienceMin: 2 });
    expect(merged.experienceMin).toBe(0);
    expect(conflicts).toEqual([
      { field: "Minimum experience", existing: "0", proposed: "2" },
    ]);
  });

  it("collects conflicts across several fields at once", () => {
    const typed: Form = {
      title: "Backend Engineer",
      experienceMin: 3,
      experienceMax: 6,
      location: "Noida",
      workMode: "remote",
      salaryMin: null,
      salaryMax: null,
    };
    const { merged, conflicts } = mergeProposal(typed, {
      ...emptyProposal,
      title: "Senior Java Developer",
      experienceMin: 5,
      experienceMax: 6,
      location: "Gurgaon",
      workMode: "hybrid",
      salaryMin: 1_500_000,
    });

    // Every typed value preserved.
    expect(merged.title).toBe("Backend Engineer");
    expect(merged.experienceMin).toBe(3);
    expect(merged.location).toBe("Noida");
    expect(merged.workMode).toBe("remote");
    // Blank field filled.
    expect(merged.salaryMin).toBe(1_500_000);

    expect(conflicts.map((c) => c.field)).toEqual([
      "Title",
      "Minimum experience",
      "Location",
      "Work mode",
    ]);
    // experienceMax matched (6 === 6), so it must not be reported.
    expect(conflicts.map((c) => c.field)).not.toContain("Maximum experience");
  });

  it("leaves the caller's object untouched (no mutation)", () => {
    const typed: Form = { ...blankForm, title: "Original" };
    mergeProposal(typed, { ...emptyProposal, title: "Proposed", location: "Pune" });
    expect(typed.title).toBe("Original");
    expect(typed.location).toBeNull();
  });
});
