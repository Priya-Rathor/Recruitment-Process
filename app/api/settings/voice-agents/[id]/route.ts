import { NextResponse, type NextRequest } from "next/server";
import { handleRouteError, jsonError } from "@/lib/api";
import { requireCurrentUser, requireRole } from "@/lib/tenant";
import { logActivity } from "@/lib/activity/log";
import { updateAgentConfig } from "@/lib/integrations/bolna";
import { normalizeAgentSettings } from "@/lib/voice/settings";
import {
  deleteVoiceAgent,
  getVoiceAgent,
  readProviderAgentId,
  recordProviderSync,
  saveVoiceAgent,
} from "@/lib/voice/queries";

// Saving pushes the configuration to the provider.
export const maxDuration = 60;

/**
 * PUT /api/settings/voice-agents/:id — persist the ENTIRE form, one request.
 *
 * The console has one sticky Save button and no per-section saves, so this
 * endpoint takes the whole AgentSettings object and writes it in a single
 * statement. There is no PATCH and no per-field endpoint, on purpose: a page that
 * can half-save is a page whose displayed state and stored state disagree.
 *
 * ORDER OF OPERATIONS, AND WHY
 * ----------------------------
 *   1. normalise      — the browser is not trusted; clamps live in lib/voice
 *   2. write locally  — the admin's work is safe even if the provider is down
 *   3. push upstream  — and RECORD whether it landed
 *
 * Local-first is the deliberate part. A provider outage must not lose someone's
 * afternoon of configuration, and a save reported as successful when the provider
 * rejected it would leave the console showing settings no call will ever use. So
 * a failed sync returns 200 with `synced: false` and the reason — the settings ARE
 * saved, and the console says plainly that the provider does not have them yet.
 */
export async function PUT(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const [membership, user] = await Promise.all([
      requireRole(["owner", "admin"]),
      requireCurrentUser(),
    ]);
    const organizationId = membership.organization.id;

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return jsonError("Send the agent settings as JSON.", 400);
    }

    const payload = (body ?? {}) as Record<string, unknown>;

    // Confirms the agent exists in THIS tenant before anything is written.
    // Without it, a save for another organization's id would be refused by RLS
    // as an update of zero rows — which reads as success.
    const existing = await getVoiceAgent({
      organizationId,
      agentId: id,
      companyName: membership.organization.name,
    });
    if (!existing) return jsonError("That voice agent doesn't exist.", 404);

    const settings = normalizeAgentSettings(payload.settings, {
      companyName: membership.organization.name,
    });

    const saved = await saveVoiceAgent({
      organizationId,
      agentId: id,
      settings,
      makeDefault: payload.makeDefault === true,
    });
    if (!saved.ok) return jsonError(saved.error, 400);

    // --- Push to the provider ------------------------------------------------
    const providerAgentId = await readProviderAgentId({ organizationId, agentId: id });

    const sync = await updateAgentConfig({
      organizationId,
      settings,
      providerAgentId,
      webhookUrl: `${request.nextUrl.origin}/api/webhooks/bolna`,
    });

    await recordProviderSync({
      organizationId,
      agentId: id,
      providerAgentId: sync.ok ? sync.data.providerAgentId : null,
      error: sync.ok ? null : sync.error,
    });

    await logActivity({
      organizationId,
      entityType: "integration",
      entityId: id,
      eventType: "voice_agent.saved",
      actorId: user.id,
      actorLabel: user.name ?? user.email,
      metadata: { agent_name: settings.general.name, synced: sync.ok },
    });

    return NextResponse.json({
      data: {
        saved: true,
        synced: sync.ok,
        // A plain sentence the console shows inline. Never a provider payload.
        syncError: sync.ok ? null : sync.error,
        settings,
      },
    });
  } catch (error) {
    return handleRouteError(error);
  }
}

/**
 * DELETE /api/settings/voice-agents/:id
 *
 * The agent row goes; migration 0034's trigger promotes another agent to default
 * so an organization with agents always has one that dials. The provider-side
 * agent is deliberately LEFT IN PLACE: deleting it there would break any call
 * already in flight, and an orphaned agent at the provider costs nothing.
 */
export async function DELETE(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const [membership, user] = await Promise.all([
      requireRole(["owner", "admin"]),
      requireCurrentUser(),
    ]);
    const organizationId = membership.organization.id;

    const existing = await getVoiceAgent({
      organizationId,
      agentId: id,
      companyName: membership.organization.name,
    });
    if (!existing) return jsonError("That voice agent doesn't exist.", 404);

    const result = await deleteVoiceAgent({ organizationId, agentId: id });
    if (!result.ok) return jsonError(result.error, 400);

    await logActivity({
      organizationId,
      entityType: "integration",
      entityId: id,
      eventType: "voice_agent.deleted",
      actorId: user.id,
      actorLabel: user.name ?? user.email,
      metadata: { agent_name: existing.settings.general.name },
    });

    return NextResponse.json({ data: { deleted: true } });
  } catch (error) {
    return handleRouteError(error);
  }
}
