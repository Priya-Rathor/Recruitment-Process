import { NextResponse, type NextRequest } from "next/server";
import { handleRouteError, jsonError } from "@/lib/api";
import { requireCurrentUser, requireMembership } from "@/lib/tenant";
import { createClient } from "@/lib/supabase/server";
import { candidateTimelineTargets, getEntityTimeline } from "@/lib/activity/queries";
import { describeEvent } from "@/lib/activity/events";
import { toTimelineFacts } from "@/lib/activity/grounding";
import { summarizeActivity } from "@/lib/ai/summarizeActivity";
import { logAiCall } from "@/lib/activity/log";

export const maxDuration = 45;

/**
 * POST /api/activity-events/ai-action — "What's happened with Rahul?"
 *
 * All four roles may use it (section 9), and a Recruiter's answer is naturally
 * scoped: the timeline is read through RLS with their own session, so the model
 * only ever sees events they could already read. There is no separate scoping
 * rule to keep in step.
 *
 * The narrative is NOT saved. It is a reading aid over rows that are the actual
 * record — storing it would create a second, staler account of the same events
 * and invite someone to trust it over the log.
 */
export async function POST(request: NextRequest) {
  try {
    const [membership, user] = await Promise.all([requireMembership(), requireCurrentUser()]);

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return jsonError("Invalid JSON body.", 400);
    }

    const candidateId = (body as { candidate_id?: unknown })?.candidate_id;
    if (typeof candidateId !== "string" || candidateId.length === 0) {
      return jsonError("Which candidate?", 400);
    }

    const supabase = await createClient();
    const { data: candidateRow } = await supabase
      .from("candidates")
      .select("id, name")
      .eq("id", candidateId)
      .eq("organization_id", membership.organization.id)
      .maybeSingle();

    if (!candidateRow) return jsonError("Candidate not found.", 404);
    const candidate = candidateRow as unknown as { id: string; name: string };

    const targets = await candidateTimelineTargets({
      organizationId: membership.organization.id,
      candidateId,
    });

    const { events, failed } = await getEntityTimeline({
      organizationId: membership.organization.id,
      targets,
    });

    if (failed) return jsonError("Could not read the activity log.", 500);

    const facts = toTimelineFacts(events, describeEvent);

    const result = await summarizeActivity({
      subjectLabel: candidate.name,
      facts,
    });

    if (!result.ok) {
      const status =
        result.code === "not_configured" || result.code === "provider_error" ? 503 : 422;

      await logAiCall({
        organizationId: membership.organization.id,
        actorId: user.id,
        actorLabel: user.name ?? user.email,
        feature: "summarizeActivity",
        entityType: "candidate",
        entityId: candidateId,
        ok: false,
        errorCode: result.code,
      });

      return NextResponse.json({ error: result.message, code: result.code }, { status });
    }

    await logAiCall({
      organizationId: membership.organization.id,
      actorId: user.id,
      actorLabel: user.name ?? user.email,
      feature: "summarizeActivity",
      entityType: "candidate",
      entityId: candidateId,
      ok: true,
    });

    return NextResponse.json({ data: result.data, saved: false });
  } catch (error) {
    return handleRouteError(error);
  }
}
