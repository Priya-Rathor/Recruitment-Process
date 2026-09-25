import { NextResponse, type NextRequest } from "next/server";
import { handleRouteError, jsonError } from "@/lib/api";
import { requireCurrentUser, requireMembership, requireRole } from "@/lib/tenant";
import { normalizeAgentInput } from "@/lib/agents/config";
import { createAgent, listAgents } from "@/lib/agents/queries";
import { logActivity } from "@/lib/activity/log";

/**
 * The Agent Center's collection.
 *
 * The organization comes from the SESSION, never the body: a create request
 * carrying `organization_id` has it ignored, because normalizeAgentInput()
 * reads only the fields it knows. Reads are open to every member (RLS allows
 * it, and the people living with an agent should be able to see it); writes
 * are Owner/Admin here AND in migration 0043's policies.
 */
export async function GET() {
  try {
    const membership = await requireMembership();
    const result = await listAgents(membership.organization.id);
    if (result.state === "error") return jsonError("Couldn't load agents.", 500);
    if (result.state === "not_set_up") return jsonError("The Agent Center isn't set up on this server yet.", 503);
    return NextResponse.json({ data: result.agents });
  } catch (error) {
    return handleRouteError(error);
  }
}

export async function POST(request: NextRequest) {
  try {
    const [membership, user] = await Promise.all([requireRole(["owner", "admin"]), requireCurrentUser()]);

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return jsonError("Send the agent as JSON.", 400);
    }

    const input = normalizeAgentInput(body);
    if (!input.ok) return jsonError(input.error, 400);

    const created = await createAgent({
      organizationId: membership.organization.id,
      createdBy: user.id,
      input: input.value,
    });
    if (!created.ok) return jsonError(created.error, created.status);

    await logActivity({
      organizationId: membership.organization.id,
      entityType: "integration",
      entityId: created.value.id,
      eventType: "agent.created",
      actorId: user.id,
      actorLabel: user.name ?? user.email,
      metadata: { agent_name: created.value.name, agent_type: created.value.type },
    });

    return NextResponse.json({ data: created.value }, { status: 201 });
  } catch (error) {
    return handleRouteError(error);
  }
}
