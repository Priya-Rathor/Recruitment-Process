import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { handleRouteError, jsonError } from "@/lib/api";
import { requireCurrentUser, requireMembership, requireRole } from "@/lib/tenant";
import { logActivity } from "@/lib/activity/log";
import { formatDbError } from "@/lib/supabase/errors";
import { loadJobWorkflow, saveStageWorkflow } from "@/lib/workflow/queries";
import { isApplicationStage } from "@/lib/applications/stages";
import { isWorkflowBranch } from "@/lib/workflow/stages";

/**
 * GET /api/jobs/:id/workflow — every stage's action lists for this job.
 *
 * Any member may look. Reading which emails a pipeline sends is not privileged
 * information within an organization, and a Viewer who cannot see it cannot
 * answer "why did this candidate get that message?" — which is most of what a
 * Viewer is for.
 */
export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const membership = await requireMembership();

    const workflow = await loadJobWorkflow({
      organizationId: membership.organization.id,
      jobId: id,
    });

    if (workflow.failed) return jsonError("Could not load this job's stage workflows.", 500);

    return NextResponse.json({ data: workflow, caller_role: membership.role });
  } catch (error) {
    return handleRouteError(error);
  }
}

/**
 * PUT /api/jobs/:id/workflow — save one stage + branch list.
 *
 * OWNER/ADMIN ONLY, matching Module 13's "Create/edit automations — Recruiter:
 * No". This builder writes automations rows, so letting a Recruiter save here
 * would be a second door into a permission Module 13 closed — and the RLS policy
 * on `automations` would refuse the write anyway, producing a confusing error
 * instead of a clear one.
 *
 * ONE LIST PER REQUEST, deliberately. A whole-job save would have to be atomic
 * across up to eleven rows, and a partial failure would leave a job half
 * configured with no way for the UI to say which half. Saving a list at a time
 * means every failure names exactly one stage.
 */
export async function PUT(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const [membership, user] = await Promise.all([
      requireRole(["owner", "admin"]),
      requireCurrentUser(),
    ]);

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return jsonError("Invalid JSON body.", 400);
    }

    const payload = (body ?? {}) as Record<string, unknown>;

    if (!isApplicationStage(payload.stage)) return jsonError("Choose a valid stage.", 400);
    if (!isWorkflowBranch(payload.branch)) return jsonError("Choose a valid branch.", 400);

    /**
     * THE JOB IS READ BEFORE ANYTHING IS WRITTEN, and scoped to the caller's
     * organization.
     *
     * Not a formality. `saveStageWorkflow` writes `job_id` from the URL, and the
     * `automations` insert policy checks the ORGANIZATION, not the job — so
     * without this a member of org A could attach a workflow to org B's job id,
     * and it would satisfy RLS. The title is needed for the rule's name anyway,
     * which is why this costs nothing.
     */
    const supabase = await createClient();
    const { data: jobRow, error: jobError } = await supabase
      .from("jobs")
      .select("id, title")
      .eq("organization_id", membership.organization.id)
      .eq("id", id)
      .maybeSingle();

    if (jobError) return jsonError(formatDbError(jobError), 500);
    if (!jobRow) return jsonError("Job not found.", 404);

    const job = jobRow as { id: string; title: string };

    const result = await saveStageWorkflow({
      organizationId: membership.organization.id,
      jobId: job.id,
      jobTitle: job.title,
      stage: payload.stage,
      branch: payload.branch,
      actions: payload.actions,
      // Absent means draft. A client that forgets the flag gets the safe
      // outcome — saved but not live — rather than an accidental activation.
      activate: payload.activate === true,
      userId: membership.user_id,
    });

    if (!result.ok) return jsonError(result.error, result.status);

    await logActivity({
      organizationId: membership.organization.id,
      entityType: "job",
      entityId: job.id,
      eventType: "job.updated",
      actorId: user.id,
      metadata: {
        change: "stage_workflow",
        stage: payload.stage,
        branch: payload.branch,
        removed: result.deleted,
        activated: payload.activate === true,
      },
    });

    return NextResponse.json({ data: { automationId: result.automationId, deleted: result.deleted } });
  } catch (error) {
    return handleRouteError(error);
  }
}
