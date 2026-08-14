// =============================================================================
// Resume review — the propose/confirm boundary.
//
// This file is where Module 6's central rule is actually enforced: "AI does not
// directly overwrite trusted candidate data. It proposes differences, and the
// recruiter chooses." The spec's tests are:
//
//   - "Recruiter's chosen value always wins over the AI proposal once confirmed"
//   - "No AI output is written to the candidate profile without a review step"
//
// Both are properties of `applyReviewDecisions()` below: it accepts explicit
// per-field decisions and returns ONLY the fields the recruiter chose to accept.
// A field absent from the decisions is never written, so the default outcome of
// doing nothing is that nothing changes.
// =============================================================================
import type { ParsedResume } from "@/lib/ai/parseResume";
import type { Candidate } from "@/lib/types";

/** Candidate fields a resume can propose changes to. */
export const REVIEWABLE_FIELDS = [
  "name",
  "email",
  "phone",
  "location",
  "current_company",
  "current_role",
  "total_experience_years",
  "expected_salary",
  "notice_period_days",
  "skills",
] as const;

export type ReviewableField = (typeof REVIEWABLE_FIELDS)[number];

export const FIELD_LABELS: Record<ReviewableField, string> = {
  name: "Name",
  email: "Email",
  phone: "Phone",
  location: "Location",
  current_company: "Current company",
  current_role: "Current role",
  total_experience_years: "Total experience",
  expected_salary: "Expected salary",
  notice_period_days: "Notice period",
  skills: "Skills",
};

export type FieldComparison = {
  field: ReviewableField;
  label: string;
  /** What the candidate record holds now. */
  existing: string | null;
  /** What the resume says. */
  proposed: string | null;
  /**
   * new      — profile is blank, resume has a value (safe to accept)
   * conflict — both have values and they differ (needs a decision)
   * same     — they agree (nothing to do)
   * missing  — the resume didn't mention it (nothing to offer)
   */
  status: "new" | "conflict" | "same" | "missing";
};

/** Formats a stored value for side-by-side display. */
function displayValue(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  if (Array.isArray(value)) return value.length > 0 ? value.join(", ") : null;
  const text = String(value).trim();
  return text.length === 0 ? null : text;
}

/** Maps a candidate column to the parsed-resume field that proposes it. */
function proposedValueFor(field: ReviewableField, parsed: ParsedResume): unknown {
  switch (field) {
    case "name":
      return parsed.name;
    case "email":
      return parsed.email;
    case "phone":
      return parsed.phone;
    case "location":
      return parsed.location;
    case "current_company":
      return parsed.currentCompany;
    case "current_role":
      return parsed.currentRole;
    case "total_experience_years":
      return parsed.totalExperienceYears;
    case "expected_salary":
      return parsed.expectedSalary;
    case "notice_period_days":
      return parsed.noticePeriodDays;
    case "skills":
      return parsed.skills.length > 0 ? parsed.skills : null;
  }
}

function existingValueFor(field: ReviewableField, candidate: Candidate): unknown {
  return (candidate as unknown as Record<string, unknown>)[field];
}

/**
 * Builds the side-by-side comparison the review screen renders — the spec's
 * "Resume says expected CTC is 20 LPA. Existing profile says 18 LPA."
 *
 * Every reviewable field is returned, including ones with nothing to decide, so
 * the UI can show the full picture and the recruiter can see what the resume did
 * NOT contain as well as what it did.
 */
export function buildFieldComparisons(
  candidate: Candidate,
  parsed: ParsedResume
): FieldComparison[] {
  return REVIEWABLE_FIELDS.map((field) => {
    const existingRaw = existingValueFor(field, candidate);
    const proposedRaw = proposedValueFor(field, parsed);

    const existing = displayValue(existingRaw);
    const proposed = displayValue(proposedRaw);

    let status: FieldComparison["status"];
    if (proposed === null) {
      status = "missing";
    } else if (existing === null) {
      status = "new";
    } else if (normalizeForComparison(existing) === normalizeForComparison(proposed)) {
      status = "same";
    } else {
      status = "conflict";
    }

    return { field, label: FIELD_LABELS[field], existing, proposed, status };
  });
}

/**
 * Comparison is case- and whitespace-insensitive so "gurgaon" vs "Gurgaon" is
 * not paraded as a conflict the recruiter must resolve. Genuine differences
 * survive; cosmetic ones don't waste attention.
 */
function normalizeForComparison(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, " ");
}

/** The recruiter's explicit per-field choice. */
export type ReviewDecision = "accept" | "keep";

export type ReviewDecisions = Partial<Record<ReviewableField, ReviewDecision>>;

export type AppliedUpdate = {
  /** Only the fields the recruiter accepted; safe to write to `candidates`. */
  updates: Record<string, unknown>;
  /** Names of the accepted fields, recorded on the parse result for audit. */
  appliedFields: ReviewableField[];
};

/**
 * Produces the candidate update from the recruiter's decisions.
 *
 * Safety properties, each covered by a test:
 *   - A field with no decision is NEVER written. Doing nothing changes nothing.
 *   - "keep" explicitly preserves the existing value — it is not an update.
 *   - "accept" is honoured only when the resume actually proposed a value; a
 *     decision naming a field the resume never mentioned cannot blank it.
 *   - Unknown field names in the payload are ignored rather than passed through
 *     to the database.
 */
export function applyReviewDecisions({
  candidate,
  parsed,
  decisions,
}: {
  candidate: Candidate;
  parsed: ParsedResume;
  decisions: ReviewDecisions;
}): AppliedUpdate {
  const updates: Record<string, unknown> = {};
  const appliedFields: ReviewableField[] = [];

  for (const field of REVIEWABLE_FIELDS) {
    if (decisions[field] !== "accept") continue;

    const proposedRaw = proposedValueFor(field, parsed);
    // An "accept" for something the resume never proposed is meaningless, and
    // must not be turned into a null that wipes the stored value.
    if (proposedRaw === null || proposedRaw === undefined) continue;
    if (Array.isArray(proposedRaw) && proposedRaw.length === 0) continue;

    // Skip a write that would change nothing.
    const existing = displayValue(existingValueFor(field, candidate));
    const proposed = displayValue(proposedRaw);
    if (existing !== null && proposed !== null &&
        normalizeForComparison(existing) === normalizeForComparison(proposed)) {
      continue;
    }

    updates[field] = proposedRaw;
    appliedFields.push(field);
  }

  return { updates, appliedFields };
}

/** Parses decisions from a request body, discarding anything unrecognised. */
export function parseReviewDecisions(value: unknown): ReviewDecisions {
  if (typeof value !== "object" || value === null) return {};
  const raw = value as Record<string, unknown>;
  const decisions: ReviewDecisions = {};

  for (const field of REVIEWABLE_FIELDS) {
    const decision = raw[field];
    if (decision === "accept" || decision === "keep") {
      decisions[field] = decision;
    }
  }

  return decisions;
}

/** Count of fields still needing a decision, for the review screen's header. */
export function countConflicts(comparisons: FieldComparison[]): number {
  return comparisons.filter((comparison) => comparison.status === "conflict").length;
}
