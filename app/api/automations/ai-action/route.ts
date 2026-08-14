import { NextResponse, type NextRequest } from "next/server";
import { handleRouteError, jsonError } from "@/lib/api";
import { requireRole } from "@/lib/tenant";
import { draftAutomationRule } from "@/lib/ai/draftAutomationRule";
import { listAutomations } from "@/lib/automations/queries";

export const maxDuration = 45;

/**
 * POST /api/automations/ai-action — draft a rule from a description.
 *
 * THIS ENDPOINT WRITES NOTHING.
 *
 * It returns a proposal. Saving it is a separate POST /api/automations, which
 * always creates a draft, and activating it is a separate PATCH by a named user.
 * Three deliberate steps between "the model suggested this" and "this runs
 * against real candidates" — the spec's "AI suggests automations; humans approve
 * them", made structural.
 *
 * Owner/Admin only, matching who may create a rule at all. There is no point
 * drafting one for someone who cannot save it, and it would spend AI budget.
 */
export async function POST(request: NextRequest) {
  try {
    const membership = await requireRole(["owner", "admin"]);

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return jsonError("Invalid JSON body.", 400);
    }

    const description = (body as { description?: unknown })?.description;
    if (typeof description !== "string" || description.trim().length === 0) {
      return jsonError("Describe the workflow you want to automate.", 400);
    }

    const { automations } = await listAutomations(membership.organization.id);

    const result = await draftAutomationRule({
      description,
      existingRuleNames: automations.map((automation) => automation.name),
    });

    if (!result.ok) {
      // 503 for "AI is unavailable", 422 for "AI answered but unusably" — the
      // UI needs to tell those apart, because only one is worth retrying.
      const status = result.code === "not_configured" || result.code === "provider_error" ? 503 : 422;
      return NextResponse.json({ error: result.message, code: result.code }, { status });
    }

    return NextResponse.json({
      data: result.data,
      // Stated explicitly so the client cannot treat this as a save.
      saved: false,
    });
  } catch (error) {
    return handleRouteError(error);
  }
}
