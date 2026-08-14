import { NextResponse, type NextRequest } from "next/server";
import { handleRouteError } from "@/lib/api";
import { requireCurrentUser, requireMembership, requireRole } from "@/lib/tenant";
import {
  generateReportForApplication,
  getReportForApplication,
} from "@/lib/screening/reportQueries";
import { dispatch } from "@/lib/automations/engine";

export const maxDuration = 60;

/** GET — the report for this application. Viewable by all four roles. */
export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const membership = await requireMembership();

    const report = await getReportForApplication({
      organizationId: membership.organization.id,
      applicationId: id,
    });

    return NextResponse.json({ data: report, caller_role: membership.role });
  } catch (error) {
    return handleRouteError(error);
  }
}

/**
 * POST — generate (or regenerate) the report from the latest completed call.
 *
 * Owner/Admin/Recruiter only: generating costs an AI call, and the result is
 * something a recruiter is then accountable for reviewing.
 */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const membership = await requireRole(["owner", "admin", "recruiter"]);

    const result = await generateReportForApplication({
      organizationId: membership.organization.id,
      applicationId: id,
    });

    if (!result.ok) {
      // 409 for "this call isn't eligible" — a state, not a bad request. The
      // consent case in particular must be legible, not a generic failure.
      const stateCodes = ["no_consent", "not_completed", "no_transcript", "no_call"];
      const status = stateCodes.includes(result.code ?? "")
        ? 409
        : result.code === "invalid_output"
          ? 422
          : result.code === "not_configured" || result.code === "provider_error"
            ? 503
            : 400;

      return NextResponse.json({ error: result.error, code: result.code }, { status });
    }

    // Module 13. Wrapped: the report exists and is worth returning even if a
    // downstream rule fails.
    try {
      const user = await requireCurrentUser();
      await dispatch({
        organizationId: membership.organization.id,
        organizationName: membership.organization.name,
        applicationId: id,
        trigger: "screening_report_created",
        triggeredBy: user.id,
        webhookUrl: `${request.nextUrl.origin}/api/webhooks/bolna`,
      });
    } catch (automationError) {
      console.error("[api] automations after report generation failed:", automationError);
    }

    return NextResponse.json({ data: { id: result.reportId } }, { status: 201 });
  } catch (error) {
    return handleRouteError(error);
  }
}
