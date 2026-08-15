// =============================================================================
// What an application update may and may not contain.
//
// THE POINT OF THIS FILE is the refusal, not the acceptance.
//
// name, email and phone belong to the CANDIDATE. One candidate can hold five
// applications, so letting any application edit their phone number means five
// screens racing to own one fact — and the loser's copy is silently wrong.
//
// Hiding the fields in the UI is not enough. The browser holds an authenticated
// PostgREST client and this API is reachable by curl, so the rule has to live
// where the write happens. rejectCandidateFields() is called before anything
// else in the PATCH handler and returns an error the moment one of those keys
// appears — present-and-null counts, because `{"email": null}` is an attempt to
// erase an address, not an absence of intent.
// =============================================================================

/** Fields that belong to the candidate record and never to an application. */
export const CANDIDATE_ONLY_FIELDS = [
  "name",
  "email",
  "phone",
  // The normalised forms are derived by a database trigger; accepting them
  // would let a caller desynchronise dedupe matching from the real values.
  "email_normalized",
  "phone_normalized",
  // Nested shapes a well-meaning client might send instead.
  "candidate",
  "candidate_name",
  "candidate_email",
  "candidate_phone",
] as const;

export const CANDIDATE_FIELD_MESSAGE =
  "Candidate name, email and phone are edited on the candidate's own page, not here.";

/**
 * Refuses a payload carrying candidate identity fields.
 *
 * Returns the offending key so the error names what was wrong rather than
 * making the caller guess which of ten fields was the problem.
 */
export function rejectCandidateFields(
  body: unknown
): { ok: true } | { ok: false; field: string; message: string } {
  if (typeof body !== "object" || body === null) return { ok: true };

  const payload = body as Record<string, unknown>;

  for (const field of CANDIDATE_ONLY_FIELDS) {
    // `in`, not a truthiness check: {"email": null} and {"email": ""} are both
    // attempts to change an address, and both must be refused.
    if (field in payload) {
      return { ok: false, field, message: CANDIDATE_FIELD_MESSAGE };
    }
  }

  return { ok: true };
}

// -----------------------------------------------------------------------------
// Priority
// -----------------------------------------------------------------------------

export const APPLICATION_PRIORITIES = ["low", "normal", "high"] as const;
export type ApplicationPriority = (typeof APPLICATION_PRIORITIES)[number];

export function isApplicationPriority(value: unknown): value is ApplicationPriority {
  return typeof value === "string" && (APPLICATION_PRIORITIES as readonly string[]).includes(value);
}

export const PRIORITY_LABELS: Record<ApplicationPriority, string> = {
  low: "Low",
  normal: "Normal",
  high: "High",
};

/**
 * Chip tone per priority.
 *
 * "Normal" is deliberately neutral and unremarkable — it is the default, and a
 * board where every card wears a coloured badge communicates nothing.
 */
export const PRIORITY_TONE: Record<ApplicationPriority, "neutral" | "warning" | "info"> = {
  low: "neutral",
  normal: "neutral",
  high: "warning",
};
