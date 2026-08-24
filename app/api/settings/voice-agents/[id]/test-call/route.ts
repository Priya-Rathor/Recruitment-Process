import { NextResponse, type NextRequest } from "next/server";
import { handleRouteError, jsonError } from "@/lib/api";
import { requireCurrentUser, requireRole } from "@/lib/tenant";
import { logActivity } from "@/lib/activity/log";
import { placeTestCall, TEST_CALL_HOURLY_CAP } from "@/lib/integrations/bolna";
import {
  countRecentTestCalls,
  createTestCall,
  getTestCall,
  getVoiceAgent,
  markTestCall,
  readProviderAgentId,
} from "@/lib/voice/queries";

// Dialling is a provider round trip.
export const maxDuration = 60;

/**
 * GET /api/settings/voice-agents/:id/test-call?callId=…
 *
 * The console polls this while a test call is in flight. It reads OUR row, which
 * the provider webhook advances — there is no second status-fetch path to the
 * provider, so the console and the screening-call screens are looking at the same
 * facts written by the same webhook.
 */
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    await params;
    const membership = await requireRole(["owner", "admin"]);

    const callId = request.nextUrl.searchParams.get("callId");
    if (!callId) return jsonError("Which test call?", 400);

    const call = await getTestCall({
      organizationId: membership.organization.id,
      testCallId: callId,
    });
    if (!call) return jsonError("That test call doesn't exist.", 404);

    return NextResponse.json({ data: call });
  } catch (error) {
    return handleRouteError(error);
  }
}

/**
 * POST /api/settings/voice-agents/:id/test-call — "Call me".
 *
 * THIS TELEPHONES A REAL PERSON, so it follows the same rules as every other
 * outbound path in this product:
 *
 *   - Owner/Admin only.
 *   - `confirmed: true` must be in the body. The console asks first; a stray
 *     POST from anywhere else does not dial.
 *   - A hard per-organization cap on calls per hour, counted from our own rows.
 *     The count FAILS CLOSED (see countRecentTestCalls) — a cap that cannot be
 *     counted is treated as reached.
 *   - The disclosure is emitted by lib/screening/script.ts and cannot be
 *     switched off, because whoever answers may not be whoever pressed the
 *     button.
 */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const [membership, user] = await Promise.all([
      requireRole(["owner", "admin"]),
      requireCurrentUser(),
    ]);
    const organizationId = membership.organization.id;

    let body: Record<string, unknown> = {};
    try {
      body = ((await request.json()) ?? {}) as Record<string, unknown>;
    } catch {
      return jsonError("Send a phone number.", 400);
    }

    if (body.confirmed !== true) {
      return jsonError("A test call needs an explicit confirmation.", 400);
    }

    const phoneNumber = typeof body.phoneNumber === "string" ? body.phoneNumber.trim() : "";
    if (phoneNumber.replace(/\D/g, "").length < 8) {
      return jsonError("That phone number doesn't look dialable.", 400);
    }

    const agent = await getVoiceAgent({
      organizationId,
      agentId: id,
      companyName: membership.organization.name,
    });
    if (!agent) return jsonError("That voice agent doesn't exist.", 404);

    const recent = await countRecentTestCalls({ organizationId });
    if (recent >= TEST_CALL_HOURLY_CAP) {
      return NextResponse.json(
        {
          error: `That's ${TEST_CALL_HOURLY_CAP} test calls in the last hour, which is the limit. Try again later.`,
          code: "capped",
        },
        { status: 409 }
      );
    }

    // Recorded BEFORE dialling, so a call that connects but never reports back
    // is visible rather than invisible — the same reasoning as screening_calls.
    const created = await createTestCall({
      organizationId,
      agentId: id,
      phoneNumber,
      requestedBy: user.id,
    });
    if (!created.ok) return jsonError(created.error, 400);

    const providerAgentId = await readProviderAgentId({ organizationId, agentId: id });

    const result = await placeTestCall({
      organizationId,
      testCallId: created.id,
      phoneNumber,
      settings: agent.settings,
      providerAgentId,
      webhookUrl: `${request.nextUrl.origin}/api/webhooks/bolna`,
    });

    if (!result.ok) {
      await markTestCall({
        organizationId,
        testCallId: created.id,
        status: "failed",
        failureReason: result.error,
      });
      return NextResponse.json(
        { error: result.error, code: "provider", data: { callId: created.id } },
        { status: 409 }
      );
    }

    await markTestCall({
      organizationId,
      testCallId: created.id,
      status: "dialing",
      providerCallId: result.data.providerCallId,
    });

    await logActivity({
      organizationId,
      entityType: "integration",
      entityId: id,
      eventType: "voice_agent.test_called",
      actorId: user.id,
      actorLabel: user.name ?? user.email,
      metadata: { agent_name: agent.settings.general.name, phone_number: phoneNumber },
    });

    return NextResponse.json({ data: { callId: created.id } }, { status: 201 });
  } catch (error) {
    return handleRouteError(error);
  }
}
