import { NextResponse, type NextRequest } from "next/server";
import { handleRouteError, jsonError } from "@/lib/api";
import { requireCurrentUser, requireRole } from "@/lib/tenant";
import { logActivity } from "@/lib/activity/log";
import { getStatus, listAgentCatalog } from "@/lib/integrations/bolna";
import { createVoiceAgent, listVoiceAgents } from "@/lib/voice/queries";

// Reading the catalogue means a provider round trip.
export const maxDuration = 60;

/**
 * GET /api/settings/voice-agents — every agent, plus the option catalogue.
 *
 * OWNER/ADMIN ONLY, matching the rest of Module 17's integration configuration.
 * requireRole() throws a TenantError, which handleRouteError turns into a 403 —
 * so a Recruiter or Viewer calling this endpoint directly, with no page in front
 * of it, gets refused by the same check the page uses.
 *
 * THE RESPONSE CONTAINS NO PROVIDER-IDENTIFYING VALUE. Agents are serialised by
 * lib/voice/queries.ts, which never selects the provider columns; catalogue
 * options carry an opaque key and a scrubbed label. The word "connected" is the
 * most the browser learns about the provider.
 */
export async function GET() {
  try {
    const membership = await requireRole(["owner", "admin"]);
    const organizationId = membership.organization.id;

    const [{ agents, notBuilt, failed }, catalog, status] = await Promise.all([
      listVoiceAgents({ organizationId, companyName: membership.organization.name }),
      listAgentCatalog(organizationId),
      getStatus(organizationId),
    ]);

    if (failed) return jsonError("Couldn't load voice agents.", 500);

    return NextResponse.json({
      data: {
        agents,
        catalog,
        notBuilt,
        // Neutral connection facts only — no credential, no hint, no provider
        // name. "connected" is what the console needs to decide whether a test
        // call is possible.
        connection: {
          connected: status.status === "connected",
          encryptionUnavailable: status.encryptionUnavailable,
        },
      },
    });
  } catch (error) {
    return handleRouteError(error);
  }
}

/**
 * POST /api/settings/voice-agents — create an agent with the defaults.
 *
 * The "+ New agent" option in the switcher. Creating is deliberately separate
 * from saving: the console loads a real row with real defaults rather than
 * holding an unsaved phantom agent whose id does not exist yet, which is what
 * makes "switching agents must not leak the previous agent's unsaved edits" a
 * property of the data rather than of a useEffect.
 */
export async function POST(request: NextRequest) {
  try {
    const [membership, user] = await Promise.all([
      requireRole(["owner", "admin"]),
      requireCurrentUser(),
    ]);

    let name: string | undefined;
    try {
      const body = (await request.json()) as { name?: unknown };
      if (typeof body.name === "string") name = body.name;
    } catch {
      // No body is fine — the defaults name it.
    }

    const result = await createVoiceAgent({
      organizationId: membership.organization.id,
      createdBy: user.id,
      companyName: membership.organization.name,
      name,
    });

    if (!result.ok) return jsonError(result.error, 400);

    await logActivity({
      organizationId: membership.organization.id,
      entityType: "integration",
      entityId: result.agent.id,
      eventType: "voice_agent.created",
      actorId: user.id,
      actorLabel: user.name ?? user.email,
      metadata: { agent_name: result.agent.settings.general.name },
    });

    return NextResponse.json({ data: result.agent }, { status: 201 });
  } catch (error) {
    return handleRouteError(error);
  }
}
