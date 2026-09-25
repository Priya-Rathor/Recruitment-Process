import { NextResponse, type NextRequest } from "next/server";
import { handleRouteError, jsonError } from "@/lib/api";
import { requireCurrentUser, requireMembership, requireRole } from "@/lib/tenant";
import { deleteAgent, getAgent, updateAgent } from "@/lib/agents/queries";
import { logActivity } from "@/lib/activity/log";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Every lookup filters organization_id AND id (lib/agents/queries.ts), so an id
// from another organization is a 404 here — never a 403 that confirms it exists.

export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const membership = await requireMembership();
    if (!UUID_PATTERN.test(id)) return jsonError("That agent doesn't exist.", 404);

    const agent = await getAgent(membership.organization.id, id);
    if (!agent) return jsonError("That agent doesn't exist.", 404);
    return NextResponse.json({ data: agent });
  } catch (error) {
    return handleRouteError(error);
  }
}

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const [membership, user] = await Promise.all([requireRole(["owner", "admin"]), requireCurrentUser()]);
    if (!UUID_PATTERN.test(id)) return jsonError("That agent doesn't exist.", 404);

    let body: Record<string, unknown>;
    try {
      const parsed = await request.json();
      if (typeof parsed !== "object" || parsed === null) throw new Error("not an object");
      body = parsed as Record<string, unknown>;
    } catch {
      return jsonError("Send the changes as JSON.", 400);
    }

    const saved = await updateAgent({
      organizationId: membership.organization.id,
      id,
      patch: {
        name: body.name,
        description: body.description,
        status: body.status,
        configuration: body.configuration,
      },
    });
    if (!saved.ok) return jsonError(saved.error, saved.status);

    await logActivity({
      organizationId: membership.organization.id,
      entityType: "integration",
      entityId: id,
      // A status change is the one worth finding later: "who paused the
      // screening agent?" has to have an answer.
      eventType: body.status !== undefined ? "agent.status_changed" : "agent.saved",
      actorId: user.id,
      actorLabel: user.name ?? user.email,
      metadata: { agent_name: saved.value.name, status: saved.value.status },
    });

    return NextResponse.json({ data: saved.value });
  } catch (error) {
    return handleRouteError(error);
  }
}

export async function DELETE(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const [membership, user] = await Promise.all([requireRole(["owner", "admin"]), requireCurrentUser()]);
    if (!UUID_PATTERN.test(id)) return jsonError("That agent doesn't exist.", 404);

    const existing = await getAgent(membership.organization.id, id);
    if (!existing) return jsonError("That agent doesn't exist.", 404);

    // The in-use check is migration 0043's trigger, not a read here: a read
    // followed by a delete is a race, and the trigger also guards the console.
    const deleted = await deleteAgent(membership.organization.id, id);
    if (!deleted.ok) return jsonError(deleted.error, deleted.status);

    await logActivity({
      organizationId: membership.organization.id,
      entityType: "integration",
      entityId: id,
      eventType: "agent.deleted",
      actorId: user.id,
      actorLabel: user.name ?? user.email,
      metadata: { agent_name: existing.name, agent_type: existing.type },
    });

    return new NextResponse(null, { status: 204 });
  } catch (error) {
    return handleRouteError(error);
  }
}
