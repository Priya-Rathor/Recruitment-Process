// Read side for bulk intake. One tenant-scoped place for pages and routes.
import { createClient } from "@/lib/supabase/server";
import { isMissingRelation } from "@/lib/dashboard/metrics";
import type { IntakeStatus } from "@/lib/intake/status";
import type { IntakeConflictReason } from "@/lib/intake/match";

export type IntakeItem = {
  id: string;
  batch_id: string;
  job_id: string;
  file_name: string;
  file_size_bytes: number | null;
  status: IntakeStatus;
  candidate_id: string | null;
  application_id: string | null;
  resume_id: string | null;
  conflict_candidate_ids: string[];
  queued_conflict_count: number;
  error_message: string | null;
  created_at: string;
  processed_at: string | null;
  /** Joined for display; the table stores only the id. */
  candidate_name?: string | null;
};

const ITEM_COLUMNS =
  "id, batch_id, job_id, file_name, file_size_bytes, status, candidate_id, " +
  "application_id, resume_id, conflict_candidate_ids, queued_conflict_count, " +
  "error_message, created_at, processed_at";

/** Every item in one batch, oldest first so the list keeps its upload order. */
export async function listBatchItems({
  organizationId,
  batchId,
}: {
  organizationId: string;
  batchId: string;
}): Promise<IntakeItem[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("resume_intake_items")
    .select(`${ITEM_COLUMNS}, candidate:candidates(name)`)
    .eq("organization_id", organizationId)
    .eq("batch_id", batchId)
    .order("created_at", { ascending: true });

  if (error) {
    // Migration 0018 not applied yet. Not an error — a build state. Logging it
    // as one raised the dev overlay's issue count on every job page and taught
    // the reader that a red badge means nothing.
    if (isMissingRelation(error)) {
      console.info("[intake] resume_intake_items not created yet — run migration 0018.");
      return [];
    }
    console.error("[intake] batch list failed:", error);
    return [];
  }

  return ((data ?? []) as unknown as (IntakeItem & {
    candidate: { name: string | null } | null;
  })[]).map((row) => ({ ...row, candidate_name: row.candidate?.name ?? null }));
}

/**
 * Unresolved ambiguous matches for a job.
 *
 * These are the files the system refused to guess at. They create nothing, so
 * without a surface like this they would be invisible — which is why the job
 * page shows them until someone deals with them.
 */
export async function listUnresolvedConflicts({
  organizationId,
  jobId,
}: {
  organizationId: string;
  jobId: string;
}): Promise<IntakeItem[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("resume_intake_items")
    .select(ITEM_COLUMNS)
    .eq("organization_id", organizationId)
    .eq("job_id", jobId)
    .eq("status", "match_conflict")
    .order("created_at", { ascending: false })
    .limit(25);

  if (error) {
    if (isMissingRelation(error)) {
      console.info("[intake] resume_intake_items not created yet — run migration 0018.");
      return [];
    }
    // A real failure — an RLS denial, a timeout. Reported loudly, because
    // reporting it as "not built yet" would hide a genuine bug behind a
    // reassuring message. That distinction is the whole point of the split.
    console.error("[intake] conflict list failed:", error);
    return [];
  }
  return (data ?? []) as unknown as IntakeItem[];
}

/** Names for the candidates a conflicted file pointed at, for the banner. */
export async function loadConflictCandidates({
  organizationId,
  candidateIds,
}: {
  organizationId: string;
  candidateIds: string[];
}): Promise<{ id: string; name: string | null }[]> {
  if (candidateIds.length === 0) return [];

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("candidates")
    .select("id, name")
    .eq("organization_id", organizationId)
    .in("id", candidateIds);

  if (error) {
    console.error("[intake] conflict candidate lookup failed:", error);
    return [];
  }
  return (data ?? []) as { id: string; name: string | null }[];
}

export type { IntakeConflictReason };
