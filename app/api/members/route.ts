import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { handleRouteError, jsonError, parsePagination } from "@/lib/api";
import { requireMembership } from "@/lib/tenant";

/**
 * GET /api/members
 * Lists members of the caller's server-resolved organization. Readable by any
 * active member (a Recruiter/Viewer needs to see who their teammates are), but
 * mutations are Owner/Admin only — see PATCH/DELETE on /api/members/:id.
 */
export async function GET(request: NextRequest) {
  try {
    const membership = await requireMembership();
    const { searchParams } = request.nextUrl;
    const { page, perPage, from, to } = parsePagination(searchParams);

    const supabase = await createClient();
    let query = supabase
      .from("organization_members")
      // Explicit FK: organization_members has two references to users
      // (user_id and invited_by), so an unqualified embed is ambiguous.
      .select(
        "id, role, status, joined_at, user:users!organization_members_user_id_fkey(id, name, email, avatar_url)",
        {
        count: "exact",
      })
      .eq("organization_id", membership.organization.id)
      .order("joined_at", { ascending: true })
      .range(from, to);

    const status = searchParams.get("status");
    if (status) {
      if (!["active", "removed"].includes(status)) {
        return jsonError("Invalid status filter.", 400);
      }
      query = query.eq("status", status);
    } else {
      query = query.eq("status", "active");
    }

    const role = searchParams.get("role");
    if (role) {
      if (!["owner", "admin", "recruiter", "viewer"].includes(role)) {
        return jsonError("Invalid role filter.", 400);
      }
      query = query.eq("role", role);
    }

    const { data, error, count } = await query;
    if (error) {
      console.error("[api] members list failed:", error);
      return jsonError("Could not load team members.", 400);
    }

    return NextResponse.json({
      data: data ?? [],
      pagination: { page, per_page: perPage, total: count ?? 0 },
      caller_role: membership.role,
    });
  } catch (error) {
    return handleRouteError(error);
  }
}
