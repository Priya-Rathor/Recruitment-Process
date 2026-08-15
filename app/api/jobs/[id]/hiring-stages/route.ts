import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { handleRouteError, jsonError } from "@/lib/api";
import { requireCurrentUser, requireMembership, requireRole } from "@/lib/tenant";
import { parseStagesPayload } from "@/lib/hiring-stages/config";
import { listJobStages } from "@/lib/hiring-stages/queries";
import { logActivity } from "@/lib/activity/log";
import { formatDbError } from "@/lib/supabase/errors";

/**
 * GET /api/jobs/:id/hiring-stages — all four stages, configured or not.
 *
 * Readable by every role. The spec is explicit that a Viewer "can see which
 * stages are enabled and view (not edit) their configuration".
 */
export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const membership = await requireMembership();

    const supabase = await createClient();
    const { data: job } = await supabase
      .from("jobs")
      .select("id")
      .eq("id", id)
      .eq("organization_id", membership.organization.id)
      .maybeSingle();

    if (!job) return jsonError("Job not found.", 404);

    const stages = await listJobStages({ organizationId: membership.organization.id, jobId: id });
    return NextResponse.json({ data: stages, caller_role: membership.role });
  } catch (error) {
    return handleRouteError(error);
  }
}

/**
 * PUT /api/jobs/:id/hiring-stages — save one or more stages.
 *
 * UPSERT, NEVER DELETE. A stage switched off keeps its row, its script and its
 * config, because the spec requires re-enabling to restore what was there.
 * Deleting on disable would silently discard a script someone spent ten minutes
 * writing, and they would find out only after turning it back on.
 *
 * Owner/Admin/Recruiter, matching every other write in Module 3. RLS enforces
 * it again — the browser holds a PostgREST client, so a Viewer can POST
 * straight to /rest/v1/job_hiring_stages without passing through here.
 */
export async function PUT(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const [membership, user] = await Promise.all([
      requireRole(["owner", "admin", "recruiter"]),
      requireCurrentUser(),
    ]);

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return jsonError("Invalid JSON body.", 400);
    }

    const parsed = parseStagesPayload(body);
    if (!parsed.ok) return jsonError(parsed.error, 400);

    const supabase = await createClient();

    // Tenancy checked before any write. A job in another organization resolves
    // to null, so a guessed id is indistinguishable from a missing one.
    const { data: job } = await supabase
      .from("jobs")
      .select("id, title")
      .eq("id", id)
      .eq("organization_id", membership.organization.id)
      .maybeSingle();

    if (!job) return jsonError("Job not found.", 404);

    const { error } = await supabase.from("job_hiring_stages").upsert(
      parsed.stages.map((stage) => ({
        job_id: id,
        organization_id: membership.organization.id,
        stage_key: stage.stageKey,
        enabled: stage.enabled,
        prompt_template: stage.promptTemplate,
        config: stage.config,
        updated_by: user.id,
      })),
      { onConflict: "job_id,stage_key" }
    );

    if (error) {
      if (error.message?.includes("does not belong to this organization")) {
        return jsonError("Job not found.", 404);
      }
      console.error(`[api] saving hiring stages failed: ${formatDbError(error)}`);
      return jsonError("Could not save the hiring stages.", 400);
    }

    // Module 14. One event for the change as a whole, listing which stages are
    // on — "who turned screening on for this job?" is the question asked after
    // a candidate gets an unexpected call.
    await logActivity({
      organizationId: membership.organization.id,
      entityType: "job",
      entityId: id,
      eventType: "job.updated",
      actorId: membership.user_id,
      actorLabel: user.name ?? user.email,
      metadata: {
        change: "hiring_stages",
        enabled: parsed.stages.filter((s) => s.enabled).map((s) => s.stageKey),
        disabled: parsed.stages.filter((s) => !s.enabled).map((s) => s.stageKey),
      },
    });

    const stages = await listJobStages({ organizationId: membership.organization.id, jobId: id });
    return NextResponse.json({ data: stages });
  } catch (error) {
    return handleRouteError(error);
  }
}
