import { NextResponse, type NextRequest } from "next/server";
import { handleRouteError, jsonError } from "@/lib/api";
import { requireCurrentUser, requireRole } from "@/lib/tenant";
import { isProvider, type Provider } from "@/lib/integrations/store";
import { findDependencies, PROVIDER_DESCRIPTORS } from "@/lib/settings/integrations";
import { logActivity } from "@/lib/activity/log";
import * as bolna from "@/lib/integrations/bolna";
import * as email from "@/lib/integrations/email";
import * as calendar from "@/lib/integrations/calendar";
import * as llm from "@/lib/integrations/llm";
import * as n8n from "@/lib/integrations/n8n";
import * as whatsapp from "@/lib/integrations/whatsapp";

// Connect and Test both make a provider round trip.
export const maxDuration = 60;

/**
 * GET /api/settings/integrations/:provider — what depends on this integration.
 *
 * Read before showing a Disconnect confirmation. The spec: "Before
 * disconnecting, show which live automations/features depend on it."
 */
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ provider: string }> }
) {
  try {
    const { provider } = await params;
    if (!isProvider(provider)) return jsonError("Unknown integration.", 404);

    const membership = await requireRole(["owner", "admin"]);
    const { dependencies, failed } = await findDependencies({
      organizationId: membership.organization.id,
      provider,
    });

    return NextResponse.json({
      data: {
        provider,
        label: PROVIDER_DESCRIPTORS[provider].label,
        dependencies,
        // Surfaced, not swallowed. "Nothing depends on this" when we could not
        // check is the false reassurance that gets a live integration turned
        // off mid-interview-week.
        checkFailed: failed,
      },
    });
  } catch (error) {
    return handleRouteError(error);
  }
}

/**
 * POST /api/settings/integrations/:provider — connect, or test.
 *
 * `{ action: "test" }` runs the health check. Anything else is a connect, whose
 * body shape is provider-specific and validated by that provider's adapter.
 *
 * THE RESPONSE NEVER CONTAINS A CREDENTIAL. Adapters return a masked hint; the
 * secret goes in once and never comes back out.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ provider: string }> }
) {
  try {
    const { provider } = await params;
    if (!isProvider(provider)) return jsonError("Unknown integration.", 404);

    const [membership, user] = await Promise.all([
      requireRole(["owner", "admin"]),
      requireCurrentUser(),
    ]);

    let body: unknown = {};
    try {
      body = await request.json();
    } catch {
      // An empty body means "test", the only action that needs no input.
    }

    const payload = (body ?? {}) as Record<string, unknown>;
    const organizationId = membership.organization.id;

    if (payload.action === "test") {
      const result = await runTest(provider, organizationId);

      await logActivity({
        organizationId,
        entityType: "integration",
        entityId: null,
        eventType: "integration.tested",
        actorId: user.id,
        actorLabel: user.name ?? user.email,
        metadata: {
          provider,
          result: result.ok ? "connected" : "failed",
          // The plain message, never a provider payload.
          ...(result.ok ? {} : { detail: result.error }),
        },
      });

      return result.ok
        ? NextResponse.json({ data: { provider, status: "connected" } })
        : NextResponse.json({ error: result.error, code: "test_failed" }, { status: 409 });
    }

    const connected = await runConnect({ provider, organizationId, payload, userId: user.id });

    if (!connected.ok) return jsonError(connected.error, 400);

    await logActivity({
      organizationId,
      entityType: "integration",
      entityId: null,
      eventType: "integration.connected",
      actorId: user.id,
      actorLabel: user.name ?? user.email,
      metadata: { provider },
    });

    // Masked hint only.
    return NextResponse.json({ data: { provider, credentialHint: connected.credentialHint } });
  } catch (error) {
    return handleRouteError(error);
  }
}

/**
 * DELETE /api/settings/integrations/:provider — disconnect.
 *
 * Requires `?confirm=true`. The dependency list is a warning, and a warning
 * nobody has to acknowledge is decoration — an accidental DELETE from a stray
 * click would otherwise silently stop a team's screening calls.
 */
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ provider: string }> }
) {
  try {
    const { provider } = await params;
    if (!isProvider(provider)) return jsonError("Unknown integration.", 404);

    const [membership, user] = await Promise.all([
      requireRole(["owner", "admin"]),
      requireCurrentUser(),
    ]);

    if (request.nextUrl.searchParams.get("confirm") !== "true") {
      return jsonError("Disconnecting needs an explicit confirmation.", 400);
    }

    const result = await runDisconnect(provider, membership.organization.id);
    if (!result.ok) return jsonError(result.error, 400);

    // Module 14, and this one matters: disconnecting an integration silently
    // stops candidate-facing features, so "who turned this off, and when?" must
    // stay answerable afterwards.
    await logActivity({
      organizationId: membership.organization.id,
      entityType: "integration",
      entityId: null,
      eventType: "integration.disconnected",
      actorId: user.id,
      actorLabel: user.name ?? user.email,
      metadata: { provider },
    });

    return NextResponse.json({ data: { provider, disconnected: true } });
  } catch (error) {
    return handleRouteError(error);
  }
}

// -----------------------------------------------------------------------------
// Provider dispatch.
//
// A switch rather than a map of adapters, because their connect() signatures
// genuinely differ — Bolna needs an agent id, email a From address, n8n a URL.
// Flattening them into one shape would mean validating provider-specific fields
// in this file, which is exactly what the adapter layer exists to prevent.
// -----------------------------------------------------------------------------

async function runTest(
  provider: Provider,
  organizationId: string
): Promise<{ ok: true } | { ok: false; error: string }> {
  switch (provider) {
    case "bolna": {
      const result = await bolna.test(organizationId);
      return result.ok ? { ok: true } : { ok: false, error: result.error };
    }
    case "email": {
      const result = await email.test(organizationId);
      return result.ok ? { ok: true } : { ok: false, error: result.error };
    }
    case "calendar": {
      const result = await calendar.test(organizationId);
      return result.ok ? { ok: true } : { ok: false, error: result.error };
    }
    case "llm": {
      const result = await llm.test(organizationId);
      return result.ok ? { ok: true } : { ok: false, error: result.error };
    }
    case "n8n": {
      const result = await n8n.test(organizationId);
      return result.ok ? { ok: true } : { ok: false, error: result.error };
    }
    case "whatsapp": {
      const result = await whatsapp.test(organizationId);
      return result.ok ? { ok: true } : { ok: false, error: result.error };
    }
  }
}

async function runConnect({
  provider,
  organizationId,
  payload,
  userId,
}: {
  provider: Provider;
  organizationId: string;
  payload: Record<string, unknown>;
  userId: string;
}): Promise<{ ok: true; credentialHint: string } | { ok: false; error: string }> {
  const text = (key: string): string =>
    typeof payload[key] === "string" ? (payload[key] as string) : "";

  switch (provider) {
    case "bolna": {
      const result = await bolna.connect({
        organizationId,
        apiKey: text("apiKey"),
        agentId: text("agentId"),
        connectedBy: userId,
      });
      return result.ok
        ? { ok: true, credentialHint: result.data.credentialHint }
        : { ok: false, error: result.error };
    }
    case "email": {
      const result = await email.connect({
        organizationId,
        apiKey: text("apiKey"),
        fromAddress: text("fromAddress"),
        fromName: text("fromName") || undefined,
        connectedBy: userId,
      });
      return result.ok
        ? { ok: true, credentialHint: result.data.credentialHint }
        : { ok: false, error: result.error };
    }
    case "llm": {
      const result = await llm.connect({
        organizationId,
        apiKey: text("apiKey"),
        model: text("model") || undefined,
        connectedBy: userId,
      });
      return result.ok
        ? { ok: true, credentialHint: result.data.credentialHint }
        : { ok: false, error: result.error };
    }
    case "n8n": {
      const result = await n8n.connect({
        organizationId,
        instanceUrl: text("instanceUrl"),
        apiKey: text("apiKey"),
        connectedBy: userId,
      });
      return result.ok
        ? { ok: true, credentialHint: result.data.credentialHint }
        : { ok: false, error: result.error };
    }
    case "whatsapp": {
      const result = await whatsapp.connect({
        organizationId,
        accessToken: text("accessToken"),
        phoneNumberId: text("phoneNumberId"),
        displayNumber: text("displayNumber") || undefined,
        // The Meta-approved template name. Optional, and the integration card
        // says plainly what is lost without one.
        messagingTemplate: text("messagingTemplate") || undefined,
        messagingTemplateLanguage: text("messagingTemplateLanguage") || undefined,
        connectedBy: userId,
      });
      return result.ok
        ? { ok: true, credentialHint: result.data.credentialHint }
        : { ok: false, error: result.error };
    }
    case "calendar": {
      // Calendar is OAuth: there is no secret to post here. The browser is sent
      // to Google and the callback route stores the tokens. Accepting a
      // credential on this endpoint would mean a path where a refresh token
      // arrives in a request body.
      return {
        ok: false,
        error: "Connect Google Calendar with the Connect button, which opens Google's sign-in.",
      };
    }
  }
}

async function runDisconnect(
  provider: Provider,
  organizationId: string
): Promise<{ ok: true } | { ok: false; error: string }> {
  switch (provider) {
    case "bolna": {
      const result = await bolna.disconnect(organizationId);
      return result.ok ? { ok: true } : { ok: false, error: result.error };
    }
    case "email": {
      const result = await email.disconnect(organizationId);
      return result.ok ? { ok: true } : { ok: false, error: result.error };
    }
    case "calendar": {
      const result = await calendar.disconnect(organizationId);
      return result.ok ? { ok: true } : { ok: false, error: result.error };
    }
    case "llm": {
      const result = await llm.disconnect(organizationId);
      return result.ok ? { ok: true } : { ok: false, error: result.error };
    }
    case "n8n": {
      const result = await n8n.disconnect(organizationId);
      return result.ok ? { ok: true } : { ok: false, error: result.error };
    }
    case "whatsapp": {
      const result = await whatsapp.disconnect(organizationId);
      return result.ok ? { ok: true } : { ok: false, error: result.error };
    }
  }
}
