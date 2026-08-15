import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { handleRouteError, jsonError } from "@/lib/api";
import { requireMembership, requireRole } from "@/lib/tenant";
import { getClient, getClientActivity, parseClientPayload } from "@/lib/clients/queries";
import { requireCurrentUser } from "@/lib/tenant";
import { logActivity } from "@/lib/activity/log";
import { describeDbError } from "@/lib/supabase/errors";

/** GET /api/clients/:id — with activity. Viewable by every role. */
export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const membership = await requireMembership();

    const client = await getClient({ organizationId: membership.organization.id, clientId: id });
    if (!client) return jsonError("Client not found.", 404);

    const activity = await getClientActivity({
      organizationId: membership.organization.id,
      clientId: id,
    });

    return NextResponse.json({ data: { client, activity }, caller_role: membership.role });
  } catch (error) {
    return handleRouteError(error);
  }
}

/** PATCH /api/clients/:id — Owner/Admin/Recruiter. */
export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const membership = await requireRole(["owner", "admin", "recruiter"]);

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return jsonError("Invalid JSON body.", 400);
    }

    const parsed = parseClientPayload(body, "update");
    if (!parsed.ok) return jsonError(parsed.error, 400);

    const supabase = await createClient();

    if (typeof parsed.data.account_manager_id === "string") {
      const { data: member } = await supabase
        .from("organization_members")
        .select("user_id")
        .eq("organization_id", membership.organization.id)
        .eq("user_id", parsed.data.account_manager_id)
        .eq("status", "active")
        .maybeSingle();
      if (!member) return jsonError("That account manager is not a member of this team.", 400);
    }

    const { data, error } = await supabase
      .from("clients")
      .update(parsed.data)
      .eq("id", id)
      .eq("organization_id", membership.organization.id)
      .select("id, name")
      .maybeSingle();

    if (error) {
      if (error.code === "23505") return jsonError("A client with that name already exists.", 409);
      console.error("[api] client update failed:", describeDbError(error));
      return jsonError("Could not update that client.", 400);
    }
    if (!data) return jsonError("Client not found.", 404);

    // Module 14.
    const actor = await requireCurrentUser();
    await logActivity({
      organizationId: membership.organization.id,
      entityType: "client",
      entityId: id,
      eventType: "client.updated",
      actorId: actor.id,
      actorLabel: actor.name ?? actor.email,
      metadata: { fields: Object.keys(parsed.data) },
    });

    return NextResponse.json({ data });
  } catch (error) {
    return handleRouteError(error);
  }
}

/**
 * DELETE /api/clients/:id — ARCHIVES.
 *
 * Never a hard delete: jobs reference clients (jobs.client_id is ON DELETE SET
 * NULL, so a real delete would silently orphan them) and Module 16 reports on
 * their history. Owner/Admin only.
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
      .from("clients")
      .update({ archived_at: new Date().toISOString() })
      .eq("id", id)
      .eq("organization_id", membership.organization.id)
      .is("archived_at", null)
      .select("id, archived_at")
      .maybeSingle();

    if (error) {
      console.error("[api] client archive failed:", describeDbError(error));
      return jsonError("Could not archive that client.", 400);
    }
    if (!data) return jsonError("Client not found, or already archived.", 404);

    return NextResponse.json({ data });
  } catch (error) {
    return handleRouteError(error);
  }
}
