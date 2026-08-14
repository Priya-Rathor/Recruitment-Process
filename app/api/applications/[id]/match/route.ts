import { NextResponse, type NextRequest } from "next/server";
import { handleRouteError, jsonError } from "@/lib/api";
import { hasRole, requireMembership, requireRole } from "@/lib/tenant";
import { calculateAndStoreMatch, getOrCalculateMatch } from "@/lib/matching/queries";

// The deterministic pass is instant; the semantic call is a normal LLM request.
export const maxDuration = 60;

/**
 * GET /api/applications/:id/match — the current match.
 *
 * Calculates on demand when absent or stale. Staleness is set by a database
 * trigger only when the candidate or job data actually changed, so this is one
 * calculation per real change rather than one per page view (cost model rule).
 *
 * Viewable by every role, but a Viewer never triggers a calculation — they see
 * whatever exists, or nothing.
 */
export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const membership = await requireMembership();

    const { match, calculated } = await getOrCalculateMatch({
      organizationId: membership.organization.id,
      applicationId: id,
      allowCalculate: hasRole(membership.role, ["owner", "admin", "recruiter"]),
    });

    if (!match) {
      return NextResponse.json(
        {
          data: null,
          message: hasRole(membership.role, ["owner", "admin", "recruiter"])
            ? "No match could be calculated for this application."
            : "No match has been calculated yet. Ask a recruiter to run one.",
        },
        { status: 200 }
      );
    }

    return NextResponse.json({ data: match, calculated });
  } catch (error) {
    return handleRouteError(error);
  }
}

/**
 * POST /api/applications/:id/match — force a recalculation.
 *
 * "Trigger manual recalculation" is Owner/Admin/Recruiter; Viewer denied, so a
 * read-only user cannot spend the organization's AI budget.
 */
export async function POST(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const membership = await requireRole(["owner", "admin", "recruiter"]);

    const result = await calculateAndStoreMatch({
      organizationId: membership.organization.id,
      applicationId: id,
    });

    if (!result.ok) {
      return jsonError(result.error, result.error.includes("not found") ? 404 : 400);
    }

    // TODO(Module 14): log this AI call at summary level to activity_events.
    return NextResponse.json({
      data: result.match,
      // Surfaced rather than hidden: a deterministic-only score is a different
      // claim from a full one, and the recruiter should know which they have.
      aiError: result.aiError,
    });
  } catch (error) {
    return handleRouteError(error);
  }
}
