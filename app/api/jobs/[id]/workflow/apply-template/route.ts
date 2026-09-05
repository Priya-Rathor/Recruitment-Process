import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { handleRouteError, jsonError } from "@/lib/api";
import { requireCurrentUser, requireRole } from "@/lib/tenant";
import { logActivity } from "@/lib/activity/log";
import { formatDbError } from "@/lib/supabase/errors";
import { applyDefaultFlow } from "@/lib/workflow/applyFlow";
import { DEFAULT_FLOW_KEY, DEFAULT_FLOW_LABEL } from "@/lib/workflow/defaultFlow";

/**
 * POST /api/jobs/:id/workflow/apply-template — pre-fill this job's stage
 * workflow from a named template.
 *
 * OWNER/ADMIN, the same bar as saving a single list. This writes several
 * automations rows plus organization-level templates and forms, so it cannot be
 * looser than the thing it is a shortcut for.
 *
 * NOT IDEMPOTENT AT THE JOB LEVEL, AND SAYS SO. Applying twice re-writes this
 * job's stage lists, discarding edits made since the last apply. The templates
 * and forms are reused rather than duplicated (see applyDefaultFlow), so the
 * wording somebody customised survives — but a stage list they rewrote does not.
 *
 * That is why `confirm` is required rather than inferred. The UI shows what will
 * be overwritten and asks; a POST without the flag is refused rather than
 * quietly doing the destructive thing.
 */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
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

    if (payload.template !== DEFAULT_FLOW_KEY) {
      return jsonError("That flow template doesn't exist.", 400);
    }

    if (payload.confirm !== true) {
      return jsonError(
        "Applying a flow replaces this job's stage actions. Confirm to continue.",
        400
      );
    }

    // Scoped to the caller's organization, and read before anything is written —
    // the same check the single-list save makes, for the same reason: the
    // automations insert policy checks the organization, not the job, so an id
    // from another tenant would otherwise satisfy RLS.
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

    const result = await applyDefaultFlow({
      organizationId: membership.organization.id,
      jobId: job.id,
      jobTitle: job.title,
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
        change: "applied_flow_template",
        template: DEFAULT_FLOW_LABEL,
        lists: result.listsSaved,
        templates_created: result.templatesCreated.length,
        forms_created: result.formsCreated.length,
      },
    });

    return NextResponse.json({
      data: {
        ...result,
        /**
         * Stated in the response rather than left to be discovered.
         *
         * The brief asks for pass/fail branches on Video Interview, and that
         * stage records a written verdict rather than a score — so it has no
         * branches to hang them on. The PASS message fires on entry to Director
         * Round, where it genuinely belongs; the FAIL one has no automatic
         * moment and is sent by a recruiter from the application. Both templates
         * exist and are editable either way.
         */
        note:
          "Video Interview records a written verdict rather than a score, so it has no " +
          "automatic pass/fail branches. The Director Round invitation fires on entry to " +
          "that stage; \"Video Interview Not Successful\" is created for you to send from " +
          "the application when you decide.",
      },
    });
  } catch (error) {
    return handleRouteError(error);
  }
}
