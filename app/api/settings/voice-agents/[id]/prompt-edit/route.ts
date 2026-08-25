import { NextResponse, type NextRequest } from "next/server";
import { handleRouteError, jsonError } from "@/lib/api";
import { requireRole } from "@/lib/tenant";
import { refineAgentPrompt } from "@/lib/ai/refineAgentPrompt";
import { normalizeAgentSettings } from "@/lib/voice/settings";
import { getVoiceAgent } from "@/lib/voice/queries";

// An LLM round trip.
export const maxDuration = 60;

/**
 * POST /api/settings/voice-agents/:id/prompt-edit — propose a revised prompt.
 *
 * RETURNS A PROPOSAL AND WRITES NOTHING.
 *
 * There is no save here, no `saveVoiceAgent`, no update of any kind. The console
 * shows the revision beside the original and only the ordinary Save path — the
 * same PUT the sticky Save button uses — can ever persist it. That is the
 * propose-then-confirm rule this product applies wherever AI touches text a human
 * owns, and it is structural: this route has no write.
 *
 * The prompt being revised comes from the REQUEST, not from the stored row,
 * because the operator is editing unsaved text. The guardrails come from the
 * stored row, because those are what the revision must be checked against and a
 * client that could assert them could ask for them to be dropped.
 */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const membership = await requireRole(["owner", "admin"]);
    const organizationId = membership.organization.id;

    let body: Record<string, unknown> = {};
    try {
      body = ((await request.json()) ?? {}) as Record<string, unknown>;
    } catch {
      return jsonError("Send the prompt and the change you want as JSON.", 400);
    }

    const agent = await getVoiceAgent({
      organizationId,
      agentId: id,
      companyName: membership.organization.name,
    });
    if (!agent) return jsonError("That voice agent doesn't exist.", 404);

    /*
      The draft the operator is looking at, normalised the same way a save would
      normalise it. Falls back to the stored prompt when the client sends nothing,
      so "AI Edit" on an untouched page still has something to work from.
    */
    const draft = normalizeAgentSettings(
      { brain: { systemPrompt: body.currentPrompt, guardrails: agent.settings.brain.guardrails } },
      { companyName: membership.organization.name }
    );

    const currentPrompt =
      typeof body.currentPrompt === "string" && body.currentPrompt.trim().length > 0
        ? draft.brain.systemPrompt
        : agent.settings.brain.systemPrompt;

    const result = await refineAgentPrompt({
      currentPrompt,
      instruction: typeof body.instruction === "string" ? body.instruction : "",
      // From the STORED agent: the guard must not be something the caller chooses.
      guardrails: agent.settings.brain.guardrails,
      personaHint: agent.settings.brain.persona,
    });

    if (!result.ok) {
      // 422: the request was well-formed, the model's answer was not usable.
      return NextResponse.json({ error: result.message, code: result.code }, { status: 422 });
    }

    return NextResponse.json({
      data: {
        // Named "proposed" rather than "prompt" so no client can mistake this for
        // something that has been applied.
        proposed: result.data.prompt,
        summary: result.data.summary,
        preservedGuardrails: result.data.preservedGuardrails,
      },
    });
  } catch (error) {
    return handleRouteError(error);
  }
}
