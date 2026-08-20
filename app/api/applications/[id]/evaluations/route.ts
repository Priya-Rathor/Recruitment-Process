import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { handleRouteError, jsonError } from "@/lib/api";
import { requireCurrentUser, requireRole } from "@/lib/tenant";
import { listEvaluationEntries } from "@/lib/applications/evaluationQueries";
import { parseEvaluationPayload } from "@/lib/applications/evaluationValidation";
import { effectiveStages, acceptsEntries } from "@/lib/applications/effectiveStages";
import { flagsFromRows } from "@/lib/applications/effectiveStages";
import { listJobStages } from "@/lib/hiring-stages/queries";
import { countByStage, evaluationsComplete } from "@/lib/applications/evaluations";
import { dispatch } from "@/lib/automations/engine";
import { CONFIGURABLE_STAGES, type ApplicationStage, type ConfigurableStage } from "@/lib/applications/stages";
import { logActivity } from "@/lib/activity/log";
import { formatDbError } from "@/lib/supabase/errors";

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
      console.error(`[api] evaluation insert failed: ${formatDbError(error)}`);
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

    /**
     * MODULE 13 — the `evaluations_complete` trigger.
     *
     * Fires only on the entry that COMPLETES the set. Recruitee's guidance is the
     * reason this trigger exists at all: without it a candidate sits still between
     * the last interviewer submitting feedback and somebody noticing that they
     * did.
     *
     * The entries are re-read rather than derived from `existing` plus this one,
     * because `existing` was loaded before the insert and another interviewer may
     * have logged theirs in between. Advancing a candidate on a stale read of who
     * has and has not decided is precisely the mistake to avoid.
     *
     * Wrapped and awaited, like every dispatch site: awaited because a serverless
     * function can be frozen the moment it responds, which would leave a run
     * claimed and unfinished; caught because a failing rule must never lose an
     * interviewer's written-up feedback.
     */
    try {
      const [entriesNow, stagesNow] = await Promise.all([
        listEvaluationEntries({
          organizationId: membership.organization.id,
          applicationId: id,
        }),
        listJobStages({ organizationId: membership.organization.id, jobId: app.job_id }),
      ]);

      const flags = flagsFromRows(stagesNow);
      const enabledStages = CONFIGURABLE_STAGES.filter(
        (stage): stage is ConfigurableStage => flags[stage] === true
      );

      const verdict = evaluationsComplete({
        entries: entriesNow,
        enabledStages,
        currentStage: app.stage as ApplicationStage,
      });

      if (verdict.complete) {
        await dispatch({
          organizationId: membership.organization.id,
          organizationName: membership.organization.name,
          applicationId: id,
          trigger: "evaluations_complete",
          triggeredBy: user.id,
          webhookUrl: `${request.nextUrl.origin}/api/webhooks/bolna`,
        });
      }
    } catch (automationError) {
      console.error("[api] automations after evaluation log failed:", automationError);
    }

    return NextResponse.json({ data }, { status: 201 });
  } catch (error) {
    return handleRouteError(error);
  }
}
