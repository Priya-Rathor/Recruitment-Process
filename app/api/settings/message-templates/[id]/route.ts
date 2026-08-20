import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { handleRouteError, jsonError } from "@/lib/api";
import { requireCurrentUser, requireRole } from "@/lib/tenant";
import { validateTemplate } from "@/lib/communications/templates";
import { describeTemplateConflict } from "@/lib/communications/conflicts";
import { logActivity } from "@/lib/activity/log";
import { formatDbError } from "@/lib/supabase/errors";

/**
 * PATCH /api/settings/message-templates/:id — edit, or switch on and off.
 *
 * TWO SHAPES, ON PURPOSE.
 *
 * A body of exactly `{ active: boolean }` is the list's toggle: it flips the
 * switch without requiring the caller to round-trip the whole template. Anything
 * else is a full save and is validated in full.
 *
 * The narrow shape matters because the toggle is the single most-used control on
 * the page, and making it re-post a body it never read would mean a stale editor
 * tab could silently revert somebody else's wording.
 */
export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
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
    const supabase = await createClient();

    const { data: existing } = await supabase
      .from("message_templates")
      .select("id, name, event_key, active")
      .eq("id", id)
      .eq("organization_id", membership.organization.id)
      .maybeSingle();

    // Another organization's row resolves to null, so a guessed id looks exactly
    // like a missing one.
    if (!existing) return jsonError("Template not found.", 404);
    const current = existing as unknown as {
      name: string;
      event_key: string;
      active: boolean;
    };

    const toggleOnly =
      Object.keys(payload).length === 1 && typeof payload.active === "boolean";

    if (toggleOnly) {
      const active = payload.active as boolean;

      const { data, error } = await supabase
        .from("message_templates")
        .update({ active })
        .eq("id", id)
        .eq("organization_id", membership.organization.id)
        .select("*")
        .maybeSingle();

      if (error) {
        const conflict = await describeTemplateConflict({
          error,
          organizationId: membership.organization.id,
          eventKey: current.event_key,
          name: current.name,
          excludeId: id,
        });
        if (conflict) return jsonError(conflict, 409);

        console.error(`[api] template toggle failed: ${formatDbError(error)}`);
        return jsonError("Could not change that template.", 400);
      }
      if (!data) return jsonError("Template not found.", 404);

      // Logged as its own thing. Switching a template on is the moment it starts
      // messaging candidates unattended, which is a different kind of change from
      // fixing a typo — see the describe() in lib/activity/events.ts.
      await logActivity({
        organizationId: membership.organization.id,
        entityType: "message_template",
        entityId: id,
        eventType: "message_template.updated",
        actorId: user.id,
        actorLabel: user.name ?? user.email,
        metadata: { name: current.name, event_key: current.event_key, active },
      });

      return NextResponse.json({ data });
    }

    const parsed = validateTemplate(payload);
    if (!parsed.ok) return jsonError(parsed.error, 422);

    const { data, error } = await supabase
      .from("message_templates")
      .update(parsed.data)
      .eq("id", id)
      .eq("organization_id", membership.organization.id)
      .select("*")
      .maybeSingle();

    if (error) {
      const conflict = await describeTemplateConflict({
        error,
        organizationId: membership.organization.id,
        eventKey: parsed.data.event_key,
        name: parsed.data.name,
        excludeId: id,
      });
      if (conflict) return jsonError(conflict, 409);

      console.error(`[api] template update failed: ${formatDbError(error)}`);
      return jsonError("Could not save that template.", 400);
    }
    if (!data) return jsonError("Template not found.", 404);

    await logActivity({
      organizationId: membership.organization.id,
      entityType: "message_template",
      entityId: id,
      eventType: "message_template.updated",
      actorId: user.id,
      actorLabel: user.name ?? user.email,
      // Field NAMES only. The values are in the row, and the audit log's job is
      // to record that a change happened and who made it.
      metadata: {
        name: parsed.data.name,
        event_key: parsed.data.event_key,
        fields: Object.keys(parsed.data),
      },
    });

    return NextResponse.json({ data, warnings: parsed.warnings });
  } catch (error) {
    return handleRouteError(error);
  }
}

/**
 * DELETE /api/settings/message-templates/:id — a real delete.
 *
 * Unlike an application or a candidate, a template carries no history: the
 * messages it sent hold their own resolved text in message_log, and
 * `template_id` is ON DELETE SET NULL. So deleting one loses the words for future
 * sends and nothing else — the log stays complete and accurate, which is exactly
 * why body_sent exists.
 *
 * An ACTIVE template is refused. Deleting the thing that is currently messaging
 * candidates should be two decisions, not one, and "switch it off first" makes the
 * pause observable before it is permanent.
 */
export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const [membership, user] = await Promise.all([
      requireRole(["owner", "admin"]),
      requireCurrentUser(),
    ]);

    const supabase = await createClient();

    const { data: existing } = await supabase
      .from("message_templates")
      .select("id, name, active")
      .eq("id", id)
      .eq("organization_id", membership.organization.id)
      .maybeSingle();

    if (!existing) return jsonError("Template not found.", 404);
    const current = existing as unknown as { name: string; active: boolean };

    if (current.active) {
      return jsonError(
        `"${current.name}" is active and sending automatically. Switch it off before deleting it.`,
        409
      );
    }

    const { error } = await supabase
      .from("message_templates")
      .delete()
      .eq("id", id)
      .eq("organization_id", membership.organization.id);

    if (error) {
      console.error(`[api] template delete failed: ${formatDbError(error)}`);
      return jsonError("Could not delete that template.", 400);
    }

    await logActivity({
      organizationId: membership.organization.id,
      entityType: "message_template",
      entityId: id,
      eventType: "message_template.deleted",
      actorId: user.id,
      actorLabel: user.name ?? user.email,
      metadata: { name: current.name },
    });

    return NextResponse.json({ data: { id, deleted: true } });
  } catch (error) {
    return handleRouteError(error);
  }
}
