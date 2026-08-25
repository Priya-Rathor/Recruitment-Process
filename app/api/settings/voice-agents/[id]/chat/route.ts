import { NextResponse, type NextRequest } from "next/server";
import { handleRouteError, jsonError } from "@/lib/api";
import { requireRole } from "@/lib/tenant";
import { chatAsAgent, MAX_HISTORY_TURNS, type ChatTurn } from "@/lib/ai/chatAsAgent";
import { normalizeAgentSettings } from "@/lib/voice/settings";
import { getVoiceAgent } from "@/lib/voice/queries";

// An LLM round trip.
export const maxDuration = 60;

/**
 * POST /api/settings/voice-agents/:id/chat — one turn of the text rehearsal.
 *
 * NO CALL RECORD IS CREATED. This route does not touch `screening_calls` or
 * `voice_agent_test_calls`, does not consult the test-call hourly cap, and does
 * not reach the telephony provider at all. It costs LLM tokens and nothing else.
 *
 * Stateless on purpose: the conversation lives in the browser and is sent up each
 * turn. A prompt sandbox does not need a transcript table, and adding one would
 * mean storing rehearsal text that looks like a candidate conversation but is not
 * — precisely the kind of row that later gets mistaken for evidence.
 */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const membership = await requireRole(["owner", "admin"]);

    let body: Record<string, unknown> = {};
    try {
      body = ((await request.json()) ?? {}) as Record<string, unknown>;
    } catch {
      return jsonError("Send a message as JSON.", 400);
    }

    const agent = await getVoiceAgent({
      organizationId: membership.organization.id,
      agentId: id,
      companyName: membership.organization.name,
    });
    if (!agent) return jsonError("That voice agent doesn't exist.", 404);

    /*
      Tested against the UNSAVED draft when the client sends one.

      That is the whole value of the feature: an operator tweaks the persona and
      wants to hear the difference before committing. Normalised through the same
      function a save uses, so the rehearsal cannot run on a shape that could not
      be stored.
    */
    const settings =
      typeof body.settings === "object" && body.settings !== null
        ? normalizeAgentSettings(body.settings, { companyName: membership.organization.name })
        : agent.settings;

    const history: ChatTurn[] = Array.isArray(body.history)
      ? body.history
          .filter((turn): turn is Record<string, unknown> => typeof turn === "object" && turn !== null)
          .map((turn) => ({
            role: turn.role === "agent" ? ("agent" as const) : ("operator" as const),
            text: typeof turn.text === "string" ? turn.text.slice(0, 2000) : "",
          }))
          .filter((turn) => turn.text.length > 0)
          .slice(-MAX_HISTORY_TURNS)
      : [];

    const result = await chatAsAgent({
      settings,
      history,
      message: typeof body.message === "string" ? body.message : "",
    });

    if (!result.ok) {
      return NextResponse.json({ error: result.message, code: result.code }, { status: 422 });
    }

    return NextResponse.json({ data: { reply: result.data.text } });
  } catch (error) {
    return handleRouteError(error);
  }
}
