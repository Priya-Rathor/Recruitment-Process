// =============================================================================
// Candidate deduplication — deterministic, never AI.
//
// The spec's test is "duplicate detection catches same email/phone across
// different sources". Whether two strings are the same contact is a checkable
// fact, so it belongs in code (the platform rule: AI is for semantic judgement,
// not for facts a computer can verify).
//
// MUST STAY IN SYNC with normalize_candidate_contact() in
// supabase/migrations/0003_module4_candidates_management.sql. The database
// trigger is the enforcement — it catches direct PostgREST writes — and these
// functions are what the API uses to look candidates up. If the two normalise
// differently, a duplicate slips through.
// =============================================================================

/** Digits kept when comparing phone numbers (national significant number). */
export const PHONE_MATCH_DIGITS = 10;

/**
 * Lowercased and trimmed. Nothing cleverer on purpose:
 * gmail-style dot/plus stripping would treat two genuinely different corporate
 * addresses as one person on providers that treat them as distinct.
 */
export function normalizeEmail(email: string | null | undefined): string | null {
  if (typeof email !== "string") return null;
  const trimmed = email.trim().toLowerCase();
  return trimmed.length === 0 ? null : trimmed;
}

/**
 * Digits only, compared on the last 10.
 *
 * "+91 98765 43210", "098765 43210" and "9876543210" are one person — the same
 * candidate arriving from a referral, a job board, and a manual entry would
 * otherwise create three records. Comparing the tail avoids depending on
 * whether the recruiter typed a country or trunk prefix, without pulling in a
 * full phone-number library.
 *
 * Shorter strings are kept as-is rather than discarded, so a partial number
 * still matches another identical partial.
 */
export function normalizePhone(phone: string | null | undefined): string | null {
  if (typeof phone !== "string") return null;
  const digits = phone.replace(/\D/g, "");
  if (digits.length === 0) return null;
  return digits.length >= PHONE_MATCH_DIGITS ? digits.slice(-PHONE_MATCH_DIGITS) : digits;
}

/** Minimal shape needed to compare two candidates. */
export type DedupeCandidate = {
  id: string;
  name?: string | null;
  email_normalized?: string | null;
  phone_normalized?: string | null;
};

export type DuplicateMatch = {
  candidate: DedupeCandidate;
  /** Which fields collided, in a stable order. */
  matchedOn: ("email" | "phone")[];
};

/**
 * Finds existing candidates matching the given contact details.
 *
 * `excludeId` skips the record being edited, so updating a candidate doesn't
 * report the candidate as a duplicate of itself.
 *
 * Callers pass an already-narrowed set (the API queries by normalised email or
 * phone), so this stays a cheap in-memory confirmation rather than a scan.
 */
export function findDuplicates({
  email,
  phone,
  existing,
  excludeId,
}: {
  email?: string | null;
  phone?: string | null;
  existing: DedupeCandidate[];
  excludeId?: string;
}): DuplicateMatch[] {
  const emailKey = normalizeEmail(email);
  const phoneKey = normalizePhone(phone);

  // No contact details means nothing to match on. Returning [] rather than
  // "everything" matters: a blank form must not flag the whole database.
  if (!emailKey && !phoneKey) return [];

  const matches: DuplicateMatch[] = [];

  for (const candidate of existing) {
    if (excludeId && candidate.id === excludeId) continue;

    const matchedOn: ("email" | "phone")[] = [];
    if (emailKey && candidate.email_normalized === emailKey) matchedOn.push("email");
    if (phoneKey && candidate.phone_normalized === phoneKey) matchedOn.push("phone");

    if (matchedOn.length > 0) matches.push({ candidate, matchedOn });
  }

  // Strongest evidence first: an email+phone match is more certain than either
  // alone, so it should head the list a recruiter reviews.
  return matches.sort((a, b) => b.matchedOn.length - a.matchedOn.length);
}

/** Stored in candidate_duplicates.matched_on. */
export function formatMatchedOn(matchedOn: ("email" | "phone")[]): string {
  return matchedOn.join(",");
}

/** Human-readable explanation for the duplicate warning in the UI. */
export function describeMatch(matchedOn: ("email" | "phone")[]): string {
  if (matchedOn.length === 2) return "Same email address and phone number";
  if (matchedOn[0] === "email") return "Same email address";
  return "Same phone number";
}
