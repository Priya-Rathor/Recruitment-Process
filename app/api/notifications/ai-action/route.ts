import { NextResponse, type NextRequest } from "next/server";
import { handleRouteError, jsonError } from "@/lib/api";
import { requireCurrentUser, requireRole } from "@/lib/tenant";
import { adjustMessageTone, isToneOption } from "@/lib/ai/adjustMessageTone";
import { isNotificationType, renderTemplate } from "@/lib/notifications/templates";
import { logAiCall } from "@/lib/activity/log";

export const maxDuration = 45;

/**
 * POST /api/notifications/ai-action — reword an approved message.
 *
 * THIS ENDPOINT SENDS NOTHING. It returns a draft for a recruiter to approve,
 * exactly like Module 13's rule drafting and Module 12's submission drafting.
 * The spec is explicit that "the system, not the AI, controls whether and how a
 * message is actually sent".
 *
 * The message is RE-RENDERED here from the template and the supplied facts —
 * the client's own version of the text is never trusted as the baseline. Without
 * that, a caller could post arbitrary text with a matching `facts` object and use
 * the endpoint as a general-purpose rewriter in the product's voice, and the
 * fixed-fact guard would have nothing meaningful to check against.
 *
 * Owner/Admin/Recruiter — "Send/approve external messages | Viewer: No".
 */
export async function POST(request: NextRequest) {
  try {
    const [membership, user] = await Promise.all([
      requireRole(["owner", "admin", "recruiter"]),
      requireCurrentUser(),
    ]);

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return jsonError("Invalid JSON body.", 400);
    }

    const payload = (body ?? {}) as Record<string, unknown>;

    if (!isNotificationType(payload.type)) {
      return jsonError("Unknown notification type.", 400);
    }
    if (!isToneOption(payload.tone)) {
      return jsonError("Choose a tone.", 400);
    }

    const values = (payload.values ?? {}) as Record<string, string | number | null>;

    // Re-render server-side. This is the baseline and the source of the facts.
    const rendered = renderTemplate({ type: payload.type, values });
    if (!rendered.ok) return jsonError(rendered.error, 400);

    const result = await adjustMessageTone({
      body: rendered.message.body,
      facts: rendered.message.facts,
      tone: payload.tone,
    });

    if (!result.ok) {
      // 503 = AI unavailable (retry may help). 422 = it answered but the answer
      // altered a fact and was discarded. The UI must tell those apart, because
      // only one of them is worth trying again.
      const status =
        result.code === "not_configured" || result.code === "provider_error" ? 503 : 422;

      await logAiCall({
        organizationId: membership.organization.id,
        actorId: user.id,
        actorLabel: user.name ?? user.email,
        feature: "adjustMessageTone",
        ok: false,
        errorCode: result.code,
      });

      return NextResponse.json(
        {
          error: result.message,
          code: result.code,
          // The approved wording always comes back, so a rejection degrades to
          // "send the original" rather than to a dead end.
          data: { original: rendered.message.body },
        },
        { status }
      );
    }

    await logAiCall({
      organizationId: membership.organization.id,
      actorId: user.id,
      actorLabel: user.name ?? user.email,
      feature: "adjustMessageTone",
      ok: true,
    });

    return NextResponse.json({
      data: { ...result.data, original: rendered.message.body },
      sent: false,
    });
  } catch (error) {
    return handleRouteError(error);
  }
}
