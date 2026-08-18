// =============================================================================
// Deterministic match scoring — NO AI, EVER.
//
// The spec is explicit: "Obvious, checkable facts — salary, experience,
// location, notice period — are evaluated with normal deterministic code, not
// AI; AI is reserved specifically for semantic comparisons that code cannot
// reliably make." Its test is "deterministic checks never rely on the LLM".
//
// This module imports nothing from lib/ai/ and takes no database handle. It is a
// pure function of two plain objects, so the guarantee is structural rather than
// a promise: there is no code path from here to a model.
//
// Weights are FIXED and documented. Per-organization configurable weighting is
// explicitly Build Later in the spec.
// =============================================================================

/** One line in the strong-matches / gaps / needs-verification lists. */
export type MatchFinding = {
  /** Stable identifier, so the UI can key and later modules can filter. */
  key: string;
  label: string;
  detail: string;
  /**
   * Whether a human should read this as a checked fact or a model's judgement.
   * Everything this file produces is "code".
   */
  source: "code" | "ai";
};

export type DeterministicInput = {
  job: {
    title: string;
    requiredSkills: string[];
    preferredSkills: string[];
    experienceMin: number | null;
    experienceMax: number | null;
    salaryMin: number | null;
    salaryMax: number | null;
    location: string | null;
    workMode: "onsite" | "hybrid" | "remote" | null;
  };
  candidate: {
    skills: string[];
    totalExperienceYears: number | null;
    expectedSalary: number | null;
    noticePeriodDays: number | null;
    location: string | null;
    currentRole: string | null;
  };
};

export type DeterministicResult = {
  /** 0-100, renormalised over the components that could actually be evaluated. */
  score: number;
  /** Components that contributed to the score. */
  evaluated: ComponentKey[];
  /** Components skipped for missing data — reported, never scored as zero. */
  skipped: ComponentKey[];
  strongMatches: MatchFinding[];
  gaps: MatchFinding[];
  needsVerification: MatchFinding[];
  /** Required skills matched literally. */
  matchedRequiredSkills: string[];
  /**
   * Required skills with no literal match. Handed to the AI layer to judge
   * equivalence ("Spring" vs "Spring Boot") — the one skill question code
   * genuinely cannot answer.
   */
  unmatchedRequiredSkills: string[];
  matchedPreferredSkills: string[];
};

export type ComponentKey = "skills" | "experience" | "salary" | "location" | "notice";

/**
 * Fixed weights, summing to 100.
 *
 * Required-skill coverage dominates because a missing mandatory skill is the
 * most common real reason a candidate is rejected. Notice period is lightest: it
 * delays a hire rather than preventing one.
 */
export const COMPONENT_WEIGHTS: Record<ComponentKey, number> = {
  skills: 40,
  experience: 20,
  salary: 15,
  location: 15,
  notice: 10,
};

/** Notice thresholds. Jobs carry no notice requirement, so these are heuristics. */
export const NOTICE_COMFORTABLE_DAYS = 30;
export const NOTICE_ACCEPTABLE_DAYS = 60;
export const NOTICE_LONG_DAYS = 90;

function normalizeSkill(skill: string): string {
  return skill.trim().toLowerCase();
}

/** Literal, case-insensitive skill overlap. Equivalence judgement is AI's job. */
export function intersectSkills(
  required: string[],
  candidateSkills: string[]
): { matched: string[]; unmatched: string[] } {
  const have = new Set(candidateSkills.map(normalizeSkill));
  const matched: string[] = [];
  const unmatched: string[] = [];

  for (const skill of required) {
    if (have.has(normalizeSkill(skill))) matched.push(skill);
    else unmatched.push(skill);
  }

  return { matched, unmatched };
}

/**
 * Loose location comparison: "Gurgaon" should match "Gurgaon, Haryana".
 * Substring either way, case-insensitive. Genuinely different cities do not
 * match; formatting differences do.
 */
export function locationsMatch(jobLocation: string, candidateLocation: string): boolean {
  const job = jobLocation.trim().toLowerCase();
  const candidate = candidateLocation.trim().toLowerCase();
  if (job.length === 0 || candidate.length === 0) return false;
  return job.includes(candidate) || candidate.includes(job);
}

/**
 * Scores a candidate against a job using only checkable facts.
 *
 * Components with missing data are SKIPPED, not scored zero, and the remaining
 * weights are renormalised. Scoring a blank field as zero would punish an
 * incomplete profile as though it were a bad fit, which is a different and much
 * more damaging claim.
 */
export function scoreDeterministic(
  input: DeterministicInput,
  /**
   * Per-component weights, from the job's Resume Score configuration.
   *
   * Defaults to COMPONENT_WEIGHTS, so every existing caller and every job that
   * has not customised anything scores exactly as before. Values need not sum
   * to 100: the combine step below already renormalises, because components
   * with nothing to judge are skipped.
   */
  weights: Record<ComponentKey, number> = COMPONENT_WEIGHTS
): DeterministicResult {
  const { job, candidate } = input;

  const strongMatches: MatchFinding[] = [];
  const gaps: MatchFinding[] = [];
  const needsVerification: MatchFinding[] = [];

  const evaluated: ComponentKey[] = [];
  const skipped: ComponentKey[] = [];
  /** component -> 0..1 fraction of its weight earned. */
  const fractions = new Map<ComponentKey, number>();

  // --- Skills ----------------------------------------------------------------
  const { matched, unmatched } = intersectSkills(job.requiredSkills, candidate.skills);
  const matchedPreferred = intersectSkills(job.preferredSkills, candidate.skills).matched;

  if (job.requiredSkills.length === 0) {
    skipped.push("skills");
    needsVerification.push({
      key: "skills-none-listed",
      label: "Required skills",
      detail: "This job lists no required skills, so skills could not be compared.",
      source: "code",
    });
  } else {
    evaluated.push("skills");
    const coverage = matched.length / job.requiredSkills.length;
    fractions.set("skills", coverage);

    if (matched.length > 0) {
      strongMatches.push({
        key: "skills-matched",
        label: "Required skills",
        detail: `Has ${matched.length} of ${job.requiredSkills.length} required skills: ${matched.join(", ")}.`,
        source: "code",
      });
    }
    if (unmatched.length > 0) {
      // Stated as "not listed" rather than "lacks": the candidate may well have
      // the skill under another name, which is exactly what the AI layer checks.
      gaps.push({
        key: "skills-unmatched",
        label: "Required skills",
        detail: `Not listed on the profile: ${unmatched.join(", ")}.`,
        source: "code",
      });
    }
  }

  if (matchedPreferred.length > 0) {
    strongMatches.push({
      key: "skills-preferred",
      label: "Preferred skills",
      detail: `Also has: ${matchedPreferred.join(", ")}.`,
      source: "code",
    });
  }

  // --- Experience ------------------------------------------------------------
  const years = candidate.totalExperienceYears;
  const hasRange = job.experienceMin !== null || job.experienceMax !== null;

  if (years === null) {
    skipped.push("experience");
    needsVerification.push({
      key: "experience-unknown",
      label: "Experience",
      detail: "The candidate's total experience isn't recorded.",
      source: "code",
    });
  } else if (!hasRange) {
    skipped.push("experience");
    needsVerification.push({
      key: "experience-no-requirement",
      label: "Experience",
      detail: `Candidate has ${years} years; this job states no experience range.`,
      source: "code",
    });
  } else {
    evaluated.push("experience");
    const min = job.experienceMin;
    const max = job.experienceMax;

    if (min !== null && years < min) {
      const shortfall = min - years;
      // Half a year short is nearly a fit; three years short is not. Linear
      // falloff over two years, floored so a big gap still scores above zero
      // when everything else fits.
      fractions.set("experience", Math.max(0, 1 - shortfall / 2));
      gaps.push({
        key: "experience-below",
        label: "Experience",
        detail: `${years} years against a minimum of ${min}.`,
        source: "code",
      });
    } else if (max !== null && years > max) {
      // Overqualified is not a defect — it is a conversation about level and
      // salary, so it belongs in needs-verification rather than gaps.
      fractions.set("experience", 0.8);
      needsVerification.push({
        key: "experience-above",
        label: "Experience",
        detail: `${years} years against a maximum of ${max} — confirm the level and expectations still fit.`,
        source: "code",
      });
    } else {
      fractions.set("experience", 1);
      strongMatches.push({
        key: "experience-in-range",
        label: "Experience",
        detail: `${years} years, within the ${formatRange(min, max, "years")} the job asks for.`,
        source: "code",
      });
    }
  }

  // --- Salary ----------------------------------------------------------------
  const expected = candidate.expectedSalary;
  const budgetMax = job.salaryMax;

  if (expected === null) {
    skipped.push("salary");
    needsVerification.push({
      key: "salary-unknown",
      label: "Expected salary",
      detail: "The candidate's expectation isn't recorded.",
      source: "code",
    });
  } else if (budgetMax === null && job.salaryMin === null) {
    skipped.push("salary");
    needsVerification.push({
      key: "salary-no-band",
      label: "Expected salary",
      detail: `Candidate expects ${formatMoney(expected)}; this job states no salary band.`,
      source: "code",
    });
  } else {
    evaluated.push("salary");

    if (budgetMax !== null && expected > budgetMax) {
      const overBy = (expected - budgetMax) / budgetMax;
      // 10% over is negotiable; 50% over is not the same conversation.
      fractions.set("salary", Math.max(0, 1 - overBy * 2));
      gaps.push({
        key: "salary-above-band",
        label: "Expected salary",
        detail: `Expects ${formatMoney(expected)}, above the band's ${formatMoney(budgetMax)}.`,
        source: "code",
      });
    } else {
      fractions.set("salary", 1);
      strongMatches.push({
        key: "salary-within-band",
        label: "Expected salary",
        detail: `Expects ${formatMoney(expected)}, within the ${formatRange(job.salaryMin, budgetMax, "")} band.`,
        source: "code",
      });
    }
  }

  // --- Location --------------------------------------------------------------
  if (job.workMode === "remote") {
    // Not a constraint at all — skipping is honest, giving free credit is not.
    skipped.push("location");
    strongMatches.push({
      key: "location-remote",
      label: "Location",
      detail: "This role is remote, so location isn't a constraint.",
      source: "code",
    });
  } else if (job.location === null || candidate.location === null) {
    skipped.push("location");
    needsVerification.push({
      key: "location-unknown",
      label: "Location",
      detail:
        job.location === null
          ? "This job states no location."
          : "The candidate's location isn't recorded.",
      source: "code",
    });
  } else {
    evaluated.push("location");
    if (locationsMatch(job.location, candidate.location)) {
      fractions.set("location", 1);
      strongMatches.push({
        key: "location-match",
        label: "Location",
        detail: `Based in ${candidate.location}, matching ${job.location}.`,
        source: "code",
      });
    } else {
      // Hybrid still requires presence some of the time, so a mismatch is a
      // real gap; but relocation is common enough to be worth partial credit.
      fractions.set("location", job.workMode === "hybrid" ? 0.2 : 0);
      gaps.push({
        key: "location-mismatch",
        label: "Location",
        detail: `Based in ${candidate.location}; the role is in ${job.location}${
          job.workMode ? ` (${job.workMode})` : ""
        }. Confirm willingness to relocate.`,
        source: "code",
      });
    }
  }

  // --- Notice period ---------------------------------------------------------
  const notice = candidate.noticePeriodDays;
  if (notice === null) {
    skipped.push("notice");
    needsVerification.push({
      key: "notice-unknown",
      label: "Notice period",
      detail: "The candidate's notice period isn't recorded.",
      source: "code",
    });
  } else {
    evaluated.push("notice");
    if (notice <= NOTICE_COMFORTABLE_DAYS) {
      fractions.set("notice", 1);
      strongMatches.push({
        key: "notice-short",
        label: "Notice period",
        detail: notice === 0 ? "Available immediately." : `${notice} days' notice.`,
        source: "code",
      });
    } else if (notice <= NOTICE_ACCEPTABLE_DAYS) {
      fractions.set("notice", 0.7);
    } else if (notice <= NOTICE_LONG_DAYS) {
      fractions.set("notice", 0.4);
      gaps.push({
        key: "notice-long",
        label: "Notice period",
        detail: `${notice} days' notice — a long lead time to a start date.`,
        source: "code",
      });
    } else {
      fractions.set("notice", 0.1);
      gaps.push({
        key: "notice-very-long",
        label: "Notice period",
        detail: `${notice} days' notice — check whether it can be bought out or shortened.`,
        source: "code",
      });
    }
  }

  // --- Combine ---------------------------------------------------------------
  const totalWeight = evaluated.reduce((sum, key) => sum + (weights[key] ?? 0), 0);

  // Nothing checkable at all. 0 would read as "terrible fit"; the truth is
  // "we don't know", which the needs-verification list already says.
  const score =
    totalWeight === 0
      ? 0
      : round2(
          (evaluated.reduce(
            (sum, key) => sum + (weights[key] ?? 0) * (fractions.get(key) ?? 0),
            0
          ) /
            totalWeight) *
            100
        );

  return {
    score,
    evaluated,
    skipped,
    strongMatches,
    gaps,
    needsVerification,
    matchedRequiredSkills: matched,
    unmatchedRequiredSkills: unmatched,
    matchedPreferredSkills: matchedPreferred,
  };
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

function formatRange(min: number | null, max: number | null, unit: string): string {
  const suffix = unit ? ` ${unit}` : "";
  if (min !== null && max !== null) return `${min}-${max}${suffix}`;
  if (min !== null) return `${min}+${suffix}`;
  return `up to ${max}${suffix}`;
}

function formatMoney(value: number): string {
  return value.toLocaleString("en-IN");
}
