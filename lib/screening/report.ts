// =============================================================================
// Screening report — eligibility, corrections, and what "reviewed" means.
//
// Pure logic, separated from I/O so the two properties that matter most are
// testable without a database or a phone call:
//
//   - a transcript without recorded consent is NOT usable (Module 8's promise,
//     kept here)
//   - a recruiter's correction is recorded as a correction, so it stays
//     distinguishable from what the model originally said
// =============================================================================
import type {
  InterestLevel,
  LocationAcceptance,
  ReportField,
  ScreeningExtraction,
} from "@/lib/ai/generateScreeningSummary";

/** The call facts that decide whether a report can be produced. */
export type CallForReport = {
  status: string;
  transcript: string | null;
  consentConfirmed: boolean;
};

export type EligibilityResult =
  | { eligible: true }
  | { eligible: false; reason: string; code: EligibilityFailure };

export type EligibilityFailure =
  | "no_consent"
  | "not_completed"
  | "no_transcript";

/**
 * Whether a call may be summarised.
 *
 * Consent is checked FIRST and deliberately. The candidate was told the call was
 * recorded so a recruiter could review it; without that confirmation the
 * recording is not ours to process, regardless of how good the transcript is.
 * The database enforces the same rule, so this is the friendly-message half.
 */
export function checkReportEligibility(call: CallForReport): EligibilityResult {
  if (!call.consentConfirmed) {
    return {
      eligible: false,
      code: "no_consent",
      reason:
        "No consent was recorded on this call, so its transcript can't be used. The candidate must be told the call is recorded and agree to continue.",
    };
  }

  if (call.status !== "completed") {
    return {
      eligible: false,
      code: "not_completed",
      // The spec: a failed or no-answer call has no transcript to summarise.
      reason: `This call ended as "${call.status.replace(/_/g, " ")}", so there's no complete conversation to summarise.`,
    };
  }

  if (!call.transcript || call.transcript.trim().length < 50) {
    return {
      eligible: false,
      code: "no_transcript",
      reason: "This call has no usable transcript. Review the recording, or call again.",
    };
  }

  return { eligible: true };
}

/** The report's current, authoritative values. */
export type ReportValues = {
  summary_text: string;
  interest_level: InterestLevel;
  expected_ctc: number | null;
  notice_period_days: number | null;
  location_accepted: LocationAcceptance;
  availability_notes: string | null;
};

export const CORRECTABLE_FIELDS = [
  "summary_text",
  "interest_level",
  "expected_ctc",
  "notice_period_days",
  "location_accepted",
  "availability_notes",
] as const;

export type CorrectableField = (typeof CORRECTABLE_FIELDS)[number];

export const FIELD_LABELS: Record<CorrectableField, string> = {
  summary_text: "Summary",
  interest_level: "Interest level",
  expected_ctc: "Expected CTC",
  notice_period_days: "Notice period",
  location_accepted: "Location",
  availability_notes: "Availability",
};

/** Turns a fresh extraction into the row's initial state. */
export function extractionToReportValues(extraction: ScreeningExtraction): ReportValues {
  return {
    summary_text: extraction.summaryText,
    interest_level: extraction.interestLevel,
    expected_ctc: extraction.expectedCtc,
    notice_period_days: extraction.noticePeriodDays,
    location_accepted: extraction.locationAccepted,
    availability_notes: extraction.availabilityNotes,
  };
}

const INTEREST_VALUES: InterestLevel[] = ["high", "medium", "low", "unclear"];
const LOCATION_VALUES: LocationAcceptance[] = ["accepted", "rejected", "unclear"];

/**
 * Validates a correction payload, keeping only recognised fields with plausible
 * values. Unknown keys are dropped rather than passed to the database.
 */
export function parseCorrections(value: unknown): Partial<ReportValues> {
  if (typeof value !== "object" || value === null) return {};
  const raw = value as Record<string, unknown>;
  const corrections: Partial<ReportValues> = {};

  if (typeof raw.summary_text === "string" && raw.summary_text.trim().length > 0) {
    corrections.summary_text = raw.summary_text.trim().slice(0, 2000);
  }

  if (INTEREST_VALUES.includes(raw.interest_level as InterestLevel)) {
    corrections.interest_level = raw.interest_level as InterestLevel;
  }

  if (LOCATION_VALUES.includes(raw.location_accepted as LocationAcceptance)) {
    corrections.location_accepted = raw.location_accepted as LocationAcceptance;
  }

  if ("expected_ctc" in raw) {
    if (raw.expected_ctc === null || raw.expected_ctc === "") {
      corrections.expected_ctc = null;
    } else {
      const value = Number(raw.expected_ctc);
      if (Number.isFinite(value) && value >= 0) corrections.expected_ctc = value;
    }
  }

  if ("notice_period_days" in raw) {
    if (raw.notice_period_days === null || raw.notice_period_days === "") {
      corrections.notice_period_days = null;
    } else {
      const value = Number(raw.notice_period_days);
      // 0 is valid — an immediate joiner.
      if (Number.isFinite(value) && value >= 0 && value <= 365) {
        corrections.notice_period_days = Math.floor(value);
      }
    }
  }

  if ("availability_notes" in raw) {
    corrections.availability_notes =
      typeof raw.availability_notes === "string" && raw.availability_notes.trim().length > 0
        ? raw.availability_notes.trim().slice(0, 500)
        : null;
  }

  return corrections;
}

export type AppliedCorrections = {
  /** Values to write. Only fields that genuinely changed. */
  updates: Partial<ReportValues>;
  /** Field names now differing from the AI original, for corrected_fields. */
  correctedFields: CorrectableField[];
};

/**
 * Applies a recruiter's corrections.
 *
 * `correctedFields` is computed against the AI ORIGINAL, not against the
 * previous value, so it always answers "does this differ from what the model
 * said?" — which is the question an auditor actually asks. Reverting a field
 * back to the AI value correctly removes it from the list.
 */
export function applyCorrections({
  aiOriginal,
  current,
  corrections,
}: {
  aiOriginal: ReportValues;
  current: ReportValues;
  corrections: Partial<ReportValues>;
}): AppliedCorrections {
  const updates: Partial<ReportValues> = {};

  for (const field of CORRECTABLE_FIELDS) {
    if (!(field in corrections)) continue;
    const next = corrections[field];
    if (!valuesDiffer(current[field], next)) continue;
    (updates[field] as unknown) = next;
  }

  // Recompute the whole list against the AI original.
  const merged: ReportValues = { ...current, ...updates };
  const correctedFields = CORRECTABLE_FIELDS.filter((field) =>
    valuesDiffer(aiOriginal[field], merged[field])
  );

  return { updates, correctedFields };
}

function valuesDiffer(a: unknown, b: unknown): boolean {
  if (a === null || a === undefined) return !(b === null || b === undefined);
  if (b === null || b === undefined) return true;
  if (typeof a === "string" && typeof b === "string") return a.trim() !== b.trim();
  return a !== b;
}

/**
 * Whether a report should still be treated as provisional.
 *
 * Downstream consumers (Module 5's application summary, Module 10's
 * prioritisation, Module 16's analytics) should prefer reviewed reports — the
 * spec says a reviewed report is what becomes "authoritative".
 */
export function isPendingReview(report: { reviewed_at: string | null }): boolean {
  return report.reviewed_at === null;
}

/** Fields worth a recruiter's attention first. */
export function fieldsNeedingAttention(report: {
  uncertain_fields: string[];
  corrected_fields: string[];
}): ReportField[] {
  return report.uncertain_fields.filter(
    (field): field is ReportField => !report.corrected_fields.includes(field)
  );
}
