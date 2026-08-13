import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { handleRouteError, jsonError } from "@/lib/api";
import { requireRole } from "@/lib/tenant";

/**
 * DELETE /api/invites/:id — Owner/Admin only. Revokes a pending invite
 * (status -> 'revoked' rather than a hard delete, so the audit trail Module 14
 * will read still shows the invite was issued).
 */
export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const membership = await requireRole(["owner", "admin"]);

    const supabase = await createClient();
    const { data, error } = await supabase
      .from("invites")
      .update({ status: "revoked" })
      .eq("id", id)
      .eq("organization_id", membership.organization.id)
      .eq("status", "pending")
      .select("id, email, role, status")
      .maybeSingle();

    if (error) {
      console.error("[api] invite revoke failed:", error);
      return jsonError("Could not revoke the invite.", 400);
    }
    if (!data) return jsonError("Pending invite not found.", 404);

    return NextResponse.json({ data });
  } catch (error) {
    return handleRouteError(error);
  }
}
