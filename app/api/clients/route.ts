import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { handleRouteError, jsonError } from "@/lib/api";
import { requireMembership, requireRole } from "@/lib/tenant";
import { listClients, parseClientPayload } from "@/lib/clients/queries";
import { requireCurrentUser } from "@/lib/tenant";
import { logActivity } from "@/lib/activity/log";
import { formatDbError } from "@/lib/supabase/errors";

/** GET /api/clients — viewable by every role including Viewer. */
export async function GET(request: NextRequest) {
  try {
    const membership = await requireMembership();
    const { clients, failed } = await listClients({
      organizationId: membership.organization.id,
      includeArchived: request.nextUrl.searchParams.get("archived") === "true",
    });

    if (failed) return jsonError("Could not load clients.", 400);
    return NextResponse.json({ data: clients, caller_role: membership.role });
  } catch (error) {
    return handleRouteError(error);
  }
}

/** POST /api/clients — "Manage clients" is Owner/Admin/Recruiter; Viewer denied. */
export async function POST(request: NextRequest) {
  try {
    const membership = await requireRole(["owner", "admin", "recruiter"]);

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return jsonError("Invalid JSON body.", 400);
    }

    const parsed = parseClientPayload(body, "create");
    if (!parsed.ok) return jsonError(parsed.error, 400);

    const supabase = await createClient();
    const { data, error } = await supabase
      .from("clients")
      .insert({ ...parsed.data, organization_id: membership.organization.id })
      .select("id, name")
      .single();

    if (error) {
      // A duplicate name would split one client's history in two.
      if (error.code === "23505") {
        return jsonError("A client with that name already exists.", 409);
      }
      console.error(`[api] client create failed: ${formatDbError(error)}`);
      return jsonError("Could not create that client.", 400);
    }

    // Module 14.
    const created = data as unknown as { id: string; name: string };
    const actor = await requireCurrentUser();
    await logActivity({
      organizationId: membership.organization.id,
      entityType: "client",
      entityId: created.id,
      eventType: "client.created",
      actorId: actor.id,
      actorLabel: actor.name ?? actor.email,
      metadata: { name: created.name },
    });

    return NextResponse.json({ data }, { status: 201 });
  } catch (error) {
    return handleRouteError(error);
  }
}
