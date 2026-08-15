import { NextResponse, type NextRequest } from "next/server";
import { handleRouteError } from "@/lib/api";
import { requireMembership } from "@/lib/tenant";
import { lookupCandidates } from "@/lib/candidates/lookup";

/**
 * GET /api/candidates/lookup?q= — typeahead by name, email or phone.
 *
 * Readable by every role, matching Module 4: a Viewer may read candidate data,
 * they simply cannot change it. The organization comes from the session, never
 * from the query string, so there is no way to search another tenant.
 */
export async function GET(request: NextRequest) {
  try {
    const membership = await requireMembership();
    const query = request.nextUrl.searchParams.get("q") ?? "";

    const candidates = await lookupCandidates({
      organizationId: membership.organization.id,
      query,
    });

    return NextResponse.json({ data: candidates });
  } catch (error) {
    return handleRouteError(error);
  }
}
