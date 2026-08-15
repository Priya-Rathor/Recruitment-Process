import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { handleRouteError, jsonError } from "@/lib/api";
import { requireCurrentUser, requireRole } from "@/lib/tenant";
import { listEvaluationEntries } from "@/lib/applications/evaluationQueries";
import { parseEvaluationPayload } from "@/lib/applications/evaluationValidation";
import { effectiveStages, acceptsEntries } from "@/lib/applications/effectiveStages";
import { flagsFromRows } from "@/lib/applications/effectiveStages";
import { listJobStages } from "@/lib/hiring-stages/queries";
import { countByStage } from "@/lib/applications/evaluations";
import { logActivity } from "@/lib/activity/log";
import { describeDbError } from "@/lib/supabase/errors";

/**
 * POST /api/applications/:id/evaluations — log an evaluation entry.
 *
 * Owner/Admin/Recruiter. Refused for a stage this application's job does not
 * run, or one it retired after entries were logged — the read-only rule is
 * enforced here as well as hidden in the UI, because the UI is not a boundary.
 */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
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
    const { data: application } = await supabase
      .from("applications")
      .select("id, job_id, stage")
      .eq("id", id)
      .eq("organization_id", membership.organization.id)
      .maybeSingle();

    if (!application) return jsonError("Application not found.", 404);
    const app = application as { id: string; job_id: string; stage: string };

    // The same rule the panel renders, checked server-side.
    const [stageRows, existing] = await Promise.all([
      listJobStages({ organizationId: membership.organization.id, jobId: app.job_id }),
      listEvaluationEntries({ organizationId: membership.organization.id, applicationId: id }),
    ]);

    const availability = effectiveStages({
      flags: flagsFromRows(stageRows),
      entryCounts: countByStage(existing),
      currentStage: app.stage as never,
    });

    if (!acceptsEntries(availability, parsed.data.stageKey)) {
      return jsonError(
        "That stage isn't part of this job's hiring process, so entries can't be added to it.",
        409
      );
    }

    const { data, error } = await supabase
      .from("application_evaluations")
      .insert({
        organization_id: membership.organization.id,
        application_id: id,
        stage_key: parsed.data.stageKey,
        occurred_at: parsed.data.occurredAt,
        score: parsed.data.score,
        outcome: parsed.data.outcome,
        summary: parsed.data.summary,
        logged_by: user.id,
      })
      .select("id, stage_key, occurred_at, score, outcome, summary")
      .single();

    if (error) {
      console.error("[api] evaluation insert failed:", describeDbError(error));
      return jsonError("Could not save this entry.", 400);
    }

    // Module 14. Logging an entry is a judgement about a person, so who wrote
    // it and when is exactly the kind of thing the audit exists for.
    await logActivity({
      organizationId: membership.organization.id,
      entityType: "application",
      entityId: id,
      eventType: "application.note_added",
      actorId: user.id,
      actorLabel: user.name ?? user.email,
      metadata: {
        kind: "evaluation_entry",
        action: "added",
        stage: parsed.data.stageKey,
        outcome: parsed.data.outcome,
        scored: parsed.data.score !== null,
      },
    });

    return NextResponse.json({ data }, { status: 201 });
  } catch (error) {
    return handleRouteError(error);
  }
}
