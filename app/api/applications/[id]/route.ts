import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { handleRouteError, jsonError } from "@/lib/api";
import { requireCurrentUser, requireMembership, requireRole } from "@/lib/tenant";
import { dispatch } from "@/lib/automations/engine";
import { trySendForEvent } from "@/lib/communications/triggers";
import { EVENT_FOR_STAGE } from "@/lib/communications/events";
import { logActivityBatch } from "@/lib/activity/log";
import { notify } from "@/lib/notifications/notify";
import { APPLICATION_COLUMNS, getApplicationDetail } from "@/lib/applications/queries";
import {
  canTransition,
  isApplicationStage,
  type ApplicationStage,
} from "@/lib/applications/stages";
import { isCandidateSource, type Application } from "@/lib/types";
import { isApplicationPriority, rejectCandidateFields } from "@/lib/applications/validation";
import { formatDbError } from "@/lib/supabase/errors";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// A stage change may now run automations, which can place a call or score a
// match. Same budget as the other action-bearing routes.
export const maxDuration = 60;

/** GET /api/applications/:id — with stage history and notes. */
export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const membership = await requireMembership();

    const detail = await getApplicationDetail({
      organizationId: membership.organization.id,
      applicationId: id,
    });
    if (!detail) return jsonError("Application not found.", 404);

    return NextResponse.json({ data: detail, caller_role: membership.role });
  } catch (error) {
    return handleRouteError(error);
  }
}

/**
 * PATCH /api/applications/:id — stage moves, recruiter assignment, match score.
 *
 * Stage history is NOT written here: a database trigger records the transition,
 * so it is captured even when the update arrives directly via PostgREST. This
 * handler only enforces the human-facing transition rules and gives a readable
 * error.
 */
export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const membership = await requireRole(["owner", "admin", "recruiter"]);

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return jsonError("Invalid JSON body.", 400);
    }

    // BEFORE anything else. Candidate identity is not editable through an
    // application, and hiding the fields in the UI does not stop a curl. See
    // lib/applications/validation.ts for why present-and-null still counts.
    const guard = rejectCandidateFields(body);
    if (!guard.ok) return jsonError(guard.message, 422);

    const payload = (body ?? {}) as Record<string, unknown>;
    const updates: Record<string, unknown> = {};

    const supabase = await createClient();
    const { data: existing } = await supabase
      .from("applications")
      .select("id, stage, assigned_recruiter_id")
      .eq("id", id)
      .eq("organization_id", membership.organization.id)
      .maybeSingle();

    if (!existing) return jsonError("Application not found.", 404);

    const current = existing as unknown as {
      stage: ApplicationStage;
      assigned_recruiter_id: string | null;
    };

    if ("stage" in payload) {
      if (!isApplicationStage(payload.stage)) return jsonError("Invalid stage.", 400);

      // Blocks reopening a finished application; a re-application is a new row.
      const transition = canTransition(current.stage, payload.stage);
      if (!transition.allowed) return jsonError(transition.reason, 409);

      updates.stage = payload.stage;
    }

    if ("assigned_recruiter_id" in payload) {
      const recruiterId = payload.assigned_recruiter_id;
      if (recruiterId === null) {
        updates.assigned_recruiter_id = null;
      } else if (typeof recruiterId === "string" && UUID_PATTERN.test(recruiterId)) {
        const { data: member } = await supabase
          .from("organization_members")
          .select("user_id")
          .eq("organization_id", membership.organization.id)
          .eq("user_id", recruiterId)
          .eq("status", "active")
          .maybeSingle();
        if (!member) return jsonError("That recruiter is not a member of this team.", 400);
        updates.assigned_recruiter_id = recruiterId;
      } else {
        return jsonError("Invalid recruiter.", 400);
      }
    }

    if ("priority" in payload) {
      if (!isApplicationPriority(payload.priority)) {
        return jsonError("Priority must be Low, Normal or High.", 400);
      }
      updates.priority = payload.priority;
    }

    if ("source" in payload) {
      if (!isCandidateSource(payload.source)) return jsonError("Invalid source.", 400);
      // How this candidate reached THIS job. Distinct from candidates.source,
      // which records how the person entered the system at all — editing one
      // must never touch the other.
      updates.source = payload.source;
    }

    // Accepted so Module 7 can write scores through the same endpoint. Bounded
    // here as well as by the database CHECK.
    if ("match_score" in payload) {
      const score = payload.match_score;
      if (score === null) {
        updates.match_score = null;
      } else {
        const numeric = typeof score === "number" ? score : Number(score);
        if (!Number.isFinite(numeric) || numeric < 0 || numeric > 100) {
          return jsonError("Match score must be between 0 and 100.", 400);
        }
        updates.match_score = numeric;
      }
    }

    if (Object.keys(updates).length === 0) {
      return jsonError("No valid fields provided.", 400);
    }

    const { data, error } = await supabase
      .from("applications")
      .update(updates)
      .eq("id", id)
      .eq("organization_id", membership.organization.id)
      .select(APPLICATION_COLUMNS)
      .maybeSingle();

    if (error) {
      console.error(`[api] application update failed: ${formatDbError(error)}`);
      return jsonError("Could not update the application.", 400);
    }
    if (!data) return jsonError("Application not found.", 404);

    // Module 14. Both changes this endpoint can make, each as its own event.
    // Recorded before the automation dispatch so an automated follow-on action
    // appears after the change that caused it.
    const actor = await requireCurrentUser();
    await logActivityBatch([
      ...(updates.stage && updates.stage !== current.stage
        ? [
            {
              organizationId: membership.organization.id,
              entityType: "application" as const,
              entityId: id,
              eventType: "application.stage_changed" as const,
              actorId: actor.id,
              actorLabel: actor.name ?? actor.email,
              metadata: { from: current.stage, to: updates.stage as string },
            },
          ]
        : []),
      ...("assigned_recruiter_id" in updates &&
      updates.assigned_recruiter_id !== current.assigned_recruiter_id
        ? [
            {
              organizationId: membership.organization.id,
              entityType: "application" as const,
              entityId: id,
              eventType: "application.recruiter_assigned" as const,
              actorId: actor.id,
              actorLabel: actor.name ?? actor.email,
              metadata: { recruiter_id: (updates.assigned_recruiter_id as string) ?? null },
            },
          ]
        : []),
    ]);

    // MODULE 15 RETROFIT — tell a recruiter when work lands on them.
    //
    // Only when the assignee actually CHANGES, and never when someone assigns
    // work to themselves: "you assigned this to you" is not news.
    if (
      "assigned_recruiter_id" in updates &&
      typeof updates.assigned_recruiter_id === "string" &&
      updates.assigned_recruiter_id !== current.assigned_recruiter_id &&
      updates.assigned_recruiter_id !== actor.id
    ) {
      const { data: context } = await supabase
        .from("applications")
        .select("candidate:candidates(name), job:jobs(title)")
        .eq("id", id)
        .eq("organization_id", membership.organization.id)
        .maybeSingle();

      const row = context as unknown as {
        candidate: { name: string } | null;
        job: { title: string } | null;
      } | null;

      await notify({
        organizationId: membership.organization.id,
        userId: updates.assigned_recruiter_id,
        type: "assigned_to_application",
        values: {
          candidate_name: row?.candidate?.name ?? null,
          job_title: row?.job?.title ?? null,
        },
        linkPath: `/applications/${id}`,
      });
    }

    /**
     * MODULE 15 — the candidate-facing message for this stage.
     *
     * BEFORE the automation dispatch, and that ordering is deliberate. A rule can
     * move the application on again (Shortlisted → AI Screening Call), and if the
     * automation ran first the candidate would be told about the stage they ended
     * up in and never about the one a person actually moved them to. Sending first
     * means the message matches the action the recruiter took.
     *
     * Only on a real CHANGE, so re-saving the same stage sends nothing — the
     * once-per-application guard in the send pipeline would catch it anyway, but
     * not asking is cheaper than being refused.
     *
     * EVENT_FOR_STAGE has no entry for phone or video interview: those messages
     * state a time, and a stage move has none. They fire from the scheduling
     * action instead, where a time exists.
     *
     * Awaited and wrapped: a message that cannot be sent must never fail the stage
     * change, which is the same rule the automation dispatch below follows.
     */
    if (updates.stage && updates.stage !== current.stage) {
      const eventKey = EVENT_FOR_STAGE[updates.stage as ApplicationStage];

      if (eventKey) {
        await trySendForEvent({
          organizationId: membership.organization.id,
          applicationId: id,
          eventKey,
          // For the unsubscribe link in the footer.
          origin: request.nextUrl.origin,
        });
      }
    }

    // Module 13. Fires only on a real stage CHANGE, so re-saving the same stage
    // cannot re-trigger a call — the dedupe key would catch it anyway, but not
    // asking is cheaper than being refused.
    //
    // Awaited rather than fired-and-forgotten: a serverless function can be
    // frozen the moment it responds, which would leave an automation half-run
    // with its claim row already written and nothing to finish it. Deliberately
    // wrapped so a failing automation cannot fail the stage change — the spec's
    // test that the engine never blocks the manual action.
    if (updates.stage && updates.stage !== current.stage) {
      try {
        await dispatch({
          organizationId: membership.organization.id,
          organizationName: membership.organization.name,
          applicationId: id,
          trigger: "application_stage_changed",
          triggeredBy: actor.id,
          webhookUrl: `${request.nextUrl.origin}/api/webhooks/bolna`,
        });
      } catch (automationError) {
        console.error("[api] automations after stage change failed:", automationError);
      }
    }

    return NextResponse.json({ data: data as unknown as Application });
  } catch (error) {
    return handleRouteError(error);
  }
}

/**
 * DELETE /api/applications/:id — ARCHIVES.
 *
 * Never a hard delete: this is the row Modules 6-16 hang their data off, and
 * destroying one would orphan screening calls, interviews and analytics history.
 * Owner/Admin only.
 */
export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const membership = await requireRole(["owner", "admin"]);
    const supabase = await createClient();

    const { data, error } = await supabase
      .from("applications")
      .update({ archived_at: new Date().toISOString() })
      .eq("id", id)
      .eq("organization_id", membership.organization.id)
      .is("archived_at", null)
      .select("id, archived_at")
      .maybeSingle();

    if (error) {
      console.error(`[api] application archive failed: ${formatDbError(error)}`);
      return jsonError("Could not archive the application.", 400);
    }
    if (!data) return jsonError("Application not found, or already archived.", 404);

    // Module 14.
    const archiver = await requireCurrentUser();
    await logActivityBatch([
      {
        organizationId: membership.organization.id,
        entityType: "application",
        entityId: id,
        eventType: "application.archived",
        actorId: archiver.id,
        actorLabel: archiver.name ?? archiver.email,
        metadata: {},
      },
    ]);

    return NextResponse.json({ data });
  } catch (error) {
    return handleRouteError(error);
  }
}
