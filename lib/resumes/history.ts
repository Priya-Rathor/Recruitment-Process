// =============================================================================
// A candidate's resume history.
//
// The rule the spec states most firmly: older resumes are never deleted or
// hidden when a new one arrives. Only the "Most recent" label moves. That is
// already how the data behaves — every upload INSERTs — so this module's job is
// just to read it back in the right order and say where each file came from.
//
// SOURCE ATTRIBUTION is the part that needs work. `resumes` records who
// uploaded a file and when, but not which flow it came through. Bulk intake
// does know, in resume_intake_items.job_id, so the two are joined here rather
// than denormalising a "source" column onto resumes — a column that Module 6's
// own upload route would have to remember to set, and would eventually forget.
// =============================================================================
import { createClient } from "@/lib/supabase/server";
import { isMissingRelation } from "@/lib/dashboard/metrics";
import { listResumes, type Resume } from "@/lib/resumes/queries";
import { formatDbError } from "@/lib/supabase/errors";

export type ResumeHistoryEntry = Resume & {
  /** "Senior Java Developer" when it arrived through that job's bulk upload. */
  viaJobTitle: string | null;
  viaJobId: string | null;
  /** True for the newest entry only. */
  isMostRecent: boolean;
};

/**
 * Every resume on file for a candidate, newest first.
 *
 * Ordering comes from listResumes (uploaded_at desc), so "most recent" is the
 * first row rather than a stored flag that could disagree with the timestamps.
 */
export async function listResumeHistory({
  organizationId,
  candidateId,
}: {
  organizationId: string;
  candidateId: string;
}): Promise<ResumeHistoryEntry[]> {
  const resumes = await listResumes({ organizationId, candidateId });
  if (resumes.length === 0) return [];

  const viaJob = await loadIntakeOrigins({
    organizationId,
    resumeIds: resumes.map((resume) => resume.id),
  });

  return resumes.map((resume, index) => {
    const origin = viaJob.get(resume.id);
    return {
      ...resume,
      viaJobId: origin?.jobId ?? null,
      viaJobTitle: origin?.jobTitle ?? null,
      isMostRecent: index === 0,
    };
  });
}

/**
 * Which resumes arrived through a job's bulk upload, and which job.
 *
 * Returns an empty map if the intake table does not exist yet — this powers a
 * label, and a profile page that 500s because a caption could not be resolved
 * would be a far worse failure than a caption reading "Uploaded directly".
 */
async function loadIntakeOrigins({
  organizationId,
  resumeIds,
}: {
  organizationId: string;
  resumeIds: string[];
}): Promise<Map<string, { jobId: string; jobTitle: string | null }>> {
  const origins = new Map<string, { jobId: string; jobTitle: string | null }>();
  if (resumeIds.length === 0) return origins;

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("resume_intake_items")
    .select("resume_id, job_id, job:jobs(title)")
    .eq("organization_id", organizationId)
    .in("resume_id", resumeIds);

  if (error) {
    // Before migration 0018 there is no intake table, so nothing came through
    // bulk upload and every resume is correctly labelled "Uploaded directly".
    if (isMissingRelation(error)) return origins;
    console.error(`[resumes] intake origin lookup failed: ${formatDbError(error)}`);
    return origins;
  }

  for (const row of (data ?? []) as unknown as {
    resume_id: string | null;
    job_id: string;
    job: { title: string } | null;
  }[]) {
    if (!row.resume_id) continue;
    origins.set(row.resume_id, { jobId: row.job_id, jobTitle: row.job?.title ?? null });
  }

  return origins;
}

/**
 * The caption under a filename.
 *
 * "Uploaded directly" is the honest fallback for anything that did not come
 * through bulk intake — Module 6's own upload page, or an intake row that was
 * later deleted. It says what is known without inventing a provenance.
 */
export function describeResumeSource(entry: ResumeHistoryEntry): string {
  if (entry.viaJobTitle) return `Uploaded via ${entry.viaJobTitle} job`;
  if (entry.viaJobId) return "Uploaded via a job that has since been removed";
  return "Uploaded directly";
}

/** "1.2 MB". Null size renders as an em dash rather than "0 B". */
export function formatFileSize(bytes: number | null): string {
  if (bytes === null) return "—";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
