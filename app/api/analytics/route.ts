import { NextResponse, type NextRequest } from "next/server";
import { handleRouteError } from "@/lib/api";
import { requireCurrentUser, requireMembership } from "@/lib/tenant";
import { filtersFromParams, resolvePeriods } from "@/lib/analytics/filters";
import { buildReport } from "@/lib/analytics/report";
import { getSlaConfig } from "@/lib/pipeline/queries";
import { resolveTimeZone } from "@/lib/time";

// Several aggregate queries, doubled when comparing periods.
export const maxDuration = 60;

/**
 * GET /api/analytics — the full report as JSON.
 *
 * Filters: ?range= ?job_id= ?client_id= ?recruiter_id= ?source= ?compare=
 *
 * All four roles may read; the query layer scopes a Recruiter to their own work
 * and returns nothing for recruiter comparisons. There is no organization_id
 * parameter — it comes from the session, and the analytics_* views additionally
 * run with security_invoker so the caller's own RLS applies.
 */
export async function GET(request: NextRequest) {
  try {
    const [membership, user] = await Promise.all([requireMembership(), requireCurrentUser()]);

    const filters = filtersFromParams(request.nextUrl.searchParams);
    const timeZone = resolveTimeZone(membership.organization.timezone);
    const periods = resolvePeriods({ range: filters.range, timeZone });
    const slaConfig = await getSlaConfig(membership.organization.id);

    const report = await buildReport({
      organizationId: membership.organization.id,
      periods,
      filters,
      role: membership.role,
      viewerId: user.id,
      slaConfig,
    });

    return NextResponse.json({
      data: report,
      meta: {
        range: filters.range,
        timezone: timeZone,
        period: { start: periods.current.startIso, end: periods.current.endIso },
        caller_role: membership.role,
      },
    });
  } catch (error) {
    return handleRouteError(error);
  }
}

/**
 * The spec's section 6 lists POST/PATCH/DELETE /api/analytics-reporting. None
 * exist: this module owns no writable entity. It reads six views over other
 * modules' tables, and an endpoint that wrote to an analytics view would either
 * fail (views over aggregates are not updatable) or corrupt the operational data
 * the views summarise. Documented in docs/modules/16-analytics-notes.md.
 */
