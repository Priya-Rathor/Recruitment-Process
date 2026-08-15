import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { handleRouteError, jsonError } from "@/lib/api";
import { requireCurrentUser, requireMembership, requireRole } from "@/lib/tenant";
import { listAutomations, type AutomationRow } from "@/lib/automations/queries";
import { requiredIntegrationsFor, validateRule } from "@/lib/automations/catalog";
import { logActivity } from "@/lib/activity/log";
import { describeDbError } from "@/lib/supabase/errors";

/** GET /api/automations — every role may see what rules exist. */
export async function GET() {
  try {
    const membership = await requireMembership();
    const { automations, failed } = await listAutomations(membership.organization.id);

    if (failed) return jsonError("Could not load automations.", 500);

    return NextResponse.json({ data: automations, caller_role: membership.role });
  } catch (error) {
    return handleRouteError(error);
  }
}

/**
 * POST /api/automations — create a rule.
 *
 * Owner/Admin only (spec section 9: "Create/edit automations — Recruiter: No").
 * The RLS policy enforces the same thing, so a Recruiter writing directly via
 * PostgREST is refused too.
 *
 * ALWAYS CREATES A DRAFT. `status` is not read from the body at all: activation
 * is a separate PATCH, which is what keeps an AI-drafted rule from going live
 * the moment it is saved.
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

    const payload = (body ?? {}) as Record<string, unknown>;

    const name = typeof payload.name === "string" ? payload.name.trim() : "";
    if (name.length === 0) return jsonError("Give the automation a name.", 400);
    if (name.length > 120) return jsonError("That name is too long.", 400);

    const validated = validateRule({
      trigger: payload.trigger,
      conditions: payload.conditions,
      actions: payload.actions,
    });
    if (!validated.ok) return jsonError(validated.error, 400);

    const supabase = await createClient();
    const { data, error } = await supabase
      .from("automations")
      .insert({
        organization_id: membership.organization.id,
        name,
        description:
          typeof payload.description === "string" ? payload.description.trim().slice(0, 500) : null,
        trigger: validated.rule.trigger,
        conditions: validated.rule.conditions,
        actions: validated.rule.actions,
        // Never from the body.
        status: "draft",
        required_integrations: requiredIntegrationsFor(validated.rule.actions),
        drafted_by_ai: payload.drafted_by_ai === true,
        created_by: user.id,
      })
      .select("*")
      .single();

    if (error) {
      if ((error as { code?: string }).code === "23505") {
        return jsonError("An automation with that name already exists.", 409);
      }
      console.error("[api] automation create failed:", describeDbError(error));
      return jsonError("Could not create the automation.", 400);
    }

    // Module 14. Sensitive: a rule that acts on candidates unattended is a
    // settings change, and drafted_by_ai is recorded so "did a human write this
    // one?" stays answerable long after the fact.
    const automation = data as unknown as AutomationRow;
    await logActivity({
      organizationId: membership.organization.id,
      entityType: "automation",
      entityId: automation.id,
      eventType: "automation.created",
      actorId: user.id,
      actorLabel: user.name ?? user.email,
      metadata: { name: automation.name, drafted_by_ai: automation.drafted_by_ai },
    });

    return NextResponse.json({ data: automation }, { status: 201 });
  } catch (error) {
    return handleRouteError(error);
  }
}
