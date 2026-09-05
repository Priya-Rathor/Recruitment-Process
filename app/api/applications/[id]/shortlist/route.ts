import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { handleRouteError, jsonError } from "@/lib/api";
import { requireCurrentUser, requireRole } from "@/lib/tenant";
import { logActivity } from "@/lib/activity/log";
import { clearNotShortlisted } from "@/lib/workflow/shortlist";

/**
 * DELETE /api/applications/:id/shortlist — reverse an automatic screen-out.
 *
 * THE BRIEF'S HARD CONSTRAINT LIVES HERE: "A human can still manually override
 * and un-flag it if the auto-screen was wrong — this is not an irreversible
 * action."
 *
 * It is a DELETE on a sub-resource rather than a PATCH on the application,
 * because that is what it is: removing a flag, not editing the application. The
 * distinction matters for the audit trail — the timeline shows "cleared the
 * automatic Not Shortlisted flag" rather than a generic update nobody can
 * interpret two months later.
 *
 * Owner, Admin and Recruiter. A Recruiter overruling the automatic screen on
 * their own candidate is the single most likely correct use of this route; the
 * screen is a first pass, and the person working the pipeline is better placed
 * than a threshold to judge a borderline resume.
 */
export async function DELETE(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const [membership, user] = await Promise.all([
      requireRole(["owner", "admin", "recruiter"]),
      requireCurrentUser(),
    ]);

    const supabase = await createClient();

    /**
     * READ FIRST, so the response can distinguish three different situations
     * that a bare success would collapse into one:
     *
     *   - the application is not ours / does not exist  → 404
     *   - it exists and was never flagged               → 200, nothing to do
     *   - it exists and was flagged                     → 200, cleared
     *
     * The middle case matters: two recruiters clicking Reverse at once must both
     * see success, not one success and one confusing error.
     */
    const { data, error } = await supabase
      .from("applications")
      .select("id, not_shortlisted_at, not_shortlisted_score, not_shortlisted_threshold")
      .eq("organization_id", membership.organization.id)
      .eq("id", id)
      .maybeSingle();

    if (error) return jsonError("Could not read the application.", 500);
    if (!data) return jsonError("Application not found.", 404);

    const application = data as {
      not_shortlisted_at: string | null;
      not_shortlisted_score: number | null;
      not_shortlisted_threshold: number | null;
    };

    if (!application.not_shortlisted_at) {
      return NextResponse.json({ data: { cleared: false, reason: "It wasn't flagged." } });
    }

    const cleared = await clearNotShortlisted({
      client: supabase,
      organizationId: membership.organization.id,
      applicationId: id,
    });

    if (!cleared.ok) return jsonError(cleared.error, 500);

    await logActivity({
      organizationId: membership.organization.id,
      entityType: "application",
      entityId: id,
      eventType: "application.not_shortlisted_cleared",
      actorId: user.id,
      // The numbers the screen acted on, preserved in the log entry because the
      // columns holding them have just been set to null. Without this the
      // timeline would record that somebody reversed a decision but not what
      // the decision was.
      metadata: {
        score: application.not_shortlisted_score,
        threshold: application.not_shortlisted_threshold,
        flagged_at: application.not_shortlisted_at,
      },
    });

    return NextResponse.json({ data: { cleared: true } });
  } catch (error) {
    return handleRouteError(error);
  }
}
