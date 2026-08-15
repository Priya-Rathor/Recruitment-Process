import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { handleRouteError, jsonError } from "@/lib/api";
import { requireCurrentUser, requireMembership, requireRole } from "@/lib/tenant";
import { getOrganizationSettings, parseSettingsPayload } from "@/lib/settings/queries";
import { logActivity } from "@/lib/activity/log";
import { formatDbError } from "@/lib/supabase/errors";

/**
 * GET /api/settings — the organization's operating defaults.
 *
 * Readable by any member: these are the defaults the whole team's UI renders
 * from (interview duration, default stage), and none of them is a secret.
 * Credentials live behind /api/settings/integrations with a different rule.
 */
export async function GET() {
  try {
    const membership = await requireMembership();
    const { settings, failed } = await getOrganizationSettings(membership.organization.id);

    if (failed) return jsonError("Could not load settings.", 500);

    return NextResponse.json({ data: settings, caller_role: membership.role });
  } catch (error) {
    return handleRouteError(error);
  }
}

/**
 * PATCH /api/settings — update the defaults.
 *
 * "Manage organization settings | Owner Yes | Admin Yes | Recruiter No |
 * Viewer No". Enforced here and again by the RLS policy, so a direct PostgREST
 * write by a Recruiter is refused too.
 *
 * Upsert rather than update: an organization that has never opened Settings has
 * no row, and requiring one to exist first would make the first save fail.
 */
export async function PATCH(request: NextRequest) {
  try {
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

    const parsed = parseSettingsPayload(body);
    if (!parsed.ok) return jsonError(parsed.error, 400);

    const supabase = await createClient();
    const { data, error } = await supabase
      .from("organization_settings")
      .upsert(
        { organization_id: membership.organization.id, ...parsed.data },
        { onConflict: "organization_id" }
      )
      .select("*")
      .maybeSingle();

    if (error) {
      // The tenant-integrity trigger, translated rather than leaked.
      if (error.message?.includes("not an active member")) {
        return jsonError("That recruiter isn't an active member of this team.", 400);
      }
      console.error(`[api] settings update failed: ${formatDbError(error)}`);
      return jsonError("Could not save those settings.", 400);
    }

    // Module 14. Field NAMES only — the values are already in the row, and the
    // audit log's job is to record that a change happened and who made it.
    await logActivity({
      organizationId: membership.organization.id,
      entityType: "organization",
      entityId: membership.organization.id,
      eventType: "organization.updated",
      actorId: user.id,
      actorLabel: user.name ?? user.email,
      metadata: { fields: Object.keys(parsed.data) },
    });

    return NextResponse.json({ data });
  } catch (error) {
    return handleRouteError(error);
  }
}
