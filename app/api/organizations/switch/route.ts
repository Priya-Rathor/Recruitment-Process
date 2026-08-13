import { NextResponse, type NextRequest } from "next/server";
import { handleRouteError, jsonError } from "@/lib/api";
import { ACTIVE_ORG_COOKIE, getUserMemberships, requireCurrentUser } from "@/lib/tenant";

/**
 * POST /api/organizations/switch
 *
 * Sets the caller's active organization. The requested id is validated against
 * the caller's real memberships before the cookie is written — a user cannot
 * switch into a tenant they do not belong to, and even if the cookie were
 * forged, getCurrentMembership() re-validates it on every request.
 */
export async function POST(request: NextRequest) {
  try {
    await requireCurrentUser();

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return jsonError("Invalid JSON body.", 400);
    }

    const requestedId = (body as Record<string, unknown> | null)?.organization_id;
    if (typeof requestedId !== "string" || requestedId.length === 0) {
      return jsonError("organization_id is required.", 400);
    }

    const memberships = await getUserMemberships();
    const target = memberships.find((m) => m.organization.id === requestedId);
    if (!target) return jsonError("Organization not found.", 404);

    const response = NextResponse.json({
      data: { organization: target.organization, role: target.role },
    });

    response.cookies.set(ACTIVE_ORG_COOKIE, target.organization.id, {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      path: "/",
      maxAge: 60 * 60 * 24 * 365,
    });

    return response;
  } catch (error) {
    return handleRouteError(error);
  }
}
