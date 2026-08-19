import { NextResponse, type NextRequest } from "next/server";
import { handleRouteError, jsonError } from "@/lib/api";
import { requireCurrentUser, requireRole } from "@/lib/tenant";
import { buildContext, checkIntegrations } from "@/lib/automations/engine";
import { createClient } from "@/lib/supabase/server";
import { getAutomation } from "@/lib/automations/queries";
import { evaluateConditions } from "@/lib/automations/evaluate";
import {
  checkExecutable,
  normalizeConditions,
  requiredIntegrationsFor,
  describeRule,
} from "@/lib/automations/catalog";

/**
 * POST /api/automations/:id/test — would this rule fire for this application?
 *
 * The spec's test: "a test run of an automation does not perform live actions."
 * This route does not call `dispatch()` at all. It evaluates the conditions and
 * reports the verdict; there is no code path from here to `executeAction`, so
 * "it didn't dial anyone" is a property of the file rather than of a flag being
 * passed correctly.
 *
 * It also writes no run record. A test must not consume the dedupe key — burning
 * the real run's slot would mean testing a rule permanently disables it for that
 * candidate.
 */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const [membership] = await Promise.all([
      requireRole(["owner", "admin"]),
      requireCurrentUser(),
    ]);

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return jsonError("Invalid JSON body.", 400);
    }

    const applicationId = (body as { application_id?: unknown })?.application_id;
    if (typeof applicationId !== "string" || applicationId.length === 0) {
      return jsonError("Choose an application to test against.", 400);
    }

    const automation = await getAutomation({
      organizationId: membership.organization.id,
      automationId: id,
    });
    if (!automation) return jsonError("Automation not found.", 404);

    // The tester's own session client. A test must see exactly what the caller
    // can see — running it under the service role would report that a rule
    // matches on data their session could not have read.
    const built = await buildContext({
      client: await createClient(),
      organizationId: membership.organization.id,
      applicationId,
    });
    if (!built) return jsonError("Application not found.", 404);

    const evaluation = evaluateConditions(
      normalizeConditions(automation.conditions ?? []),
      built.context
    );

    // Reported alongside the verdict rather than instead of it. "Your conditions
    // match but this rule can never run on that trigger" is two useful facts, and
    // hiding the first behind the second would send someone editing conditions
    // that were already right.
    const executable = checkExecutable({
      trigger: automation.trigger,
      actions: automation.actions ?? [],
    });

    const required =
      automation.required_integrations?.length > 0
        ? automation.required_integrations
        : requiredIntegrationsFor(automation.actions ?? []);
    const health = await checkIntegrations({
      organizationId: membership.organization.id,
      required,
    });

    return NextResponse.json({
      data: {
        wouldRun: evaluation.matched && health.ok && executable.ok,
        matched: evaluation.matched,
        blocked: !health.ok,
        blockedReason: health.ok ? null : health.reason,
        executable: executable.ok,
        executableReason: executable.ok ? null : executable.reason,
        requiresApproval: automation.requires_approval,
        reason: evaluation.reason,
        outcomes: evaluation.outcomes,
        groups: evaluation.groups,
        // What WOULD have happened, named but not done.
        wouldRunActions: automation.actions.map((action) => action.type),
        summary: describeRule({
          trigger: automation.trigger,
          conditions: automation.conditions ?? [],
          actions: automation.actions ?? [],
        }),
        executed: false,
      },
    });
  } catch (error) {
    return handleRouteError(error);
  }
}
