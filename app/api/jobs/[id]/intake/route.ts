import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { handleRouteError, jsonError } from "@/lib/api";
import { requireCurrentUser, requireMembership, requireRole } from "@/lib/tenant";
import { getJobDetail } from "@/lib/jobs/queries";
import { RESUME_UPLOAD_REJECTION, hashFile, isAllowedResumeUpload } from "@/lib/resumes/extract";
import { processIntakeFile } from "@/lib/intake/process";
import { listBatchItems } from "@/lib/intake/queries";
import { describeDbError } from "@/lib/supabase/errors";

/** Mirrors the resumes bucket's file_size_limit. */
const MAX_FILE_BYTES = 10 * 1024 * 1024;

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Extraction plus an AI call plus up to four writes. The default serverless
// budget is far too short for a real resume.
export const maxDuration = 120;

/**
 * GET /api/jobs/:id/intake?batch_id=... — the state of one upload batch.
 *
 * Exists so the modal can be closed and reopened without losing what happened,
 * which is what makes "Done" safe to leave unblocked while files are still
 * processing. Readable by every role, like the rest of the job's data.
 */
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const membership = await requireMembership();

    const batchId = request.nextUrl.searchParams.get("batch_id");
    if (!batchId || !UUID_PATTERN.test(batchId)) {
      return jsonError("A batch id is required.", 400);
    }

    const items = await listBatchItems({
      organizationId: membership.organization.id,
      batchId,
    });

    // Items are already tenant-scoped by the query; this filters a batch id that
    // happens to exist under this org but belongs to a different job.
    return NextResponse.json({ data: items.filter((item) => item.job_id === id) });
  } catch (error) {
    return handleRouteError(error);
  }
}

/**
 * POST /api/jobs/:id/intake — process ONE resume for this job (multipart).
 *
 * One file per request, not a batch per request. Three reasons, all of which
 * the spec asks for directly:
 *
 *   - "every file resolves independently" is structural rather than promised:
 *     a failure here cannot touch a sibling, because siblings are other HTTP
 *     requests.
 *   - the modal gets live per-file status without inventing a polling protocol.
 *   - a retry is the same call again, so there is no second code path that
 *     could drift from the first.
 *
 * Owner/Admin/Recruiter — the same roles that may create a candidate or an
 * application anywhere else. requireRole throws TenantError, which
 * handleRouteError turns into a 403, so a Viewer calling this directly with
 * curl is refused regardless of what the UI showed them. RLS refuses them a
 * second time at every insert.
 */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const [membership, user] = await Promise.all([
      requireRole(["owner", "admin", "recruiter"]),
      requireCurrentUser(),
    ]);

    const job = await getJobDetail({ organizationId: membership.organization.id, jobId: id });
    // A job in another organization resolves to null, so a guessed id is
    // indistinguishable from a missing one.
    if (!job) return jsonError("Job not found.", 404);
    if (job.archived_at) {
      return jsonError("This job is archived. Restore it before adding candidates.", 409);
    }

    let formData: FormData;
    try {
      formData = await request.formData();
    } catch {
      return jsonError("Upload a file.", 400);
    }

    const file = formData.get("file");
    if (!(file instanceof File) || file.size === 0) {
      return jsonError("Choose a resume file to upload.", 400);
    }
    if (file.size > MAX_FILE_BYTES) {
      return jsonError("That file is larger than 10 MB.", 400);
    }

    const batchIdRaw = formData.get("batch_id");
    const batchId =
      typeof batchIdRaw === "string" && UUID_PATTERN.test(batchIdRaw)
        ? batchIdRaw
        : crypto.randomUUID();

    const supabase = await createClient();

    /** Records the outcome so it survives the modal being closed. */
    const record = async (fields: Record<string, unknown>) => {
      const { data, error } = await supabase
        .from("resume_intake_items")
        .insert({
          organization_id: membership.organization.id,
          batch_id: batchId,
          job_id: id,
          file_name: file.name.slice(-200),
          file_size_bytes: file.size,
          created_by: user.id,
          processed_at: new Date().toISOString(),
          ...fields,
        })
        .select(
          "id, batch_id, job_id, file_name, file_size_bytes, status, candidate_id, " +
            "application_id, resume_id, conflict_candidate_ids, queued_conflict_count, " +
            "error_message, created_at, processed_at"
        )
        .single();

      if (error) {
        console.error("[api] intake item record failed:", describeDbError(error));
        return null;
      }
      return data as unknown as Record<string, unknown>;
    };

    // An unsupported type is a per-file failure, not a request error: in a drop
    // of thirty files the other twenty-nine must still run, and the row has to
    // appear in the list so the recruiter can see WHICH file was rejected.
    // The same allowlist the file picker uses, enforced again here. The client
    // check is for speed; this one is the rule — a direct POST bypasses the UI
    // entirely.
    if (!isAllowedResumeUpload(file.name, file.type || null)) {
      const item = await record({
        status: "failed",
        error_message: `${RESUME_UPLOAD_REJECTION}.`,
      });
      return NextResponse.json({ data: item, batch_id: batchId }, { status: 200 });
    }

    const buffer = await file.arrayBuffer();
    const fileHash = await hashFile(buffer);

    let outcome;
    try {
      outcome = await processIntakeFile({
        organizationId: membership.organization.id,
        organizationName: membership.organization.name,
        jobId: id,
        actorId: user.id,
        actorLabel: user.name ?? user.email,
        file: { name: file.name, type: file.type || null, buffer },
        fileHash,
        webhookUrl: `${request.nextUrl.origin}/api/webhooks/bolna`,
      });
    } catch (processError) {
      // A genuine bug or a database outage. Recorded as a failed row rather than
      // a 500, so the batch keeps its shape and the file can be retried.
      console.error("[api] intake processing threw:", processError);
      const item = await record({
        status: "failed",
        error_message: "Something went wrong processing this file. Try it again.",
      });
      return NextResponse.json({ data: item, batch_id: batchId }, { status: 200 });
    }

    const item = await record({
      status: outcome.status,
      candidate_id: outcome.candidateId,
      application_id: outcome.applicationId,
      resume_id: outcome.resumeId,
      conflict_candidate_ids: outcome.conflictCandidateIds,
      queued_conflict_count: outcome.queuedConflictCount,
      error_message: outcome.errorMessage,
      storage_path: outcome.storagePath,
      file_hash: fileHash,
      parsed_json: outcome.status === "match_conflict" ? outcome.parsed : null,
    });

    return NextResponse.json(
      {
        data: item
          ? { ...item, candidate_name: outcome.candidateName }
          : // The work succeeded but the bookkeeping row did not. Report the
            // real outcome rather than a failure the recruiter would retry —
            // retrying would find the application already there anyway.
            {
              id: crypto.randomUUID(),
              batch_id: batchId,
              job_id: id,
              file_name: file.name,
              file_size_bytes: file.size,
              status: outcome.status,
              candidate_id: outcome.candidateId,
              candidate_name: outcome.candidateName,
              application_id: outcome.applicationId,
              resume_id: outcome.resumeId,
              conflict_candidate_ids: outcome.conflictCandidateIds,
              queued_conflict_count: outcome.queuedConflictCount,
              error_message: outcome.errorMessage,
              created_at: new Date().toISOString(),
              processed_at: new Date().toISOString(),
            },
        batch_id: batchId,
      },
      { status: 200 }
    );
  } catch (error) {
    return handleRouteError(error);
  }
}
