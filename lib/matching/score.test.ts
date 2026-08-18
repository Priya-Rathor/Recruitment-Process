import { describe, expect, it } from "vitest";
import {
  combineMatch,
  computeSemanticScore,
  DETERMINISTIC_WEIGHT,
  scoreBand,
  SEMANTIC_WEIGHT,
} from "./score";
import { scoreDeterministic, type DeterministicInput } from "./deterministic";
import { validateSemanticMatch, type SemanticMatch } from "@/lib/ai/matchCandidateToJob";

const input: DeterministicInput = {
  job: {
    title: "Senior Java Developer",
    requiredSkills: ["Java", "Spring Boot"],
    preferredSkills: [],
    experienceMin: 4,
    experienceMax: 7,
    salaryMin: 1_500_000,
    salaryMax: 2_200_000,
    location: "Gurgaon",
    workMode: "hybrid",
  },
  candidate: {
    skills: ["Java", "Spring"],
    totalExperienceYears: 5,
    expectedSalary: 1_900_000,
    noticePeriodDays: 30,
    location: "Gurgaon",
    currentRole: "Software Engineer",
  },
};

const semantic: SemanticMatch = {
  roleSimilarity: 0.9,
  seniorityFit: 0.8,
  skillEquivalences: [
    { required: "Spring Boot", coveredBy: "Spring", confidence: 0.85, reason: "Spring Boot builds on Spring" },
  ],
  observations: ["Backend-focused throughout."],
  needsVerification: ["Depth of production AWS exposure."],
};

describe("weights", () => {
  it("splits 70/30 in favour of the deterministic half", () => {
    // The facts are recorded; the semantic read is a judgement. The number
    // should lean on the more trustworthy half.
    expect(DETERMINISTIC_WEIGHT).toBeCloseTo(0.7);
    expect(SEMANTIC_WEIGHT).toBeCloseTo(0.3);
    expect(DETERMINISTIC_WEIGHT + SEMANTIC_WEIGHT).toBeCloseTo(1);
  });
});

describe("combineMatch without AI", () => {
  const deterministic = scoreDeterministic(input);
  const combined = combineMatch({ deterministic, semantic: null });

  it("uses the deterministic score as the overall score", () => {
    expect(combined.overallScore).toBe(deterministic.score);
    expect(combined.semanticScore).toBeNull();
  });

  it("records that AI was not consulted, so the UI can say so", () => {
    expect(combined.aiUsed).toBe(false);
  });

  it("still produces a usable, explained result", () => {
    // The spec requires the manual workflow to stay usable when AI is down.
    expect(combined.strongMatches.length).toBeGreaterThan(0);
    expect(combined.overallScore).toBeGreaterThan(0);
  });

  it("carries no AI-sourced findings", () => {
    const all = [...combined.strongMatches, ...combined.gaps, ...combined.needsVerification];
    expect(all.every((finding) => finding.source === "code")).toBe(true);
  });
});

describe("combineMatch with AI", () => {
  const deterministic = scoreDeterministic(input);
  const combined = combineMatch({ deterministic, semantic });

  it("computes the overall score itself rather than taking one from the model", () => {
    const expected =
      deterministic.score * DETERMINISTIC_WEIGHT +
      combined.semanticScore! * SEMANTIC_WEIGHT;
    expect(combined.overallScore).toBeCloseTo(expected, 1);
  });

  it("promotes a confident skill equivalence to a strength", () => {
    const finding = combined.strongMatches.find((f) => f.key.startsWith("skill-equivalence"));
    expect(finding?.source).toBe("ai");
    expect(finding?.detail).toMatch(/Spring Boot may be covered by Spring/);
  });

  it("sends a LOW-confidence equivalence to needs-verification, not strengths", () => {
    // A model's hunch must never be silently promoted to a fact.
    const unsure = combineMatch({
      deterministic,
      semantic: {
        ...semantic,
        skillEquivalences: [
          { required: "Spring Boot", coveredBy: "Spring", confidence: 0.3, reason: "" },
        ],
      },
    });

    expect(unsure.strongMatches.some((f) => f.key.startsWith("skill-equivalence"))).toBe(false);
    const verify = unsure.needsVerification.find((f) => f.key.startsWith("skill-equivalence"));
    expect(verify?.detail).toMatch(/low confidence/i);
  });

  it("labels every AI-derived finding as source 'ai'", () => {
    // A recruiter must be able to tell a checked fact from a judgement.
    const aiFindings = [
      ...combined.strongMatches,
      ...combined.gaps,
      ...combined.needsVerification,
    ].filter((f) => f.source === "ai");
    expect(aiFindings.length).toBeGreaterThan(0);
  });

  it("keeps every deterministic finding", () => {
    for (const finding of deterministic.strongMatches) {
      expect(combined.strongMatches).toContainEqual(finding);
    }
    for (const finding of deterministic.gaps) {
      expect(combined.gaps).toContainEqual(finding);
    }
  });

  it("flags a distant role as a gap", () => {
    const distant = combineMatch({
      deterministic,
      semantic: { ...semantic, roleSimilarity: 0.1 },
    });
    expect(distant.gaps.some((f) => f.key === "role-similarity")).toBe(true);
  });

  it("flags a seniority mismatch for verification", () => {
    const junior = combineMatch({
      deterministic,
      semantic: { ...semantic, seniorityFit: 0.2 },
    });
    expect(junior.needsVerification.some((f) => f.key === "seniority-fit")).toBe(true);
  });
});

describe("the score cannot contradict the facts", () => {
  it("a poor deterministic fit cannot be rescued into a strong score by AI", () => {
    // Even with maximum semantic enthusiasm, the 70% deterministic weight holds.
    const poor = scoreDeterministic({
      job: input.job,
      candidate: {
        skills: ["COBOL"],
        totalExperienceYears: 1,
        expectedSalary: 6_000_000,
        noticePeriodDays: 180,
        location: "Bengaluru",
        currentRole: "Mainframe Operator",
      },
    });

    const combined = combineMatch({
      deterministic: poor,
      semantic: {
        roleSimilarity: 1,
        seniorityFit: 1,
        skillEquivalences: [],
        observations: [],
        needsVerification: [],
      },
    });

    expect(poor.score).toBeLessThan(30);
    expect(combined.overallScore).toBeLessThan(60);
    // And the gaps that caused it are all still visible.
    expect(combined.gaps.length).toBeGreaterThan(0);
  });

  it("keeps the overall score within 0-100 at both extremes", () => {
    const best = combineMatch({
      deterministic: scoreDeterministic(input),
      semantic: {
        roleSimilarity: 1,
        seniorityFit: 1,
        skillEquivalences: [
          { required: "Spring Boot", coveredBy: "Spring", confidence: 1, reason: "" },
        ],
        observations: [],
        needsVerification: [],
      },
    });
    const worst = combineMatch({
      deterministic: scoreDeterministic({
        job: input.job,
        candidate: {
          skills: [],
          totalExperienceYears: 0,
          expectedSalary: 90_000_000,
          noticePeriodDays: 365,
          location: "Nowhere",
          currentRole: null,
        },
      }),
      semantic: {
        roleSimilarity: 0,
        seniorityFit: 0,
        skillEquivalences: [],
        observations: [],
        needsVerification: [],
      },
    });

    for (const score of [best.overallScore, worst.overallScore]) {
      expect(score).toBeGreaterThanOrEqual(0);
      expect(score).toBeLessThanOrEqual(100);
    }
  });
});

describe("computeSemanticScore", () => {
  it("uses role and seniority alone when nothing was unmatched", () => {
    const score = computeSemanticScore({ ...semantic, skillEquivalences: [] }, 0);
    expect(score).toBeCloseTo(0.9 * 0.6 * 100 + 0.8 * 0.4 * 100, 1);
  });

  it("cannot claim to cover more skills than were missing", () => {
    const score = computeSemanticScore(
      {
        ...semantic,
        skillEquivalences: Array.from({ length: 10 }, (_, i) => ({
          required: `skill-${i}`,
          coveredBy: "something",
          confidence: 1,
          reason: "",
        })),
      },
      1
    );
    expect(score).toBeLessThanOrEqual(100);
  });

  it("ignores equivalences below the confidence threshold", () => {
    const confident = computeSemanticScore(semantic, 1);
    const unsure = computeSemanticScore(
      {
        ...semantic,
        skillEquivalences: [
          { required: "Spring Boot", coveredBy: "Spring", confidence: 0.2, reason: "" },
        ],
      },
      1
    );
    expect(confident).toBeGreaterThan(unsure);
  });
});

describe("validateSemanticMatch", () => {
  it("accepts well-formed output", () => {
    const parsed = validateSemanticMatch(
      { roleSimilarity: 0.8, seniorityFit: 0.7, skillEquivalences: [], observations: [] },
      []
    );
    expect(parsed?.roleSimilarity).toBe(0.8);
  });

  it("REJECTS output missing the two required scores", () => {
    // Defaulting them would invent a semantic signal that was never given.
    expect(validateSemanticMatch({ roleSimilarity: 0.8 }, [])).toBeNull();
    expect(validateSemanticMatch({}, [])).toBeNull();
    expect(validateSemanticMatch(null, [])).toBeNull();
  });

  it("REJECTS out-of-range scores", () => {
    expect(validateSemanticMatch({ roleSimilarity: 8, seniorityFit: 0.5 }, [])).toBeNull();
    expect(validateSemanticMatch({ roleSimilarity: -1, seniorityFit: 0.5 }, [])).toBeNull();
  });

  it("DISCARDS an equivalence for a skill that was never unmatched", () => {
    // Otherwise the model could invent a match for a requirement the job never
    // had, or "cover" a skill the deterministic pass already settled.
    const parsed = validateSemanticMatch(
      {
        roleSimilarity: 0.8,
        seniorityFit: 0.7,
        skillEquivalences: [
          { required: "Kubernetes", coveredBy: "Docker", confidence: 0.9 },
          { required: "Spring Boot", coveredBy: "Spring", confidence: 0.9 },
        ],
      },
      ["Spring Boot"]
    );

    expect(parsed?.skillEquivalences).toHaveLength(1);
    expect(parsed?.skillEquivalences[0].required).toBe("Spring Boot");
  });

  it("drops malformed equivalence entries", () => {
    const parsed = validateSemanticMatch(
      {
        roleSimilarity: 0.8,
        seniorityFit: 0.7,
        skillEquivalences: [
          { required: "Spring Boot" },
          { coveredBy: "Spring", confidence: 0.9 },
          null,
          "Spring Boot = Spring",
          { required: "Spring Boot", coveredBy: "Spring", confidence: 5 },
        ],
      },
      ["Spring Boot"]
    );
    expect(parsed?.skillEquivalences).toEqual([]);
  });
});

describe("scoreBand", () => {
  it("bands consistently at the boundaries", () => {
    expect(scoreBand(100)).toBe("strong");
    expect(scoreBand(75)).toBe("strong");
    expect(scoreBand(74.99)).toBe("moderate");
    expect(scoreBand(50)).toBe("moderate");
    expect(scoreBand(49.99)).toBe("weak");
    expect(scoreBand(0)).toBe("weak");
  });
});

describe("a job's own AI share", () => {
  it("defaults to the platform split when none is given", () => {
    const deterministic = scoreDeterministic(input);
    expect(combineMatch({ deterministic, semantic })).toEqual(
      combineMatch({ deterministic, semantic, semanticWeight: SEMANTIC_WEIGHT })
    );
  });

  it("lets a job lean harder on the facts, or on the model", () => {
    const deterministic = scoreDeterministic(input);

    const factsOnly = combineMatch({ deterministic, semantic, semanticWeight: 0 });
    const modelOnly = combineMatch({ deterministic, semantic, semanticWeight: 1 });

    expect(factsOnly.overallScore).toBe(deterministic.score);
    expect(modelOnly.overallScore).toBe(factsOnly.semanticScore);
    // The findings are unaffected: a weight changes the arithmetic, never what
    // the recruiter is told was found.
    expect(modelOnly.strongMatches).toEqual(factsOnly.strongMatches);
  });

  it("clamps a nonsensical share instead of inverting the score", () => {
    const deterministic = scoreDeterministic(input);
    // Above 1 the deterministic half would be multiplied by a negative number.
    expect(combineMatch({ deterministic, semantic, semanticWeight: 4 }).overallScore).toBe(
      combineMatch({ deterministic, semantic, semanticWeight: 1 }).overallScore
    );
    expect(combineMatch({ deterministic, semantic, semanticWeight: -2 }).overallScore).toBe(
      deterministic.score
    );
  });

  it("ignores the share entirely when AI did not run", () => {
    const deterministic = scoreDeterministic(input);
    const result = combineMatch({ deterministic, semantic: null, semanticWeight: 1 });
    expect(result.overallScore).toBe(deterministic.score);
    expect(result.aiUsed).toBe(false);
  });
});
