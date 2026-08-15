import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { handleRouteError, jsonError } from "@/lib/api";
import { requireCurrentUser, requireMembership, requireRole } from "@/lib/tenant";
import { getAutomation, type AutomationRow } from "@/lib/automations/queries";
import {
  requiredIntegrationsFor,
  validateRule,
  TRIGGER_AVAILABILITY,
} from "@/lib/automations/catalog";
import { checkIntegrations } from "@/lib/automations/engine";
import { logActivity } from "@/lib/activity/log";
import { formatDbError } from "@/lib/supabase/errors";

/** GET /api/automations/:id */
export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const membership = await requireMembership();

    const automation = await getAutomation({
      organizationId: membership.organization.id,
      automationId: id,
    });
    if (!automation) return jsonError("Automation not found.", 404);

    return NextResponse.json({ data: automation, caller_role: membership.role });
  } catch (error) {
    return handleRouteError(error);
  }
}

/**
 * PATCH /api/automations/:id — edit, activate, or pause.
 *
 * ACTIVATION IS THE INTERESTING CASE.
 *
 * The spec's test: "an automation cannot be activated if a required integration
 * is disconnected." Checking it here gives a readable reason. The database also
 * refuses an activation with no `activated_by`, so a direct PostgREST write
 * cannot produce an anonymous live rule — but it cannot check Bolna's health,
 * which is why both layers exist.
 *
 * Editing an ACTIVE rule silently changes what the product does to candidates
 * without anyone re-approving it, so a structural edit sends the rule back to
 * draft. Renaming does not.
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

    const existing = await getAutomation({
      organizationId: membership.organization.id,
      automationId: id,
    });
    if (!existing) return jsonError("Automation not found.", 404);

    const updates: Record<string, unknown> = {};

    if (typeof payload.name === "string") {
      const name = payload.name.trim();
      if (name.length === 0) return jsonError("Give the automation a name.", 400);
      updates.name = name.slice(0, 120);
    }

    if ("description" in payload) {
      updates.description =
        typeof payload.description === "string" ? payload.description.trim().slice(0, 500) : null;
    }

    // A structural edit — the parts that decide what actually happens.
    const structural = "trigger" in payload || "conditions" in payload || "actions" in payload;
    if (structural) {
      const validated = validateRule({
        trigger: payload.trigger ?? existing.trigger,
        conditions: payload.conditions ?? existing.conditions,
        actions: payload.actions ?? existing.actions,
      });
      if (!validated.ok) return jsonError(validated.error, 400);

      updates.trigger = validated.rule.trigger;
      updates.conditions = validated.rule.conditions;
      updates.actions = validated.rule.actions;
      updates.required_integrations = requiredIntegrationsFor(validated.rule.actions);

      // Back to draft, unless this same request re-activates it deliberately.
      if (existing.status === "active" && payload.status !== "active") {
        updates.status = "draft";
        updates.activated_by = null;
        updates.activated_at = null;
      }
    }

    if ("status" in payload) {
      const status = payload.status;
      if (status !== "draft" && status !== "active" && status !== "paused") {
        return jsonError("Invalid status.", 400);
      }

      if (status === "active") {
        // Refuse to activate a rule on a trigger nothing dispatches yet. An
        // "active" rule that can never fire is a false statement about what the
        // product is doing.
        const trigger = (updates.trigger ?? existing.trigger) as keyof typeof TRIGGER_AVAILABILITY;
        const availability = TRIGGER_AVAILABILITY[trigger];
        if (availability && !availability.available) {
          return NextResponse.json(
            { error: availability.note ?? "That trigger isn't available yet.", code: "trigger_unavailable" },
            { status: 409 }
          );
        }

        const actions = (updates.actions ?? existing.actions) as AutomationRow["actions"];
        const required =
          (updates.required_integrations as string[] | undefined) ??
          requiredIntegrationsFor(actions);

        const health = await checkIntegrations({
          organizationId: membership.organization.id,
          required,
        });
        if (!health.ok) {
          return NextResponse.json(
            { error: health.reason, code: "integration_disconnected" },
            { status: 409 }
          );
        }

        updates.status = "active";
        updates.activated_by = user.id;
        updates.activated_at = new Date().toISOString();
      } else {
        // draft or paused — clear the activation record, so re-activating always
        // names whoever turned it back on rather than the last person to do so.
        updates.status = status;
        updates.activated_by = null;
        updates.activated_at = null;
      }
    }

    if (Object.keys(updates).length === 0) {
      return jsonError("No valid fields provided.", 400);
    }

    const supabase = await createClient();
    const { data, error } = await supabase
      .from("automations")
      .update(updates)
      .eq("id", id)
      .eq("organization_id", membership.organization.id)
      .select("*")
      .maybeSingle();

    if (error) {
      if ((error as { code?: string }).code === "23505") {
        return jsonError("An automation with that name already exists.", 409);
      }
      console.error(`[api] automation update failed: ${formatDbError(error)}`);
      return jsonError("Could not update the automation.", 400);
    }
    if (!data) return jsonError("Automation not found.", 404);

    // Module 14. Activation is the event that matters: it is the moment a rule
    // starts acting on people. Logged only on a real status transition, so
    // re-saving an active rule does not fill the audit log with noise.
    const saved = data as unknown as AutomationRow;
    if (updates.status && updates.status !== existing.status) {
      const eventType =
        updates.status === "active"
          ? "automation.activated"
          : ("automation.paused" as const);
      await logActivity({
        organizationId: membership.organization.id,
        entityType: "automation",
        entityId: id,
        eventType,
        actorId: user.id,
        actorLabel: user.name ?? user.email,
        metadata: { name: saved.name, from: existing.status, to: updates.status as string },
      });
    }

    return NextResponse.json({ data: saved });
  } catch (error) {
    return handleRouteError(error);
  }
}

/**
 * DELETE /api/automations/:id.
 *
 * A real delete, unlike applications and candidates: a rule is configuration,
 * not a record of something that happened to a person. Its run history survives
 * — `automation_runs.automation_id` cascades, so the history goes with it, which
 * is why the UI offers Pause as the safer default and warns here.
 */
export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const membership = await requireRole(["owner", "admin"]);

    // Loaded before the delete: once the row is gone there is nothing left to
    // name in the audit event, and its run history goes with it.
    const existing = await getAutomation({
      organizationId: membership.organization.id,
      automationId: id,
    });
    if (!existing) return jsonError("Automation not found.", 404);

    const supabase = await createClient();

    const { data, error } = await supabase
      .from("automations")
      .delete()
      .eq("id", id)
      .eq("organization_id", membership.organization.id)
      .select("id")
      .maybeSingle();

    if (error) {
      console.error(`[api] automation delete failed: ${formatDbError(error)}`);
      return jsonError("Could not delete the automation.", 400);
    }
    if (!data) return jsonError("Automation not found.", 404);

    // Module 14. Deleting a rule cascades its run history away, so this event is
    // the only remaining evidence the rule ever existed. Its name is kept for
    // exactly that reason.
    const actor = await requireCurrentUser();
    await logActivity({
      organizationId: membership.organization.id,
      entityType: "automation",
      entityId: id,
      eventType: "automation.deleted",
      actorId: actor.id,
      actorLabel: actor.name ?? actor.email,
      metadata: { name: existing.name, status: existing.status },
    });

    return NextResponse.json({ data });
  } catch (error) {
    return handleRouteError(error);
  }
}
