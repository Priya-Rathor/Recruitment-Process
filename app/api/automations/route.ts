import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { resolveTemplatedMessageActions } from "@/lib/communications/ruleActions";
import { handleRouteError, jsonError } from "@/lib/api";
import { requireCurrentUser, requireMembership, requireRole } from "@/lib/tenant";
import { listAutomations, type AutomationRow } from "@/lib/automations/queries";
import {
  approvalIsMandatory,
  approvalIsRecommended,
  requiredIntegrationsFor,
  validateRule,
} from "@/lib/automations/catalog";
import { getTemplate } from "@/lib/automations/templates";
import { logActivity } from "@/lib/activity/log";
import { formatDbError } from "@/lib/supabase/errors";

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
 *
 * A `template` id seeds the rule from lib/automations/templates.ts. The template
 * is read SERVER-SIDE by id, never taken as a rule from the body — otherwise
 * "template" would just be a second, unvalidated way to post a rule. It still
 * lands as a draft like everything else.
 *
 * APPROVAL CAN BE FORCED ON BUT NEVER OFF. `approvalIsMandatory()` decides, from
 * the actions, whether a human must see the proposal first; a client asking for
 * requires_approval: false on a rule that emails candidates is overruled rather
 * than refused, because the answer to "may I skip the review?" is no regardless
 * of how the rule was built.
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

    // A template supplies the rule; the body may still override the name.
    const template =
      typeof payload.template === "string" ? getTemplate(payload.template) : null;
    if (typeof payload.template === "string" && !template) {
      return jsonError("That template doesn't exist.", 400);
    }

    const name =
      typeof payload.name === "string" && payload.name.trim().length > 0
        ? payload.name.trim()
        : (template?.name ?? "");
    if (name.length === 0) return jsonError("Give the automation a name.", 400);
    if (name.length > 120) return jsonError("That name is too long.", 400);

    const validated = validateRule(
      template
        ? {
            trigger: template.trigger,
            conditions: template.conditions,
            actions: template.actions,
          }
        : {
            trigger: payload.trigger,
            conditions: payload.conditions,
            actions: payload.actions,
          }
    );
    if (!validated.ok) return jsonError(validated.error, 400);

    /**
     * MODULE 15 — verify any named message template belongs to us, and take its
     * event_key and channels from the row rather than from the request body.
     * See resolveTemplatedMessageActions().
     */
    const resolvedActions = await resolveTemplatedMessageActions({
      organizationId: membership.organization.id,
      actions: validated.rule.actions,
    });
    if (!resolvedActions.ok) return jsonError(resolvedActions.error, 422);
    validated.rule.actions = resolvedActions.actions;

    // Null means uncapped, which is a real choice. Anything non-numeric or
    // non-positive is a mistake and is refused rather than silently uncapped.
    let dailyRunCap: number | null = template?.dailyRunCap ?? null;
    if ("daily_run_cap" in payload) {
      const raw = payload.daily_run_cap;
      if (raw === null) {
        dailyRunCap = null;
      } else if (typeof raw === "number" && Number.isInteger(raw) && raw > 0) {
        dailyRunCap = Math.min(raw, 10_000);
      } else {
        return jsonError("A daily limit must be a whole number above zero, or empty.", 400);
      }
    }

    const requiresApproval =
      approvalIsMandatory(validated.rule.actions) ||
      payload.requires_approval === true ||
      template?.requiresApproval === true ||
      /**
       * "Send templated message" DEFAULTS approval on, and unlike the built-in
       * candidate email it can be switched back off — the wording it sends was
       * already written and deliberately activated by an Owner or Admin, so the
       * human review has happened once, over the words. See
       * APPROVAL_RECOMMENDED_ACTIONS.
       *
       * Only defaulted when the client did not say. An explicit `false` from
       * somebody who read the words is respected, which is the difference between
       * a default and a rule.
       */
      (!("requires_approval" in payload) && approvalIsRecommended(validated.rule.actions));

    const supabase = await createClient();
    const { data, error } = await supabase
      .from("automations")
      .insert({
        organization_id: membership.organization.id,
        name,
        description:
          typeof payload.description === "string"
            ? payload.description.trim().slice(0, 500)
            : (template?.note ?? null),
        trigger: validated.rule.trigger,
        conditions: validated.rule.conditions,
        actions: validated.rule.actions,
        // Never from the body.
        status: "draft",
        required_integrations: requiredIntegrationsFor(validated.rule.actions),
        drafted_by_ai: payload.drafted_by_ai === true,
        requires_approval: requiresApproval,
        daily_run_cap: dailyRunCap,
        created_by: user.id,
      })
      .select("*")
      .single();

    if (error) {
      if ((error as { code?: string }).code === "23505") {
        return jsonError("An automation with that name already exists.", 409);
      }
      console.error(`[api] automation create failed: ${formatDbError(error)}`);
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
      metadata: {
        name: automation.name,
        drafted_by_ai: automation.drafted_by_ai,
        from_template: template?.id ?? undefined,
        requires_approval: automation.requires_approval,
      },
    });

    return NextResponse.json({ data: automation }, { status: 201 });
  } catch (error) {
    return handleRouteError(error);
  }
}
