// Server-side candidate queries shared by pages and route handlers, so tenant
// scoping and the filter execution path live in exactly one place.
import { createClient } from "@/lib/supabase/server";
import { escapeFilterText, type CandidateFilters } from "@/lib/candidates/filters";
import { findDuplicates, normalizeEmail, normalizePhone, type DuplicateMatch } from "@/lib/candidates/dedupe";
import type { Candidate } from "@/lib/types";
import { describeDbError } from "@/lib/supabase/errors";

export const CANDIDATE_COLUMNS =
  "id, organization_id, name, email, phone, email_normalized, phone_normalized, location, " +
  "current_company, current_role, total_experience_years, skills, expected_salary, " +
  "notice_period_days, source, resume_url, archived_at, created_at, updated_at";

/**
 * Lists candidates for an organization.
 *
 * Both the manual filter UI and natural-language search reach this same
 * function, which is what makes their results provably identical for equivalent
 * filters.
 */
export async function listCandidates({
  organizationId,
  filters,
  limit = 50,
  offset = 0,
}: {
  organizationId: string;
  filters: CandidateFilters;
  limit?: number;
  offset?: number;
}): Promise<{ candidates: Candidate[]; total: number; failed: boolean }> {
  const supabase = await createClient();

  // THE single execution point for candidate filters. Manual filters and
  // AI-translated natural-language search both arrive here, which is why their
  // results are identical for equivalent filters.
  //
  // Ranges are inclusive at both ends, matching how a recruiter reads
  // "4-7 years". Notice period and salary are one-sided maximums, because that
  // is how the constraint is actually expressed ("less than 45 days notice").
  let query = supabase
    .from("candidates")
    .select(CANDIDATE_COLUMNS, { count: "exact" })
    // Redundant with RLS, kept as defence in depth.
    .eq("organization_id", organizationId);

  if (!filters.includeArchived) {
    query = query.is("archived_at", null);
  }

  if (filters.text) {
    const escaped = escapeFilterText(filters.text);
    if (escaped.length > 0) {
      query = query.or(
        `name.ilike.%${escaped}%,current_company.ilike.%${escaped}%,current_role.ilike.%${escaped}%`
      );
    }
  }

  if (filters.skills && filters.skills.length > 0) {
    // Array-superset test backed by the GIN index: the candidate must have
    // every requested skill, not merely one of them.
    query = query.contains("skills", filters.skills);
  }

  if (filters.location) {
    const escaped = escapeFilterText(filters.location);
    if (escaped.length > 0) query = query.ilike("location", `%${escaped}%`);
  }

  if (filters.experienceMin != null) {
    query = query.gte("total_experience_years", filters.experienceMin);
  }
  if (filters.experienceMax != null) {
    query = query.lte("total_experience_years", filters.experienceMax);
  }
  if (filters.noticePeriodMaxDays != null) {
    query = query.lte("notice_period_days", filters.noticePeriodMaxDays);
  }
  if (filters.expectedSalaryMax != null) {
    query = query.lte("expected_salary", filters.expectedSalaryMax);
  }
  if (filters.source) {
    query = query.eq("source", filters.source);
  }

  const { data, error, count } = await query
    .order("created_at", { ascending: false })
    .range(offset, offset + limit - 1);

  if (error) {
    console.error("[candidates] list failed:", describeDbError(error));
    return { candidates: [], total: 0, failed: true };
  }

  return {
    candidates: (data ?? []) as unknown as Candidate[],
    total: count ?? 0,
    failed: false,
  };
}

/** Single candidate, scoped to the tenant. Null when not found or not ours. */
export async function getCandidate({
  organizationId,
  candidateId,
}: {
  organizationId: string;
  candidateId: string;
}): Promise<Candidate | null> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("candidates")
    .select(CANDIDATE_COLUMNS)
    .eq("id", candidateId)
    .eq("organization_id", organizationId)
    .maybeSingle();

  if (error || !data) return null;
  return data as unknown as Candidate;
}

/**
 * Looks for existing candidates sharing this email or phone.
 *
 * Queries by the NORMALISED columns (maintained by a database trigger), so the
 * lookup is index-backed and matches regardless of how the contact detail was
 * typed. Runs before every create, per the spec's flow: "system checks for
 * duplicates before creating a new candidate record".
 */
export async function findDuplicateCandidates({
  organizationId,
  email,
  phone,
  excludeId,
}: {
  organizationId: string;
  email?: string | null;
  phone?: string | null;
  excludeId?: string;
}): Promise<DuplicateMatch[]> {
  const emailKey = normalizeEmail(email);
  const phoneKey = normalizePhone(phone);
  if (!emailKey && !phoneKey) return [];

  const supabase = await createClient();

  // OR across the two normalised columns so one round trip covers both.
  const conditions: string[] = [];
  if (emailKey) conditions.push(`email_normalized.eq.${emailKey}`);
  if (phoneKey) conditions.push(`phone_normalized.eq.${phoneKey}`);

  const { data, error } = await supabase
    .from("candidates")
    .select("id, name, email, phone, email_normalized, phone_normalized, created_at")
    .eq("organization_id", organizationId)
    .is("archived_at", null)
    .or(conditions.join(","))
    .limit(25);

  if (error) {
    // A failed duplicate check must not block intake — the recruiter can still
    // create the candidate, and the check is advisory rather than a gate.
    console.error("[candidates] duplicate lookup failed:", describeDbError(error));
    return [];
  }

  return findDuplicates({
    email,
    phone,
    existing: (data ?? []) as {
      id: string;
      name: string | null;
      email_normalized: string | null;
      phone_normalized: string | null;
    }[],
    excludeId,
  });
}

/** Open duplicate records involving this candidate, for the detail page. */
export async function getCandidateDuplicates({
  organizationId,
  candidateId,
}: {
  organizationId: string;
  candidateId: string;
}) {
  const supabase = await createClient();
  const { data } = await supabase
    .from("candidate_duplicates")
    .select("id, candidate_id, duplicate_of_id, matched_on, status, created_at")
    .eq("organization_id", organizationId)
    .or(`candidate_id.eq.${candidateId},duplicate_of_id.eq.${candidateId}`)
    .eq("status", "open");

  return (data ?? []) as {
    id: string;
    candidate_id: string;
    duplicate_of_id: string;
    matched_on: string;
    status: string;
    created_at: string;
  }[];
}
