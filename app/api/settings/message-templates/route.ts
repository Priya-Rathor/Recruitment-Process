import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { handleRouteError, jsonError } from "@/lib/api";
import { requireCurrentUser, requireMembership, requireRole } from "@/lib/tenant";
import { listMessageTemplates } from "@/lib/communications/queries";
import { validateTemplate } from "@/lib/communications/templates";
import { describeTemplateConflict } from "@/lib/communications/conflicts";
import { logActivity } from "@/lib/activity/log";
import { formatDbError } from "@/lib/supabase/errors";

/**
 * GET /api/settings/message-templates — the library.
 *
 * EVERY MEMBER READS, matching the RLS policy. "Templates: Owner/Admin manage;
 * Recruiter/Viewer read-only" — and a Recruiter composing a manual message picks
 * from this list, so hiding it would break the send screen for the role that
 * uses it most.
 */
export async function GET() {
  try {
    const membership = await requireMembership();
    const { templates, failed } = await listMessageTemplates(membership.organization.id);

    if (failed) return jsonError("Could not load the message templates.", 500);

    return NextResponse.json({ data: templates, caller_role: membership.role });
  } catch (error) {
    return handleRouteError(error);
  }
}

/**
 * POST /api/settings/message-templates — create one.
 *
 * Owner/Admin only, in the route AND in the policy. A template's body becomes an
 * automatic message sent in the organization's name, so the rule cannot live only
 * here: the browser holds an authenticated PostgREST client and could write
 * directly (see AGENTS.md).
 */
export async function POST(request: NextRequest) {
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

    const parsed = validateTemplate(body);
    if (!parsed.ok) return jsonError(parsed.error, 422);

    const supabase = await createClient();
    const { data, error } = await supabase
      .from("message_templates")
      .insert({
        organization_id: membership.organization.id,
        ...parsed.data,
        created_by: user.id,
      })
      .select("*")
      .single();

    if (error) {
      const conflict = await describeTemplateConflict({
        error,
        organizationId: membership.organization.id,
        eventKey: parsed.data.event_key,
        name: parsed.data.name,
      });
      if (conflict) return jsonError(conflict, 409);

      console.error(`[api] message template create failed: ${formatDbError(error)}`);
      return jsonError("Could not save that template.", 400);
    }

    await logActivity({
      organizationId: membership.organization.id,
      entityType: "message_template",
      entityId: (data as { id: string }).id,
      eventType: "message_template.created",
      actorId: user.id,
      actorLabel: user.name ?? user.email,
      metadata: {
        name: parsed.data.name,
        event_key: parsed.data.event_key,
        channel: parsed.data.channel,
        active: parsed.data.active,
      },
    });

    // Warnings ride alongside a SUCCESS. An unrecognised token does not block the
    // save (see validateTemplate) but the author needs to see it, and a 4xx would
    // throw their work away over a typo.
    return NextResponse.json({ data, warnings: parsed.warnings }, { status: 201 });
  } catch (error) {
    return handleRouteError(error);
  }
}
