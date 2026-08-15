import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { handleRouteError, jsonError } from "@/lib/api";
import { requireCurrentUser, requireRole } from "@/lib/tenant";
import { parseEvaluationPayload } from "@/lib/applications/evaluationValidation";
import { logActivity } from "@/lib/activity/log";
import { describeDbError } from "@/lib/supabase/errors";

/**
 * PATCH /api/applications/:id/evaluations/:entryId — correct an entry.
 *
 * Only rows in application_evaluations are editable here. A screening report or
 * a scheduled interview is edited on its own screen; a second write path for
 * one row is how the two drift apart.
 */
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; entryId: string }> }
) {
  try {
    const { id, entryId } = await params;
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

    const parsed = parseEvaluationPayload(body);
    if (!parsed.ok) return jsonError(parsed.error, 400);

    const supabase = await createClient();

    // stage_key is NOT updatable: an entry logged against a phone interview is
    // not the same record once it claims to be a director round, and moving it
    // would silently change which section it appears in.
    const { data, error } = await supabase
      .from("application_evaluations")
      .update({
        occurred_at: parsed.data.occurredAt,
        score: parsed.data.score,
        outcome: parsed.data.outcome,
        summary: parsed.data.summary,
      })
      .eq("id", entryId)
      .eq("application_id", id)
      .eq("organization_id", membership.organization.id)
      .select("id, stage_key, occurred_at, score, outcome, summary")
      .maybeSingle();

    if (error) {
      console.error("[api] evaluation update failed:", describeDbError(error));
      return jsonError("Could not save this entry.", 400);
    }
    if (!data) return jsonError("That entry could not be found.", 404);

    await logActivity({
      organizationId: membership.organization.id,
      entityType: "application",
      entityId: id,
      eventType: "application.note_added",
      actorId: user.id,
      actorLabel: user.name ?? user.email,
      metadata: {
        kind: "evaluation_entry",
        action: "edited",
        stage: (data as { stage_key: string }).stage_key,
        entry_id: entryId,
      },
    });

    return NextResponse.json({ data });
  } catch (error) {
    return handleRouteError(error);
  }
}
