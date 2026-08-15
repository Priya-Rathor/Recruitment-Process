// =============================================================================
// Candidate typeahead — name, email or phone.
//
// Separate from lib/candidates/filters.ts on purpose. That module's `q` matches
// name, current company and current role, because it backs a "find me people
// like this" search, and Module 4's natural-language tests depend on exactly
// that behaviour. This one answers a different question — "which person is
// this?" — so it matches the three IDENTIFYING fields instead, and adds nothing
// to the semantic search's surface area.
// =============================================================================
import { createClient } from "@/lib/supabase/server";
import { normalizeEmail, normalizePhone } from "@/lib/candidates/dedupe";
import { describeDbError } from "@/lib/supabase/errors";

export type CandidateLookupResult = {
  id: string;
  name: string;
  email: string | null;
  phone: string | null;
  current_role: string | null;
  current_company: string | null;
  archived_at: string | null;
};

const LOOKUP_COLUMNS = "id, name, email, phone, current_role, current_company, archived_at";

/** Minimum characters before searching. Below this every query matches everything. */
export const LOOKUP_MIN_LENGTH = 2;

/**
 * PostgREST `or()` takes a comma-separated filter string, so a comma, a
 * parenthesis or a backslash in user input would change the query's structure
 * rather than its values. Stripped rather than escaped: none of them appear in
 * a name, an email or a phone number worth searching for.
 */
export function escapeLookupText(text: string): string {
  return text.replace(/[,()\\%]/g, " ").replace(/\s+/g, " ").trim();
}

/**
 * Finds candidates by who they are.
 *
 * Matches a partial name, company or role substring, and ALSO tries the input
 * as a whole email address or phone number using the same normalisation the
 * duplicate matcher uses — so pasting "+91 98765 43210" finds the person stored
 * as "098765-43210", which a plain `ilike` never would.
 */
export async function lookupCandidates({
  organizationId,
  query,
  limit = 8,
}: {
  organizationId: string;
  query: string;
  limit?: number;
}): Promise<CandidateLookupResult[]> {
  const text = escapeLookupText(query);
  if (text.length < LOOKUP_MIN_LENGTH) return [];

  const conditions = [
    `name.ilike.%${text}%`,
    `email.ilike.%${text}%`,
    `phone.ilike.%${text}%`,
  ];

  const emailKey = normalizeEmail(text);
  if (emailKey) conditions.push(`email_normalized.eq.${emailKey}`);

  const phoneKey = normalizePhone(text);
  // Only when the input actually looks like a phone number. Normalising "Ana"
  // yields nothing, but normalising a name containing digits would produce a
  // fragment that matches unrelated people.
  if (phoneKey && phoneKey.length >= 6) conditions.push(`phone_normalized.eq.${phoneKey}`);

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("candidates")
    .select(LOOKUP_COLUMNS)
    .eq("organization_id", organizationId)
    .or(conditions.join(","))
    // Archived candidates are INCLUDED. Connecting a resume to someone archived
    // last month is a legitimate correction, and hiding them would push the
    // recruiter into creating the duplicate this feature exists to prevent. The
    // row is labelled so the choice is informed.
    .order("archived_at", { ascending: true, nullsFirst: true })
    .order("name", { ascending: true })
    .limit(limit);

  if (error) {
    console.error("[candidates] lookup failed:", describeDbError(error));
    return [];
  }

  return (data ?? []) as unknown as CandidateLookupResult[];
}

/** One-line subtitle for a result row: role, company, then contact details. */
export function describeCandidate(candidate: CandidateLookupResult): string {
  const role = [candidate.current_role, candidate.current_company].filter(Boolean).join(" · ");
  const contact = [candidate.email, candidate.phone].filter(Boolean).join(" · ");
  return [role, contact].filter(Boolean).join(" — ") || "No other details on file";
}
