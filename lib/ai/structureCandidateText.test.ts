import { describe, expect, it } from "vitest";
import { mergeCandidateProposal, type CandidateProposal } from "./structureCandidateText";

const emptyProposal: CandidateProposal = {
  name: null,
  email: null,
  phone: null,
  location: null,
  currentCompany: null,
  currentRole: null,
  totalExperienceYears: null,
  skills: [],
  expectedSalary: null,
  noticePeriodDays: null,
};

type Profile = {
  name: string | null;
  email: string | null;
  phone: string | null;
  location: string | null;
  currentCompany: string | null;
  currentRole: string | null;
  totalExperienceYears: number | null;
  expectedSalary: number | null;
  noticePeriodDays: number | null;
};

const blank: Profile = {
  name: null,
  email: null,
  phone: null,
  location: null,
  currentCompany: null,
  currentRole: null,
  totalExperienceYears: null,
  expectedSalary: null,
  noticePeriodDays: null,
};

describe("mergeCandidateProposal — 'AI never overwrites a verified field silently'", () => {
  it("fills every blank field", () => {
    const { merged, conflicts } = mergeCandidateProposal(blank, {
      ...emptyProposal,
      name: "Rahul Sharma",
      currentCompany: "Infosys",
      currentRole: "Software Engineer",
      totalExperienceYears: 5,
      location: "Gurgaon",
      expectedSalary: 1_900_000,
      noticePeriodDays: 30,
    });

    expect(merged.name).toBe("Rahul Sharma");
    expect(merged.currentCompany).toBe("Infosys");
    expect(merged.totalExperienceYears).toBe(5);
    expect(merged.noticePeriodDays).toBe(30);
    expect(conflicts).toEqual([]);
  });

  it("KEEPS a verified value and reports the disagreement", () => {
    // The spec's exact scenario: resume says 20 LPA, profile says 18 LPA.
    const verified: Profile = { ...blank, expectedSalary: 1_800_000 };
    const { merged, conflicts } = mergeCandidateProposal(verified, {
      ...emptyProposal,
      expectedSalary: 2_000_000,
    });

    expect(merged.expectedSalary).toBe(1_800_000);
    expect(conflicts).toEqual([
      { field: "Expected salary", existing: "1800000", proposed: "2000000" },
    ]);
  });

  it("treats 0 notice period as a real value, not a blank", () => {
    // An immediate joiner must not be silently rewritten to 30 days.
    const verified: Profile = { ...blank, noticePeriodDays: 0 };
    const { merged, conflicts } = mergeCandidateProposal(verified, {
      ...emptyProposal,
      noticePeriodDays: 30,
    });

    expect(merged.noticePeriodDays).toBe(0);
    expect(conflicts).toEqual([{ field: "Notice period", existing: "0", proposed: "30" }]);
  });

  it("does not flag a conflict when the values agree", () => {
    const verified: Profile = { ...blank, location: "Gurgaon" };
    const { conflicts } = mergeCandidateProposal(verified, {
      ...emptyProposal,
      location: "Gurgaon",
    });
    expect(conflicts).toEqual([]);
  });

  it("ignores surrounding whitespace when comparing", () => {
    const verified: Profile = { ...blank, currentCompany: "Infosys " };
    const { conflicts } = mergeCandidateProposal(verified, {
      ...emptyProposal,
      currentCompany: "Infosys",
    });
    expect(conflicts).toEqual([]);
  });

  it("treats a whitespace-only value as blank and fills it", () => {
    const verified: Profile = { ...blank, name: "   " };
    const { merged, conflicts } = mergeCandidateProposal(verified, {
      ...emptyProposal,
      name: "Priya Nair",
    });
    expect(merged.name).toBe("Priya Nair");
    expect(conflicts).toEqual([]);
  });

  it("never clears an existing value when the proposal has null", () => {
    const verified: Profile = { ...blank, email: "rahul@example.com", noticePeriodDays: 45 };
    const { merged, conflicts } = mergeCandidateProposal(verified, emptyProposal);
    expect(merged.email).toBe("rahul@example.com");
    expect(merged.noticePeriodDays).toBe(45);
    expect(conflicts).toEqual([]);
  });

  it("collects conflicts across several fields while filling the blanks", () => {
    const verified: Profile = {
      ...blank,
      name: "R. Sharma",
      email: "rahul@example.com",
      totalExperienceYears: 6,
    };
    const { merged, conflicts } = mergeCandidateProposal(verified, {
      ...emptyProposal,
      name: "Rahul Sharma",
      email: "rahul@example.com",
      totalExperienceYears: 5,
      currentCompany: "Infosys",
    });

    expect(merged.name).toBe("R. Sharma");
    expect(merged.totalExperienceYears).toBe(6);
    // Blank field still filled.
    expect(merged.currentCompany).toBe("Infosys");
    // Matching email is not a conflict.
    expect(conflicts.map((conflict) => conflict.field)).toEqual(["Name", "Total experience"]);
  });

  it("does not mutate the caller's object", () => {
    const verified: Profile = { ...blank, name: "Original" };
    mergeCandidateProposal(verified, { ...emptyProposal, name: "Proposed", location: "Pune" });
    expect(verified.name).toBe("Original");
    expect(verified.location).toBeNull();
  });
});
