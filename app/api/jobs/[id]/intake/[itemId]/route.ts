import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { handleRouteError, jsonError } from "@/lib/api";
import { requireCurrentUser, requireRole } from "@/lib/tenant";
import { reconnectIntakeItem, type IntakeItemRow } from "@/lib/intake/reconnect";
import { getJobDetail } from "@/lib/jobs/queries";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Moves a storage object, deletes rows, and may run automations.
export const maxDuration = 60;

const ITEM_COLUMNS =
  "id, job_id, status, candidate_id, application_id, resume_id, storage_path, " +
  "parsed_json, file_name, file_size_bytes, file_hash, auto_candidate_id, auto_status";

/**
 * PATCH /api/jobs/:id/intake/:itemId — connect this file to a chosen candidate.
 *
 * The manual override for automatic matching. Available on ANY row in ANY
 * state, which the spec is explicit about: a wrongly created candidate and a
 * wrongly matched one both need correcting, not just the ambiguous case the
 * matcher declined to decide.
 *
 * Owner/Admin/Recruiter. This deletes candidate and application records, so the
 * role check matters more here than anywhere else in the feature — and RLS
 * enforces it again on every table touched, including the DELETE policy added
 * in migration 0019.
 */
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; itemId: string }> }
) {
  try {
    const { id, itemId } = await params;
    const [membership, user] = await Promise.all([
      requireRole(["owner", "admin", "recruiter"]),
      requireCurrentUser(),
    ]);

    if (!UUID_PATTERN.test(itemId)) return jsonError("Unknown upload.", 400);

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return jsonError("Invalid JSON body.", 400);
    }

    const candidateId = (body as Record<string, unknown>)?.candidate_id;
    if (typeof candidateId !== "string" || !UUID_PATTERN.test(candidateId)) {
      return jsonError("Choose a candidate to connect this resume to.", 400);
    }

    const job = await getJobDetail({ organizationId: membership.organization.id, jobId: id });
    if (!job) return jsonError("Job not found.", 404);

    const supabase = await createClient();
    const { data: itemRow } = await supabase
      .from("resume_intake_items")
      .select(ITEM_COLUMNS)
      .eq("organization_id", membership.organization.id)
      .eq("id", itemId)
      .eq("job_id", id)
      .maybeSingle();

    if (!itemRow) return jsonError("That upload could not be found.", 404);

    const result = await reconnectIntakeItem({
      organizationId: membership.organization.id,
      organizationName: membership.organization.name,
      item: itemRow as unknown as IntakeItemRow,
      targetCandidateId: candidateId,
      actorId: user.id,
      actorLabel: user.name ?? user.email,
      webhookUrl: `${request.nextUrl.origin}/api/webhooks/bolna`,
    });

    if (!result.ok) return jsonError(result.error, result.status);

    return NextResponse.json({
      data: {
        id: itemId,
        status: "manually_connected",
        candidate_id: result.candidateId,
        candidate_name: result.candidateName,
        application_id: result.applicationId,
        resume_id: result.resumeId,
        queued_conflict_count: result.queuedConflictCount,
        cleanup_action: result.cleanupAction,
        removed_candidate_name: result.removedCandidateName,
      },
    });
  } catch (error) {
    return handleRouteError(error);
  }
}
