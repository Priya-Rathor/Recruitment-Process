// =============================================================================
// One onboarding record — status and assignment.
//
// THE COMPLETION GATE IS RE-CHECKED HERE, not trusted from the client. The
// button is disabled in the UI, but a disabled button is a courtesy; this is the
// check. It reads the documents fresh rather than accepting a count in the body.
//
// There is no POST. A record is created by trg_applications_create_onboarding
// when an application enters Hired, and by nothing else — see migration 0026.
// =============================================================================
import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { handleRouteError, jsonError } from "@/lib/api";
import { hasRole, requireCurrentUser, requireMembership, requireRole } from "@/lib/tenant";
import { logActivity } from "@/lib/activity/log";
import { getOnboardingDetail } from "@/lib/onboarding/queries";
import { blockerSummary, completionCheck, isOnboardingStatus } from "@/lib/onboarding/documents";
import { formatDbError } from "@/lib/supabase/errors";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const membership = await requireMembership();

    const detail = await getOnboardingDetail({
      organizationId: membership.organization.id,
      recordId: id,
    });
    // Another organization's record resolves to null, so a guessed id looks
    // exactly like a missing one.
    if (!detail) return jsonError("Onboarding record not found.", 404);

    return NextResponse.json({ data: detail, caller_role: membership.role });
  } catch (error) {
    return handleRouteError(error);
  }
}

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const membership = await requireRole(["owner", "admin", "recruiter"]);

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return jsonError("Invalid JSON body.", 400);
    }

    const raw = (body ?? {}) as Record<string, unknown>;

    const detail = await getOnboardingDetail({
      organizationId: membership.organization.id,
      recordId: id,
    });
    if (!detail) return jsonError("Onboarding record not found.", 404);

    // Mirrors can_manage_onboarding() in the database, for a readable error
    // instead of an empty-result 404 from a policy refusal.
    const isAdmin = hasRole(membership.role, ["owner", "admin"]);
    const canManage =
      isAdmin || detail.assigned_to === null || detail.assigned_to === membership.user_id;

    if (!canManage) {
      return jsonError(
        "This hire's onboarding is assigned to someone else. An Owner or Admin can reassign it.",
        403
      );
    }

    const updates: Record<string, unknown> = {};

    if ("status" in raw) {
      if (!isOnboardingStatus(raw.status)) return jsonError("Invalid onboarding status.", 400);

      if (raw.status === "completed") {
        // THE GATE. Read from the documents themselves, every time.
        const check = completionCheck(detail.documents);
        if (!check.canComplete) {
          return jsonError(
            `Onboarding can't be completed yet. ${blockerSummary(check.blockers)}`,
            409
          );
        }
        updates.completed_at = new Date().toISOString();
      } else {
        // Re-opening a completed record clears the date. The CHECK constraint
        // would refuse the row otherwise, and it is right to: a record that is
        // in progress with a completion date is a lie either way round.
        updates.completed_at = null;
      }

      updates.status = raw.status;
    }

    if ("assigned_to" in raw) {
      // Reassignment is an Owner/Admin decision. A recruiter handing their own
      // record to a colleague — or quietly taking someone else's — is a
      // workload change somebody should have agreed to.
      if (!isAdmin) {
        return jsonError("Only an Owner or Admin can reassign onboarding.", 403);
      }

      const assignee = raw.assigned_to;
      if (assignee === null) {
        updates.assigned_to = null;
      } else if (typeof assignee === "string" && UUID_PATTERN.test(assignee)) {
        const supabase = await createClient();
        const { data: member } = await supabase
          .from("organization_members")
          .select("user_id")
          .eq("organization_id", membership.organization.id)
          .eq("user_id", assignee)
          .eq("status", "active")
          .maybeSingle();

        if (!member) return jsonError("That person is not a member of this team.", 400);
        updates.assigned_to = assignee;
      } else {
        return jsonError("Invalid assignee.", 400);
      }
    }

    if (Object.keys(updates).length === 0) return jsonError("No valid fields provided.", 400);

    const supabase = await createClient();
    const { data, error } = await supabase
      .from("onboarding_records")
      .update(updates)
      .eq("id", id)
      .eq("organization_id", membership.organization.id)
      .select("id, status, completed_at, assigned_to")
      .maybeSingle();

    if (error) {
      console.error(`[onboarding] record update failed: ${formatDbError(error)}`);
      return jsonError("Could not save that change.", 400);
    }
    if (!data) return jsonError("Onboarding record not found.", 404);

    const actor = await requireCurrentUser();
    await logActivity({
      organizationId: membership.organization.id,
      entityType: "application",
      // Recorded against the APPLICATION, so the hire's own timeline shows the
      // onboarding milestones alongside the stage history that caused them.
      entityId: detail.application_id,
      eventType: "onboarding.updated",
      actorId: actor.id,
      actorLabel: actor.name ?? actor.email,
      metadata: {
        onboarding_id: id,
        ...("status" in updates ? { status: updates.status as string } : {}),
        ...("assigned_to" in updates
          ? { assigned_to: (updates.assigned_to as string) ?? null }
          : {}),
      },
    });

    return NextResponse.json({ data });
  } catch (error) {
    return handleRouteError(error);
  }
}
