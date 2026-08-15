// =============================================================================
// "N profile updates need your review".
//
// Bulk intake queues Module 6 proposals instead of applying them, so a
// candidate can accumulate unreviewed differences without anyone being
// interrupted. That is only safe if the queue is VISIBLE — an invisible queue
// is just silent data loss with extra steps.
//
// A pending review is a resume_parse_results row with reviewed_at null whose
// proposal actually disagrees with the current profile. The second half
// matters: a resume that merely repeats what the profile already says produces
// a parse result with nothing to decide, and counting it would put a permanent
// "needs review" badge on candidates where there is nothing to do.
// =============================================================================
import { createClient } from "@/lib/supabase/server";
import { buildFieldComparisons } from "@/lib/resumes/review";
import type { ParsedResume } from "@/lib/ai/parseResume";
import type { Candidate } from "@/lib/types";
import { describeDbError } from "@/lib/supabase/errors";

export type PendingReview = {
  resumeId: string;
  fileName: string;
  uploadedAt: string;
  /** Fields where the resume and the profile disagree. */
  conflictCount: number;
  /** Fields the resume fills in that the profile leaves blank. */
  newFieldCount: number;
};

/**
 * Unreviewed proposals for one candidate, newest first.
 *
 * Returns [] on a query failure rather than throwing: this drives a banner, and
 * a profile page that 500s because a badge could not be counted is a worse
 * outcome than a missing badge. The failure is logged.
 */
export async function listPendingReviews({
  organizationId,
  candidate,
}: {
  organizationId: string;
  candidate: Candidate;
}): Promise<PendingReview[]> {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from("resume_parse_results")
    .select("raw_json, resume:resumes!inner(id, file_name, uploaded_at, candidate_id)")
    .eq("organization_id", organizationId)
    .eq("resumes.candidate_id", candidate.id)
    .is("reviewed_at", null)
    .order("created_at", { ascending: false })
    .limit(20);

  if (error) {
    console.error("[resumes] pending review lookup failed:", describeDbError(error));
    return [];
  }

  const rows = (data ?? []) as unknown as {
    raw_json: ParsedResume;
    resume: { id: string; file_name: string; uploaded_at: string } | null;
  }[];

  const pending: PendingReview[] = [];

  for (const row of rows) {
    if (!row.resume) continue;

    const comparisons = buildFieldComparisons(candidate, row.raw_json);
    const conflictCount = comparisons.filter((c) => c.status === "conflict").length;
    const newFieldCount = comparisons.filter((c) => c.status === "new").length;

    // Nothing to decide — the resume agreed with the profile, or added nothing.
    if (conflictCount === 0 && newFieldCount === 0) continue;

    pending.push({
      resumeId: row.resume.id,
      fileName: row.resume.file_name,
      uploadedAt: row.resume.uploaded_at,
      conflictCount,
      newFieldCount,
    });
  }

  return pending;
}

/**
 * The banner sentence, or null when there is nothing to say.
 *
 * Conflicts and new fields are counted separately because they ask different
 * things of the reader: a conflict needs a decision, a new field only needs a
 * glance. Collapsing them into one number would make "3 updates" mean either
 * "three judgement calls" or "three freebies", and the reader could not tell.
 */
export function pendingReviewSummary(pending: PendingReview[]): string | null {
  if (pending.length === 0) return null;

  const conflicts = pending.reduce((total, item) => total + item.conflictCount, 0);
  const newFields = pending.reduce((total, item) => total + item.newFieldCount, 0);

  const parts: string[] = [];
  if (conflicts > 0) {
    parts.push(`${conflicts} profile ${conflicts === 1 ? "update needs" : "updates need"} your review`);
  }
  if (newFields > 0) {
    parts.push(`${newFields} new ${newFields === 1 ? "detail" : "details"} to add`);
  }

  if (parts.length === 0) return null;
  return `${parts.join(", ")} from ${pending.length === 1 ? "a recent resume" : `${pending.length} recent resumes`}.`;
}
