import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { handleRouteError, jsonError } from "@/lib/api";
import { requireCurrentUser, requireMembership, requireRole } from "@/lib/tenant";
import { logActivity } from "@/lib/activity/log";
import { formatDbError } from "@/lib/supabase/errors";

/**
 * Guards :id against the caller's server-resolved tenant. A valid-looking id
 * belonging to another organization is treated as not found, so the endpoint
 * never confirms the existence of another tenant's records.
 */
async function assertOwnOrganization(id: string) {
  const membership = await requireMembership();
  if (membership.organization.id !== id) {
    return null;
  }
  return membership;
}

/** GET /api/organizations/:id */
export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const membership = await assertOwnOrganization(id);
    if (!membership) return jsonError("Organization not found.", 404);

    return NextResponse.json({ data: { ...membership.organization, role: membership.role } });
  } catch (error) {
    return handleRouteError(error);
  }
}

/**
 * PATCH /api/organizations/:id — Owner/Admin only (spec section 9:
 * organization settings are not Recruiter/Viewer editable).
 */
export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const membership = await requireRole(["owner", "admin"]);
    if (membership.organization.id !== id) return jsonError("Organization not found.", 404);

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return jsonError("Invalid JSON body.", 400);
    }

    const payload = (body ?? {}) as Record<string, unknown>;
    const updates: Record<string, string | null> = {};

    // Allowlist — anything else in the payload (id, created_at, ...) is ignored.
    for (const field of ["name", "industry", "size", "country", "timezone"] as const) {
      if (field in payload) {
        const value = payload[field];
        if (value === null) {
          if (field === "name" || field === "timezone") {
            return jsonError(`${field} cannot be empty.`, 400);
          }
          updates[field] = null;
        } else if (typeof value === "string") {
          const trimmed = value.trim();
          if ((field === "name" || field === "timezone") && trimmed.length === 0) {
            return jsonError(`${field} cannot be empty.`, 400);
          }
          updates[field] = trimmed.length > 0 ? trimmed.slice(0, 120) : null;
        } else {
          return jsonError(`${field} must be a string.`, 400);
        }
      }
    }

    if (Object.keys(updates).length === 0) {
      return jsonError("No updatable fields provided.", 400);
    }

    const supabase = await createClient();
    const { data, error } = await supabase
      .from("organizations")
      .update(updates)
      .eq("id", id)
      .select()
      .maybeSingle();

    if (error) {
      console.error(`[api] organization update failed: ${formatDbError(error)}`);
      return jsonError("Could not update the organization.", 400);
    }
    if (!data) return jsonError("Organization not found.", 404);

    // Module 14. Field NAMES only, never the values: this payload can carry the
    // organization's identity details, and the audit log's job is to record that
    // a change happened and who made it, not to accumulate a second copy of the
    // data. The organization row itself holds the current values.
    const actor = await requireCurrentUser();
    await logActivity({
      organizationId: id,
      entityType: "organization",
      entityId: id,
      eventType: "organization.updated",
      actorId: actor.id,
      actorLabel: actor.name ?? actor.email,
      metadata: { fields: Object.keys(updates) },
    });

    return NextResponse.json({ data });
  } catch (error) {
    return handleRouteError(error);
  }
}

/**
 * DELETE /api/organizations/:id
 * Deliberately not implemented at MVP. Deleting a tenant cascades across every
 * later module's data and is a compliance-relevant action (see the Privacy &
 * Compliance chapter's erasure requirements) — it needs an explicit, audited
 * flow, not a generic REST verb. Returning 405 rather than silently succeeding.
 */
export async function DELETE() {
  return jsonError(
    "Deleting an organization is not supported yet. Contact support to close a workspace.",
    405
  );
}
