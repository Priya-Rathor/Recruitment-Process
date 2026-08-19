import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { handleRouteError, jsonError } from "@/lib/api";
import { requireCurrentUser, requireRole } from "@/lib/tenant";
import { logActivity } from "@/lib/activity/log";
import { formatDbError } from "@/lib/supabase/errors";

/**
 * PATCH /api/automations/switch — the organization-wide kill switch.
 *
 * Owner/Admin. Sets organizations.automations_enabled, which the engine reads
 * before it loads a single rule, so switching off takes effect on the very next
 * trigger rather than after eight rules have been paused by hand.
 *
 * WHAT IT DELIBERATELY DOES NOT DO: it does not pause the rules. Their status is
 * untouched, so switching back on restores exactly the set that was live —
 * including which ones an Admin had deliberately left paused. Flipping every rule
 * to paused and back would silently reactivate those.
 *
 * The switch is stored on `organizations`, whose UPDATE policy is already
 * Owner/Admin (migration 0001), so a direct PostgREST write is held to the same
 * line as this route.
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

    const enabled = (body as Record<string, unknown>)?.enabled;
    if (typeof enabled !== "boolean") {
      return jsonError("Send { enabled: true } or { enabled: false }.", 400);
    }

    const supabase = await createClient();
    const { data, error } = await supabase
      .from("organizations")
      .update({ automations_enabled: enabled })
      .eq("id", membership.organization.id)
      .select("automations_enabled")
      .maybeSingle();

    if (error) {
      console.error(`[api] automation switch failed: ${formatDbError(error)}`);
      return jsonError("Could not change that setting.", 400);
    }
    if (!data) return jsonError("Organization not found.", 404);

    // Sensitive by the catalogue's own rule: this changes what the product does
    // to candidates organization-wide, and "who turned automation off on the 4th?"
    // must have an answer.
    await logActivity({
      organizationId: membership.organization.id,
      entityType: "organization",
      entityId: membership.organization.id,
      eventType: "organization.updated",
      actorId: user.id,
      actorLabel: user.name ?? user.email,
      metadata: {
        fields: [enabled ? "automations switched on" : "automations switched off"],
      },
    });

    return NextResponse.json({ data });
  } catch (error) {
    return handleRouteError(error);
  }
}
