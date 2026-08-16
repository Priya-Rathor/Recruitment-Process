import { describe, expect, it } from "vitest";
import { evaluateJobHealth, STALE_OPEN_JOB_DAYS, type JobHealthInput } from "./health";

const NOW = new Date("2026-08-13T12:00:00Z");
const daysAgo = (n: number) => new Date(NOW.getTime() - n * 24 * 60 * 60 * 1000).toISOString();

/** A fully-specified, recently-opened job: the healthy baseline. */
const healthyJob: JobHealthInput = {
  status: "open",
  createdAt: daysAgo(5),
  requiredSkills: ["Java", "Spring Boot"],
  experienceMin: 4,
  experienceMax: 7,
  salaryMin: 1_500_000,
  salaryMax: 2_200_000,
  screeningQuestionCount: 5,
};

describe("evaluateJobHealth — healthy baseline", () => {
  it("reports a complete, fresh open job as healthy with no reasons", () => {
    expect(evaluateJobHealth(healthyJob, NOW)).toEqual({ status: "healthy", reasons: [] });
  });
});

describe("rule 1 — on hold", () => {
  it("always needs attention", () => {
    const result = evaluateJobHealth({ ...healthyJob, status: "on_hold" }, NOW);
    expect(result.status).toBe("needs_attention");
    expect(result.reasons).toContain("On hold — needs a decision to resume or close");
  });
});

describe("rules 2-5 — completeness, assessed only when open", () => {
  it("flags an open job with no screening questions", () => {
    const result = evaluateJobHealth({ ...healthyJob, screeningQuestionCount: 0 }, NOW);
    expect(result.reasons.join(" ")).toContain("No screening questions");
  });

  it("flags a missing experience range only when BOTH bounds are absent", () => {
    expect(
      evaluateJobHealth({ ...healthyJob, experienceMin: null, experienceMax: null }, NOW).reasons
    ).toContain("No experience range — candidate matching will be less accurate");

    // One bound is enough to match against.
    expect(
      evaluateJobHealth({ ...healthyJob, experienceMin: 4, experienceMax: null }, NOW).status
    ).toBe("healthy");
  });

  it("flags a missing salary band only when BOTH bounds are absent", () => {
    expect(
      evaluateJobHealth({ ...healthyJob, salaryMin: null, salaryMax: null }, NOW).reasons
    ).toContain("No salary band — candidate matching will be less accurate");

    expect(evaluateJobHealth({ ...healthyJob, salaryMax: null }, NOW).status).toBe("healthy");
  });

  it("flags an open job with no required skills", () => {
    expect(evaluateJobHealth({ ...healthyJob, requiredSkills: [] }, NOW).reasons).toContain(
      "No required skills listed"
    );
  });

  it("does NOT flag an incomplete DRAFT — a draft is allowed to be unfinished", () => {
    const bareDraft: JobHealthInput = {
      status: "draft",
      createdAt: daysAgo(90),
      requiredSkills: [],
      experienceMin: null,
      experienceMax: null,
      salaryMin: null,
      salaryMax: null,
      screeningQuestionCount: 0,
    };
    expect(evaluateJobHealth(bareDraft, NOW)).toEqual({ status: "healthy", reasons: [] });
  });

  it("does NOT flag a CLOSED job for incompleteness — it is simply done", () => {
    const closed: JobHealthInput = {
      status: "closed",
      createdAt: daysAgo(400),
      requiredSkills: [],
      experienceMin: null,
      experienceMax: null,
      salaryMin: null,
      salaryMax: null,
      screeningQuestionCount: 0,
      applicationCount: 0,
    };
    expect(evaluateJobHealth(closed, NOW)).toEqual({ status: "healthy", reasons: [] });
  });
});

describe("rule 6 — staleness", () => {
  it("is healthy exactly at the threshold (strictly greater is required)", () => {
    const result = evaluateJobHealth({ ...healthyJob, createdAt: daysAgo(STALE_OPEN_JOB_DAYS) }, NOW);
    expect(result.status).toBe("healthy");
  });

  it("flags one day past the threshold, quoting the real age", () => {
    const age = STALE_OPEN_JOB_DAYS + 1;
    const result = evaluateJobHealth({ ...healthyJob, createdAt: daysAgo(age) }, NOW);
    expect(result.reasons).toContain(`Open for ${age} days without being filled`);
  });

  it("tolerates an unparseable created_at instead of throwing", () => {
    const result = evaluateJobHealth({ ...healthyJob, createdAt: "not a date" }, NOW);
    expect(result.status).toBe("healthy");
  });
});

describe("rule 7 — no candidates (awaits Module 5)", () => {
  it("is SKIPPED when applicationCount is undefined, rather than assuming zero", () => {
    // Before Module 5 exists we do not know the count. Guessing 0 here would
    // mark every healthy job as unhealthy the moment it turns 7 days old.
    const result = evaluateJobHealth({ ...healthyJob, createdAt: daysAgo(20) }, NOW);
    expect(result.status).toBe("healthy");
  });

  it("flags an open job with zero applications after 7 days", () => {
    const result = evaluateJobHealth(
      { ...healthyJob, createdAt: daysAgo(10), applicationCount: 0 },
      NOW
    );
    expect(result.reasons).toContain("No candidates after 10 days");
  });

  it("does not flag a brand-new job with zero applications", () => {
    const result = evaluateJobHealth(
      { ...healthyJob, createdAt: daysAgo(2), applicationCount: 0 },
      NOW
    );
    expect(result.status).toBe("healthy");
  });

  it("does not flag a job that has applications", () => {
    const result = evaluateJobHealth(
      { ...healthyJob, createdAt: daysAgo(30), applicationCount: 4 },
      NOW
    );
    expect(result.status).toBe("healthy");
  });
});

describe("multiple failures", () => {
  it("accumulates every applicable reason in a stable order", () => {
    const neglected: JobHealthInput = {
      status: "open",
      createdAt: daysAgo(45),
      requiredSkills: [],
      experienceMin: null,
      experienceMax: null,
      salaryMin: null,
      salaryMax: null,
      screeningQuestionCount: 0,
      applicationCount: 0,
    };
    const result = evaluateJobHealth(neglected, NOW);
    expect(result.status).toBe("needs_attention");
    expect(result.reasons).toEqual([
      "No screening questions — add them in the AI Screening Call stage to enable screening",
      "No experience range — candidate matching will be less accurate",
      "No salary band — candidate matching will be less accurate",
      "No required skills listed",
      "Open for 45 days without being filled",
      "No candidates after 45 days",
    ]);
  });
});
