// =============================================================================
// Bulk intake — deciding WHO a resume belongs to.
//
// Deterministic, never AI. Whether two strings are the same contact is a
// checkable fact, and the platform rule is that AI is for semantic judgement,
// not for facts a computer can verify. The AI's only job upstream of this file
// is turning a PDF into fields; deciding whether those fields name someone we
// already know is arithmetic.
//
// NORMALISATION IS NOT REDEFINED HERE. It is imported from
// lib/candidates/dedupe.ts, which is itself kept in sync with
// normalize_candidate_contact() in migration 0003. Three implementations of
// "same phone number" would eventually disagree, and the day they did, a
// duplicate would slip through in exactly the flow this feature exists to
// prevent.
// =============================================================================
import {
  normalizeEmail,
  normalizePhone,
  type DedupeCandidate,
} from "@/lib/candidates/dedupe";

/**
 * What to do with one parsed resume.
 *
 * `conflict` is a first-class outcome, not an error. The spec is explicit that
 * an ambiguous match must never be guessed, and modelling it as a failure would
 * have hidden it among genuine parse failures — which are retried, whereas a
 * conflict must not be.
 */
export type IntakeMatch =
  | { kind: "create" }
  | { kind: "match"; candidateId: string; matchedOn: ("email" | "phone")[] }
  | { kind: "conflict"; candidateIds: string[]; reason: IntakeConflictReason };

export type IntakeConflictReason =
  /** The spec's named case: email points at one person, phone at another. */
  | "email_phone_disagree"
  /** One email already belongs to more than one candidate record. */
  | "email_ambiguous"
  /** One phone number already belongs to more than one candidate record. */
  | "phone_ambiguous";

/**
 * Resolves a parsed resume's contact details against candidates already in the
 * organization.
 *
 * `existing` is the already-narrowed set — the caller queries by normalised
 * email OR normalised phone, so this stays a cheap in-memory decision rather
 * than a scan.
 *
 * THE RULE, stated as the code implements it: collect every candidate id the
 * email matches and every id the phone matches, then take the union.
 *
 *   0 ids  -> nobody we know      -> create
 *   1 id   -> exactly one person  -> match (even if only one field matched)
 *   2+ ids -> ambiguous           -> conflict, resolve nothing
 *
 * The union is what makes this correct rather than merely plausible. Checking
 * "does the email match?" and then "does the phone match?" in sequence and
 * taking the first hit would silently pick the email's owner in precisely the
 * shared-family-phone case the spec says not to guess at. The union also
 * catches a case the spec doesn't name but the schema permits: there is no
 * unique index on candidates.email_normalized, so one address can already
 * belong to two records. That is equally ambiguous and is treated the same way.
 */
export function resolveCandidateMatch({
  email,
  phone,
  existing,
}: {
  email: string | null | undefined;
  phone: string | null | undefined;
  existing: DedupeCandidate[];
}): IntakeMatch {
  const emailKey = normalizeEmail(email);
  const phoneKey = normalizePhone(phone);

  // Nothing to match on. Creating is correct — a resume with no contact details
  // is still a person we want on file — but it is genuinely un-deduplicatable,
  // so the same file uploaded twice will make two candidates. Callers guard
  // this separately by refusing files with no name AND no contact details at
  // all; see hasIdentifyingDetails().
  if (!emailKey && !phoneKey) return { kind: "create" };

  const emailMatches = emailKey
    ? existing.filter((candidate) => candidate.email_normalized === emailKey)
    : [];
  const phoneMatches = phoneKey
    ? existing.filter((candidate) => candidate.phone_normalized === phoneKey)
    : [];

  const union = new Map<string, DedupeCandidate>();
  for (const candidate of [...emailMatches, ...phoneMatches]) {
    union.set(candidate.id, candidate);
  }

  const ids = [...union.keys()];

  if (ids.length === 0) return { kind: "create" };

  if (ids.length === 1) {
    const matchedOn: ("email" | "phone")[] = [];
    if (emailMatches.length > 0) matchedOn.push("email");
    if (phoneMatches.length > 0) matchedOn.push("phone");
    return { kind: "match", candidateId: ids[0], matchedOn };
  }

  // Ambiguous. Which flavour matters only for the message the recruiter reads —
  // all three refuse to resolve.
  let reason: IntakeConflictReason = "email_phone_disagree";
  if (emailMatches.length > 1) reason = "email_ambiguous";
  else if (phoneMatches.length > 1) reason = "phone_ambiguous";

  // Sorted so the stored array is stable across runs — an unstable order would
  // make the same conflict look like a different one on every re-read.
  return { kind: "conflict", candidateIds: ids.sort(), reason };
}

/** The sentence shown on the conflicted row, naming what to go and check. */
export function describeIntakeConflict(reason: IntakeConflictReason): string {
  switch (reason) {
    case "email_phone_disagree":
      return "The email on this resume belongs to one candidate and the phone number to another.";
    case "email_ambiguous":
      return "This email address is already on more than one candidate record.";
    case "phone_ambiguous":
      return "This phone number is already on more than one candidate record.";
  }
}

/**
 * Whether a parsed resume identifies a person well enough to store.
 *
 * A file that yields no name, no email and no phone parsed into nothing usable
 * — creating a candidate from it would produce an unnamed, uncontactable record
 * that no dedupe rule can ever match, so the same file would pile up a new one
 * on every upload. Refused as a parse failure instead, which is retryable.
 */
export function hasIdentifyingDetails(parsed: {
  name: string | null;
  email: string | null;
  phone: string | null;
}): boolean {
  return Boolean(
    (parsed.name && parsed.name.trim().length > 0) ||
      normalizeEmail(parsed.email) ||
      normalizePhone(parsed.phone)
  );
}

/**
 * A display name for a candidate created from a resume.
 *
 * The name is the one field `candidates` requires, and a resume that parsed
 * cleanly can still omit it — headers rendered as images, or a CV that leads
 * with a logo. Falling back to the email's local part beats both alternatives:
 * refusing the file (we have a real person and real contact details) and
 * inventing a placeholder like "Unknown" (which would collide with every other
 * such candidate in the list).
 */
export function candidateNameFrom(parsed: {
  name: string | null;
  email: string | null;
  phone: string | null;
}): string | null {
  const name = parsed.name?.trim();
  if (name) return name.slice(0, 200);

  const email = normalizeEmail(parsed.email);
  if (email) {
    const local = email.split("@")[0]?.replace(/[._-]+/g, " ").trim();
    if (local) return local.slice(0, 200);
  }

  const phone = normalizePhone(parsed.phone);
  if (phone) return `Candidate ${phone.slice(-4)}`;

  return null;
}
