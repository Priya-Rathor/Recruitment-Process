import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { handleRouteError, jsonError, parsePagination } from "@/lib/api";
import { requireCurrentUser, getUserMemberships } from "@/lib/tenant";

/**
 * GET /api/organizations
 * Lists the organizations the CALLER is an active member of — never all
 * organizations in the database. Supports pagination.
 */
export async function GET(request: NextRequest) {
  try {
    await requireCurrentUser();
    const { page, perPage, from, to } = parsePagination(request.nextUrl.searchParams);

    const memberships = await getUserMemberships();
    const total = memberships.length;

    return NextResponse.json({
      data: memberships.slice(from, to + 1).map((m) => ({
        ...m.organization,
        role: m.role,
      })),
      pagination: { page, per_page: perPage, total },
    });
  } catch (error) {
    return handleRouteError(error);
  }
}

/**
 * POST /api/organizations
 * Creates an organization and makes the caller its Owner, atomically, via the
 * create_organization_and_owner RPC. Any client-supplied id/role is ignored —
 * only name/industry/size/country/timezone are read from the payload.
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

    const payload = (body ?? {}) as Record<string, unknown>;
    const name = typeof payload.name === "string" ? payload.name.trim() : "";
    if (name.length === 0) return jsonError("Organization name is required.", 400);
    if (name.length > 120) return jsonError("Organization name is too long.", 400);

    const optionalText = (value: unknown) =>
      typeof value === "string" && value.trim().length > 0 ? value.trim().slice(0, 120) : null;

    const supabase = await createClient();
    const { data, error } = await supabase.rpc("create_organization_and_owner", {
      p_name: name,
      p_industry: optionalText(payload.industry),
      p_size: optionalText(payload.size),
      p_country: optionalText(payload.country),
      p_timezone: optionalText(payload.timezone) ?? "Asia/Kolkata",
    });

    if (error) {
      console.error("[api] create_organization_and_owner failed:", error);
      return jsonError("Could not create the organization. Please try again.", 400);
    }

    return NextResponse.json({ data }, { status: 201 });
  } catch (error) {
    return handleRouteError(error);
  }
}
