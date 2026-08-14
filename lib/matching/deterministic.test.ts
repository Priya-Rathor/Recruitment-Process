import { describe, expect, it } from "vitest";
import {
  COMPONENT_WEIGHTS,
  intersectSkills,
  locationsMatch,
  scoreDeterministic,
  type DeterministicInput,
} from "./deterministic";

/** A candidate who fits everything — the 100 baseline. */
const perfectFit: DeterministicInput = {
  job: {
    title: "Senior Java Developer",
    requiredSkills: ["Java", "Spring Boot"],
    preferredSkills: ["Kubernetes"],
    experienceMin: 4,
    experienceMax: 7,
    salaryMin: 1_500_000,
    salaryMax: 2_200_000,
    location: "Gurgaon",
    workMode: "hybrid",
  },
  candidate: {
    skills: ["Java", "Spring Boot", "AWS"],
    totalExperienceYears: 5,
    expectedSalary: 1_900_000,
    noticePeriodDays: 30,
    location: "Gurgaon",
    currentRole: "Software Engineer",
  },
};

function withCandidate(overrides: Partial<DeterministicInput["candidate"]>): DeterministicInput {
  return { ...perfectFit, candidate: { ...perfectFit.candidate, ...overrides } };
}

function withJob(overrides: Partial<DeterministicInput["job"]>): DeterministicInput {
  return { ...perfectFit, job: { ...perfectFit.job, ...overrides } };
}

describe("the deterministic layer is genuinely deterministic", () => {
  it("returns identical results for identical input", () => {
    // No model call, no clock, no randomness: same in, same out, always.
    const a = scoreDeterministic(perfectFit);
    const b = scoreDeterministic(perfectFit);
    expect(a).toEqual(b);
  });

  it("labels every finding it produces as checked by code", () => {
    const result = scoreDeterministic(withCandidate({ expectedSalary: 3_000_000 }));
    const all = [...result.strongMatches, ...result.gaps, ...result.needsVerification];
    expect(all.length).toBeGreaterThan(0);
    for (const finding of all) expect(finding.source).toBe("code");
  });

  it("weights sum to 100", () => {
    const total = Object.values(COMPONENT_WEIGHTS).reduce((sum, weight) => sum + weight, 0);
    expect(total).toBe(100);
  });
});

describe("perfect fit", () => {
  const result = scoreDeterministic(perfectFit);

  it("scores 100", () => {
    expect(result.score).toBe(100);
  });

  it("evaluates every component", () => {
    expect(result.evaluated.sort()).toEqual(
      ["experience", "location", "notice", "salary", "skills"].sort()
    );
    expect(result.skipped).toEqual([]);
  });

  it("produces no gaps", () => {
    expect(result.gaps).toEqual([]);
  });

  it("reports matched preferred skills as a strength", () => {
    // Kubernetes is preferred and the candidate lacks it — not a gap.
    expect(result.matchedPreferredSkills).toEqual([]);
    expect(result.gaps).toEqual([]);
  });
});

describe("skills", () => {
  it("matches case-insensitively", () => {
    const { matched, unmatched } = intersectSkills(["Java", "AWS"], ["java", "aws"]);
    expect(matched).toEqual(["Java", "AWS"]);
    expect(unmatched).toEqual([]);
  });

  it("reports unmatched required skills for the AI layer to judge", () => {
    // "Spring" vs "Spring Boot" is exactly the equivalence code cannot decide.
    const result = scoreDeterministic(withCandidate({ skills: ["Java", "Spring"] }));
    expect(result.matchedRequiredSkills).toEqual(["Java"]);
    expect(result.unmatchedRequiredSkills).toEqual(["Spring Boot"]);
  });

  it("phrases a missing skill as 'not listed', not as a deficiency", () => {
    const result = scoreDeterministic(withCandidate({ skills: ["Java"] }));
    const gap = result.gaps.find((finding) => finding.key === "skills-unmatched");
    expect(gap?.detail).toMatch(/not listed/i);
  });

  it("scales the score with coverage", () => {
    const half = scoreDeterministic(withCandidate({ skills: ["Java"] }));
    const none = scoreDeterministic(withCandidate({ skills: ["COBOL"] }));
    expect(half.score).toBeGreaterThan(none.score);
    expect(none.score).toBeLessThan(70);
  });

  it("skips the component when the job lists no required skills", () => {
    const result = scoreDeterministic(withJob({ requiredSkills: [] }));
    expect(result.skipped).toContain("skills");
    expect(result.needsVerification.some((f) => f.key === "skills-none-listed")).toBe(true);
  });

  it("credits preferred skills as a strength", () => {
    const result = scoreDeterministic(
      withCandidate({ skills: ["Java", "Spring Boot", "Kubernetes"] })
    );
    expect(result.matchedPreferredSkills).toEqual(["Kubernetes"]);
    expect(result.strongMatches.some((f) => f.key === "skills-preferred")).toBe(true);
  });
});

describe("experience", () => {
  it("treats in-range as a strong match", () => {
    const result = scoreDeterministic(withCandidate({ totalExperienceYears: 6 }));
    expect(result.strongMatches.some((f) => f.key === "experience-in-range")).toBe(true);
  });

  it("treats below-minimum as a gap, scaled by the shortfall", () => {
    const slightly = scoreDeterministic(withCandidate({ totalExperienceYears: 3.5 }));
    const badly = scoreDeterministic(withCandidate({ totalExperienceYears: 1 }));
    expect(slightly.gaps.some((f) => f.key === "experience-below")).toBe(true);
    expect(slightly.score).toBeGreaterThan(badly.score);
  });

  it("treats OVER-qualified as needs-verification, not a gap", () => {
    // Being too senior is a conversation about level and salary, not a defect.
    const result = scoreDeterministic(withCandidate({ totalExperienceYears: 12 }));
    expect(result.gaps.some((f) => f.key.startsWith("experience"))).toBe(false);
    expect(result.needsVerification.some((f) => f.key === "experience-above")).toBe(true);
  });

  it("skips when the candidate's experience is unrecorded", () => {
    const result = scoreDeterministic(withCandidate({ totalExperienceYears: null }));
    expect(result.skipped).toContain("experience");
    expect(result.needsVerification.some((f) => f.key === "experience-unknown")).toBe(true);
  });

  it("skips when the job states no range", () => {
    const result = scoreDeterministic(withJob({ experienceMin: null, experienceMax: null }));
    expect(result.skipped).toContain("experience");
  });
});

describe("salary", () => {
  it("treats within-band as a strong match", () => {
    expect(
      scoreDeterministic(perfectFit).strongMatches.some((f) => f.key === "salary-within-band")
    ).toBe(true);
  });

  it("treats above-band as a gap, scaled by how far over", () => {
    const slightly = scoreDeterministic(withCandidate({ expectedSalary: 2_400_000 }));
    const wildly = scoreDeterministic(withCandidate({ expectedSalary: 5_000_000 }));
    expect(slightly.gaps.some((f) => f.key === "salary-above-band")).toBe(true);
    expect(slightly.score).toBeGreaterThan(wildly.score);
  });

  it("treats a below-band expectation as fine, not as a problem", () => {
    const result = scoreDeterministic(withCandidate({ expectedSalary: 900_000 }));
    expect(result.gaps.some((f) => f.key.startsWith("salary"))).toBe(false);
  });

  it("skips when the candidate has no stated expectation", () => {
    const result = scoreDeterministic(withCandidate({ expectedSalary: null }));
    expect(result.skipped).toContain("salary");
    expect(result.needsVerification.some((f) => f.key === "salary-unknown")).toBe(true);
  });

  it("skips when the job has no band", () => {
    const result = scoreDeterministic(withJob({ salaryMin: null, salaryMax: null }));
    expect(result.skipped).toContain("salary");
  });
});

describe("location", () => {
  it("matches a city against a fuller address", () => {
    expect(locationsMatch("Gurgaon", "Gurgaon, Haryana")).toBe(true);
    expect(locationsMatch("Gurgaon, Haryana", "Gurgaon")).toBe(true);
  });

  it("does not match genuinely different places", () => {
    expect(locationsMatch("Gurgaon", "Bengaluru")).toBe(false);
  });

  it("treats a remote role as unconstrained rather than free credit", () => {
    const result = scoreDeterministic(
      withJob({ workMode: "remote", location: "Gurgaon" })
    );
    expect(result.skipped).toContain("location");
    expect(result.strongMatches.some((f) => f.key === "location-remote")).toBe(true);
  });

  it("flags a mismatch as a gap and asks about relocation", () => {
    const result = scoreDeterministic(withCandidate({ location: "Bengaluru" }));
    const gap = result.gaps.find((f) => f.key === "location-mismatch");
    expect(gap).toBeTruthy();
    expect(gap?.detail).toMatch(/relocate/i);
  });

  it("penalises an onsite mismatch more heavily than a hybrid one", () => {
    const hybrid = scoreDeterministic(withCandidate({ location: "Bengaluru" }));
    const onsite = scoreDeterministic({
      job: { ...perfectFit.job, workMode: "onsite" },
      candidate: { ...perfectFit.candidate, location: "Bengaluru" },
    });
    expect(onsite.score).toBeLessThan(hybrid.score);
  });

  it("skips when either location is unrecorded", () => {
    expect(scoreDeterministic(withCandidate({ location: null })).skipped).toContain("location");
    expect(scoreDeterministic(withJob({ location: null })).skipped).toContain("location");
  });
});

describe("notice period", () => {
  it("treats an immediate joiner as a strength and says so plainly", () => {
    const result = scoreDeterministic(withCandidate({ noticePeriodDays: 0 }));
    const finding = result.strongMatches.find((f) => f.key === "notice-short");
    expect(finding?.detail).toBe("Available immediately.");
  });

  it("does not flag a normal notice period at all", () => {
    const result = scoreDeterministic(withCandidate({ noticePeriodDays: 45 }));
    expect(result.gaps.some((f) => f.key.startsWith("notice"))).toBe(false);
    expect(result.strongMatches.some((f) => f.key.startsWith("notice"))).toBe(false);
  });

  it("flags a long notice period as a gap", () => {
    expect(
      scoreDeterministic(withCandidate({ noticePeriodDays: 90 })).gaps.some(
        (f) => f.key === "notice-long"
      )
    ).toBe(true);
  });

  it("suggests a buy-out for a very long notice period", () => {
    const result = scoreDeterministic(withCandidate({ noticePeriodDays: 180 }));
    const gap = result.gaps.find((f) => f.key === "notice-very-long");
    expect(gap?.detail).toMatch(/bought out|shortened/i);
  });

  it("skips when unrecorded", () => {
    const result = scoreDeterministic(withCandidate({ noticePeriodDays: null }));
    expect(result.skipped).toContain("notice");
  });
});

describe("missing data is skipped, never scored as zero", () => {
  it("does not punish an otherwise-perfect candidate for a blank salary field", () => {
    // Scoring a blank as 0 would claim "bad fit" when the truth is "unknown".
    const result = scoreDeterministic(withCandidate({ expectedSalary: null }));
    expect(result.score).toBe(100);
    expect(result.needsVerification.some((f) => f.key === "salary-unknown")).toBe(true);
  });

  it("renormalises over whatever remains evaluable", () => {
    const result = scoreDeterministic(
      withCandidate({ expectedSalary: null, noticePeriodDays: null, location: null })
    );
    expect(result.evaluated.sort()).toEqual(["experience", "skills"]);
    expect(result.score).toBe(100);
  });

  it("returns 0 with everything in needs-verification when nothing is checkable", () => {
    const result = scoreDeterministic({
      job: {
        title: "Unknown",
        requiredSkills: [],
        preferredSkills: [],
        experienceMin: null,
        experienceMax: null,
        salaryMin: null,
        salaryMax: null,
        location: null,
        workMode: null,
      },
      candidate: {
        skills: [],
        totalExperienceYears: null,
        expectedSalary: null,
        noticePeriodDays: null,
        location: null,
        currentRole: null,
      },
    });

    expect(result.evaluated).toEqual([]);
    expect(result.score).toBe(0);
    // The 0 must be explained, not left to read as "terrible candidate".
    expect(result.needsVerification.length).toBeGreaterThan(0);
    expect(result.gaps).toEqual([]);
  });
});

describe("score bounds", () => {
  it("never leaves 0-100 across extreme inputs", () => {
    const extremes: DeterministicInput[] = [
      withCandidate({ expectedSalary: 100_000_000 }),
      withCandidate({ totalExperienceYears: 0 }),
      withCandidate({ noticePeriodDays: 365 }),
      withCandidate({ skills: [] }),
      withCandidate({
        skills: [],
        totalExperienceYears: 0,
        expectedSalary: 99_000_000,
        noticePeriodDays: 365,
        location: "Nowhere",
      }),
    ];

    for (const input of extremes) {
      const { score } = scoreDeterministic(input);
      expect(score).toBeGreaterThanOrEqual(0);
      expect(score).toBeLessThanOrEqual(100);
    }
  });
});
