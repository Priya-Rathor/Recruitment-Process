// =============================================================================
// Candidate search filters — the DEFINITION.
//
// This is the one description of what a candidate filter is. Both the manual
// filter UI and the natural-language search produce a `CandidateFilters`
// object, and `listCandidates()` in ./queries.ts is the one place that executes
// it against the database.
//
// That is what makes the spec's test — "natural-language search returns results
// matching literal filter equivalents" — true by construction rather than by
// luck: AI never selects rows, it only produces a filter object, and the same
// deterministic query path runs either way.
// =============================================================================

export type CandidateFilters = {
  /** Free text matched against name, current company, and current role. */
  text?: string | null;
  /** Candidate must have ALL of these skills (case-insensitive). */
  skills?: string[];
  location?: string | null;
  experienceMin?: number | null;
  experienceMax?: number | null;
  /** Maximum acceptable notice period, in days. */
  noticePeriodMaxDays?: number | null;
  /** Maximum acceptable expected salary. */
  expectedSalaryMax?: number | null;
  source?: string | null;
  includeArchived?: boolean;
};

export const EMPTY_FILTERS: CandidateFilters = {};

/** True when nothing would be narrowed — used to avoid an "all results" search. */
export function isEmptyFilters(filters: CandidateFilters): boolean {
  return (
    !filters.text &&
    (!filters.skills || filters.skills.length === 0) &&
    !filters.location &&
    filters.experienceMin == null &&
    filters.experienceMax == null &&
    filters.noticePeriodMaxDays == null &&
    filters.expectedSalaryMax == null &&
    !filters.source
  );
}

/**
 * Strips PostgREST pattern and list metacharacters so recruiter-typed text
 * can't become a wildcard or break out of an `or(...)` expression.
 */
export function escapeFilterText(value: string): string {
  return value.replace(/[%_,().*]/g, "").trim();
}

/**
 * Renders filters as plain language, shown above natural-language results so a
 * recruiter can see exactly how their sentence was interpreted — and correct it
 * if the AI read it wrongly.
 */
export function describeFilters(filters: CandidateFilters): string[] {
  const parts: string[] = [];

  if (filters.text) parts.push(`matching “${filters.text}”`);
  if (filters.skills?.length) parts.push(`with ${filters.skills.join(", ")}`);
  if (filters.location) parts.push(`in ${filters.location}`);

  if (filters.experienceMin != null && filters.experienceMax != null) {
    parts.push(`${filters.experienceMin}-${filters.experienceMax} years experience`);
  } else if (filters.experienceMin != null) {
    parts.push(`${filters.experienceMin}+ years experience`);
  } else if (filters.experienceMax != null) {
    parts.push(`up to ${filters.experienceMax} years experience`);
  }

  if (filters.noticePeriodMaxDays != null) {
    parts.push(`notice period ${filters.noticePeriodMaxDays} days or less`);
  }
  if (filters.expectedSalaryMax != null) {
    parts.push(`expecting ${filters.expectedSalaryMax.toLocaleString("en-IN")} or less`);
  }
  if (filters.source) parts.push(`from ${filters.source.replace(/_/g, " ")}`);

  return parts;
}

/** Parses filters from URL query params, validating every value server-side. */
export function filtersFromSearchParams(params: URLSearchParams): CandidateFilters {
  const number = (key: string) => {
    const raw = params.get(key);
    if (!raw) return null;
    const value = Number(raw);
    return Number.isFinite(value) && value >= 0 ? value : null;
  };

  const skills = params.get("skills");

  return {
    text: params.get("q")?.trim() || null,
    skills: skills
      ? skills
          .split(",")
          .map((skill) => skill.trim())
          .filter((skill) => skill.length > 0)
          .slice(0, 20)
      : [],
    location: params.get("location")?.trim() || null,
    experienceMin: number("exp_min"),
    experienceMax: number("exp_max"),
    noticePeriodMaxDays: number("notice_max"),
    expectedSalaryMax: number("salary_max"),
    source: params.get("source")?.trim() || null,
    includeArchived: params.get("archived") === "true",
  };
}
