import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { handleRouteError, jsonError } from "@/lib/api";
import { requireCurrentUser, requireRole } from "@/lib/tenant";
import { logActivity } from "@/lib/activity/log";
import { isOrgRole, type OrgRole } from "@/lib/types";
import { formatDbError } from "@/lib/supabase/errors";

type TargetMember = { id: string; user_id: string; role: OrgRole; status: string };

/** Loads the target member, scoped to the caller's own organization. */
async function loadTarget(memberId: string, organizationId: string) {
  const supabase = await createClient();
  const { data } = await supabase
    .from("organization_members")
    .select("id, user_id, role, status")
    .eq("id", memberId)
    .eq("organization_id", organizationId)
    .maybeSingle();
  return (data as TargetMember | null) ?? null;
}

/**
 * The database enforces "at least one active Owner" via a constraint trigger,
 * which is the real guarantee (the checks below race, and direct PostgREST
 * writes skip this file entirely). When that trigger fires, translate it into
 * the same actionable message rather than a generic failure.
 */
function isLastOwnerViolation(error: { message?: string } | null) {
  return Boolean(error?.message?.includes("at least one active Owner"));
}

const LAST_OWNER_MESSAGE =
  "This is the only Owner. Promote another member to Owner first.";

/** Count of remaining active Owners — used to prevent orphaning a workspace. */
async function countActiveOwners(organizationId: string) {
  const supabase = await createClient();
  const { count } = await supabase
    .from("organization_members")
    .select("id", { count: "exact", head: true })
    .eq("organization_id", organizationId)
    .eq("role", "owner")
    .eq("status", "active");
  return count ?? 0;
}

/**
 * PATCH /api/members/:id — change a member's role. Owner/Admin only.
 *
 * Escalation guards: only an Owner may grant or revoke Owner. An organization
 * can never be left with zero active Owners.
 */
export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const membership = await requireRole(["owner", "admin"]);

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return jsonError("Invalid JSON body.", 400);
    }

    const nextRole = (body as Record<string, unknown> | null)?.role;
    if (!isOrgRole(nextRole)) return jsonError("Select a valid role.", 400);

    const target = await loadTarget(id, membership.organization.id);
    if (!target || target.status !== "active") return jsonError("Team member not found.", 404);

    if (target.role === nextRole) {
      return NextResponse.json({ data: target, changed: false });
    }

    if (membership.role !== "owner" && (nextRole === "owner" || target.role === "owner")) {
      return jsonError("Only an Owner can change Owner access.", 403);
    }

    if (target.role === "owner" && (await countActiveOwners(membership.organization.id)) <= 1) {
      return jsonError(LAST_OWNER_MESSAGE, 409);
    }

    const supabase = await createClient();
    const { data, error } = await supabase
      .from("organization_members")
      .update({ role: nextRole })
      .eq("id", id)
      .eq("organization_id", membership.organization.id)
      .select("id, role, status, joined_at")
      .maybeSingle();

    if (error) {
      if (isLastOwnerViolation(error)) return jsonError(LAST_OWNER_MESSAGE, 409);
      console.error(`[api] member role update failed: ${formatDbError(error)}`);
      return jsonError("Could not update this member's role.", 400);
    }
    if (!data) return jsonError("Team member not found.", 404);

    // Module 14. A role change is the most security-sensitive thing this
    // product does, so it is logged with both the old and the new role — "was
    // promoted to Owner" is only meaningful next to what they were before.
    const actor = await requireCurrentUser();
    await logActivity({
      organizationId: membership.organization.id,
      entityType: "member",
      entityId: id,
      eventType: "member.role_changed",
      actorId: actor.id,
      actorLabel: actor.name ?? actor.email,
      metadata: { from: target.role, to: nextRole, member_user_id: target.user_id },
    });

    // Role changes take effect on the next request: getCurrentMembership()
    // re-reads organization_members every time, with no cached role anywhere.
    return NextResponse.json({ data, changed: true });
  } catch (error) {
    return handleRouteError(error);
  }
}

/**
 * DELETE /api/members/:id — remove a member (soft: status -> 'removed', so the
 * audit trail and any records that reference this member survive).
 * Owner/Admin only.
 */
export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const membership = await requireRole(["owner", "admin"]);

    const target = await loadTarget(id, membership.organization.id);
    if (!target || target.status !== "active") return jsonError("Team member not found.", 404);

    if (membership.role !== "owner" && target.role === "owner") {
      return jsonError("Only an Owner can remove another Owner.", 403);
    }

    if (target.role === "owner" && (await countActiveOwners(membership.organization.id)) <= 1) {
      return jsonError(LAST_OWNER_MESSAGE, 409);
    }

    const supabase = await createClient();
    const { data, error } = await supabase
      .from("organization_members")
      .update({ status: "removed" })
      .eq("id", id)
      .eq("organization_id", membership.organization.id)
      .select("id, role, status")
      .maybeSingle();

    if (error) {
      if (isLastOwnerViolation(error)) return jsonError(LAST_OWNER_MESSAGE, 409);
      console.error(`[api] member removal failed: ${formatDbError(error)}`);
      return jsonError("Could not remove this team member.", 400);
    }
    if (!data) return jsonError("Team member not found.", 404);

    // Module 14.
    const actor = await requireCurrentUser();
    await logActivity({
      organizationId: membership.organization.id,
      entityType: "member",
      entityId: id,
      eventType: "member.removed",
      actorId: actor.id,
      actorLabel: actor.name ?? actor.email,
      metadata: { role: target.role, member_user_id: target.user_id },
    });

    return NextResponse.json({ data });
  } catch (error) {
    return handleRouteError(error);
  }
}
