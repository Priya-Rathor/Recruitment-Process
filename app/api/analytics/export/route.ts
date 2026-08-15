import { type NextRequest } from "next/server";
import { handleRouteError, jsonError } from "@/lib/api";
import { requireCurrentUser, requireMembership } from "@/lib/tenant";
import { filtersFromParams, resolvePeriods } from "@/lib/analytics/filters";
import { buildReport } from "@/lib/analytics/report";
import { canExport } from "@/lib/analytics/queries";
import { exportFilename, reportToCsv } from "@/lib/analytics/csv";
import { getSlaConfig } from "@/lib/pipeline/queries";
import { resolveTimeZone } from "@/lib/time";
import { logActivity } from "@/lib/activity/log";

export const maxDuration = 60;

/**
 * GET /api/analytics/export — the filtered report as CSV.
 *
 * Built from the SAME buildReport() the screen uses, with the same filters, so
 * the spec's "CSV export matches on-screen filtered results exactly" holds by
 * construction rather than by two implementations agreeing.
 *
 * "CSV export | Owner Yes | Admin Yes | Recruiter Yes (own scope) | Viewer No".
 * A Viewer is refused here; a Recruiter's own-scope restriction is applied
 * inside the query layer, so their export contains exactly what their screen
 * does — they cannot widen it by calling this endpoint directly.
 */
export async function GET(request: NextRequest) {
  try {
    const [membership, user] = await Promise.all([requireMembership(), requireCurrentUser()]);

    if (!canExport(membership.role)) {
      return jsonError("Your role can view analytics but not export them.", 403);
    }

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

    const csv = reportToCsv({
      report,
      filters,
      periods,
      organizationName: membership.organization.name,
      timeZone,
      generatedAt: new Date(),
    });

    // Module 14. An export takes organizational data out of the product, so who
    // took what, and when, is exactly the sort of thing the audit log is for.
    await logActivity({
      organizationId: membership.organization.id,
      entityType: "organization",
      entityId: membership.organization.id,
      eventType: "analytics.exported",
      actorId: user.id,
      actorLabel: user.name ?? user.email,
      metadata: {
        range: filters.range,
        job_id: filters.jobId,
        client_id: filters.clientId,
        recruiter_id: filters.recruiterId,
      },
    });

    return new Response(csv, {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="${exportFilename({
          organizationName: membership.organization.name,
          periods,
        })}"`,
        // An export is a point-in-time snapshot; a cached one shown later would
        // be a stale report wearing a current date.
        "Cache-Control": "no-store",
      },
    });
  } catch (error) {
    return handleRouteError(error);
  }
}
