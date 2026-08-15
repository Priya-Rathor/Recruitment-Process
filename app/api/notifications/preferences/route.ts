import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { handleRouteError, jsonError } from "@/lib/api";
import { hasRole, requireCurrentUser, requireMembership } from "@/lib/tenant";
import { getPreferences } from "@/lib/notifications/queries";
import { isNotificationType, TEMPLATES } from "@/lib/notifications/templates";
import { formatDbError } from "@/lib/supabase/errors";

/** GET /api/notifications/preferences — every type, resolved for this caller. */
export async function GET() {
  try {
    const [membership, user] = await Promise.all([requireMembership(), requireCurrentUser()]);

    const { preferences, failed } = await getPreferences({
      organizationId: membership.organization.id,
      userId: user.id,
    });

    if (failed) return jsonError("Could not load notification settings.", 500);

    return NextResponse.json({ data: preferences, caller_role: membership.role });
  } catch (error) {
    return handleRouteError(error);
  }
}

/**
 * PUT /api/notifications/preferences — save one setting.
 *
 * `scope: "organization"` writes the default and is Owner/Admin only, per
 * section 9. `scope: "user"` writes the caller's own override and is open to
 * everyone — a Viewer choosing not to be emailed is not a permission.
 *
 * The RLS policy enforces both halves independently, including in WITH CHECK, so
 * a Recruiter cannot take their personal row and null its user_id to make it
 * organization-wide. This check exists for the readable error.
 */
export async function PUT(request: NextRequest) {
  try {
    const [membership, user] = await Promise.all([requireMembership(), requireCurrentUser()]);

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return jsonError("Invalid JSON body.", 400);
    }

    const payload = (body ?? {}) as Record<string, unknown>;

    if (!isNotificationType(payload.type)) {
      return jsonError("Unknown notification type.", 400);
    }

    const scope = payload.scope;
    if (scope !== "organization" && scope !== "user") {
      return jsonError("Scope must be 'organization' or 'user'.", 400);
    }

    if (scope === "organization" && !hasRole(membership.role, ["owner", "admin"])) {
      return jsonError("Only an Owner or Admin can change organization defaults.", 403);
    }

    const inApp = payload.in_app_enabled;
    const email = payload.email_enabled;

    if (typeof inApp !== "boolean" || typeof email !== "boolean") {
      return jsonError("Both channels must be specified.", 400);
    }

    // In-app cannot be muted for a high-priority type. Enforced in
    // applyMandatoryChannels() at send time regardless, but refusing the write
    // means the settings screen never shows a switch that silently does nothing.
    if (!inApp && TEMPLATES[payload.type].priority === "high") {
      return jsonError(
        `In-app alerts can't be turned off for "${TEMPLATES[payload.type].label}" — it's how the team finds out something needs a person.`,
        400
      );
    }

    const supabase = await createClient();
    const { data, error } = await supabase
      .from("notification_preferences")
      .upsert(
        {
          organization_id: membership.organization.id,
          user_id: scope === "organization" ? null : user.id,
          notification_type: payload.type,
          in_app_enabled: inApp,
          email_enabled: email,
        },
        {
          onConflict:
            scope === "organization"
              ? "organization_id,notification_type"
              : "organization_id,user_id,notification_type",
        }
      )
      .select("id, user_id, notification_type, in_app_enabled, email_enabled")
      .maybeSingle();

    if (error) {
      console.error(`[api] preference save failed: ${formatDbError(error)}`);
      return jsonError("Could not save that setting.", 400);
    }

    return NextResponse.json({ data });
  } catch (error) {
    return handleRouteError(error);
  }
}

/**
 * DELETE /api/notifications/preferences?type= — clear a personal override.
 *
 * Distinct from setting it to match the default: deleting means "follow whatever
 * the organization decides from now on", which is a different and useful choice.
 */
export async function DELETE(request: NextRequest) {
  try {
    const [membership, user] = await Promise.all([requireMembership(), requireCurrentUser()]);

    const type = request.nextUrl.searchParams.get("type");
    if (!isNotificationType(type)) return jsonError("Unknown notification type.", 400);

    const supabase = await createClient();
    const { error } = await supabase
      .from("notification_preferences")
      .delete()
      .eq("organization_id", membership.organization.id)
      .eq("user_id", user.id)
      .eq("notification_type", type);

    if (error) {
      console.error(`[api] preference clear failed: ${formatDbError(error)}`);
      return jsonError("Could not reset that setting.", 400);
    }

    return NextResponse.json({ data: { type, reset: true } });
  } catch (error) {
    return handleRouteError(error);
  }
}
