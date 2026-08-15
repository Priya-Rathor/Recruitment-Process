// =============================================================================
// The execution engine.
//
// Dispatch order, and why:
//
//   1. Load the ACTIVE rules for this trigger. Drafts and paused rules never
//      execute — that is the whole point of them.
//   2. Build the evaluation context once, from the database, for all rules.
//   3. CLAIM THE RUN before doing anything. The run row is inserted first, and
//      the unique index on (automation_id, application_id, dedupe_key) is what
//      makes concurrent triggers safe. If the insert conflicts, this occasion
//      has already been handled and we stop — no call, no AI spend.
//   4. Evaluate conditions. Not matching is a SKIP, not a failure.
//   5. Check integration health. Missing integration is BLOCKED, not failed.
//   6. Execute actions, each recording its own outcome.
//
// Claiming before evaluating means a skipped run also consumes the dedupe key.
// That is deliberate: a rule that did not match on this stage-entry will not
// match on a re-delivery of the same event either, and re-evaluating costs
// database work for no benefit. It also means the run history shows every
// occasion the engine considered, which is what makes "why didn't my automation
// fire?" answerable.
// =============================================================================
import { createClient } from "@/lib/supabase/server";
import {
  requiredIntegrationsFor,
  type Action,
  type ActionType,
  type Condition,
  type TriggerType,
} from "@/lib/automations/catalog";
import { buildDedupeKey, evaluateConditions, type EvaluationContext } from "@/lib/automations/evaluate";
import { getStatus as getBolnaStatus } from "@/lib/integrations/bolna";
import { startScreeningCall } from "@/lib/screening/queries";
import { calculateAndStoreMatch } from "@/lib/matching/queries";
import { generateReportForApplication } from "@/lib/screening/reportQueries";
import { canTransition, isApplicationStage, type ApplicationStage } from "@/lib/applications/stages";
import { logActivity } from "@/lib/activity/log";
import { notify, notifyMany } from "@/lib/notifications/notify";
import { findOwnersAndAdmins } from "@/lib/notifications/queries";

export type StoredAutomation = {
  id: string;
  organization_id: string;
  name: string;
  trigger: TriggerType;
  conditions: Condition[];
  actions: Action[];
  status: "draft" | "active" | "paused";
  required_integrations: string[];
};

export type ActionResult = {
  action: ActionType;
  status: "success" | "failed" | "skipped";
  detail: string;
};

export type RunOutcome = {
  automationId: string;
  automationName: string;
  status: "success" | "failed" | "skipped" | "blocked" | "deduped";
  reason: string | null;
  actionResults: ActionResult[];
};

const AUTOMATION_COLUMNS =
  "id, organization_id, name, trigger, conditions, actions, status, required_integrations";

/**
 * Builds the evaluation context for one application.
 *
 * Every field that cannot be established is left `null` rather than defaulted.
 * `evaluateConditions` fails an unknown field, so a partial load makes rules
 * cautious, never reckless.
 */
export async function buildContext({
  organizationId,
  applicationId,
}: {
  organizationId: string;
  applicationId: string;
}): Promise<{ context: EvaluationContext; stageEnteredAt: string | null } | null> {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from("applications")
    .select(
      "id, stage, match_score, job_id, candidate:candidates(phone, email), job:jobs(id)"
    )
    .eq("id", applicationId)
    .eq("organization_id", organizationId)
    .maybeSingle();

  if (error || !data) return null;

  const application = data as unknown as {
    stage: string;
    match_score: number | null;
    job_id: string | null;
    candidate: { phone: string | null; email: string | null } | null;
  };

  // Stage entry, from the trigger-written history. This is both the dedupe key's
  // basis and the source of days_in_stage.
  const { data: stageRow } = await supabase
    .from("application_stage_history")
    .select("entered_at")
    .eq("application_id", applicationId)
    .is("exited_at", null)
    .order("entered_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  const stageEnteredAt = (stageRow as { entered_at: string } | null)?.entered_at ?? null;

  const daysInStage = stageEnteredAt
    ? Math.floor((Date.now() - new Date(stageEnteredAt).getTime()) / 86_400_000)
    : null;

  let jobHasScreeningQuestions: boolean | null = null;
  if (application.job_id) {
    const { count, error: questionError } = await supabase
      .from("job_screening_questions")
      .select("id", { count: "exact", head: true })
      .eq("job_id", application.job_id);
    // A failed count stays null — "we couldn't tell", not "there are none".
    if (!questionError) jobHasScreeningQuestions = (count ?? 0) > 0;
  }

  const { data: callRow } = await supabase
    .from("screening_calls")
    .select("consent_confirmed")
    .eq("organization_id", organizationId)
    .eq("application_id", applicationId)
    .order("attempt_number", { ascending: false })
    .limit(1)
    .maybeSingle();

  const { data: reportRow } = await supabase
    .from("screening_reports")
    .select("interest_level, reviewed_interest_level")
    .eq("organization_id", organizationId)
    .eq("application_id", applicationId)
    .maybeSingle();

  const report = reportRow as unknown as {
    interest_level: string | null;
    reviewed_interest_level: string | null;
  } | null;

  return {
    stageEnteredAt,
    context: {
      stage: application.stage ?? null,
      matchScore: application.match_score,
      candidateHasPhone: application.candidate
        ? Boolean(application.candidate.phone?.trim())
        : null,
      candidateHasEmail: application.candidate
        ? Boolean(application.candidate.email?.trim())
        : null,
      screeningConsentConfirmed: callRow
        ? Boolean((callRow as { consent_confirmed: boolean }).consent_confirmed)
        : null,
      jobHasScreeningQuestions,
      daysInStage,
      // The reviewed value wins: a human confirmed it against what was said.
      interestLevel: report?.reviewed_interest_level ?? report?.interest_level ?? null,
    },
  };
}

/**
 * Integration health for a rule's requirements.
 *
 * The spec's forward-stub: "For integration health, call getStatus() where it
 * exists (Bolna); otherwise default to 'unknown — assume connected' and label it
 * as temporary in the UI."
 *
 * An unknown integration therefore does NOT block. That is the spec's
 * instruction, and it is safe for the integrations it currently covers because
 * none of them contact a person — the one that does, Bolna, has a real check.
 */
export async function checkIntegrations({
  organizationId,
  required,
}: {
  organizationId: string;
  required: string[];
}): Promise<{ ok: true } | { ok: false; reason: string }> {
  for (const provider of required) {
    if (provider === "bolna") {
      const status = await getBolnaStatus(organizationId);
      if (status.status !== "connected") {
        return {
          ok: false,
          reason:
            "Bolna isn't connected, so this rule can't place screening calls. Connect it in Settings.",
        };
      }
      continue;
    }
    // TODO(Module 17): once every adapter exposes getStatus(), remove this
    // assume-connected fallback and treat unknown as blocked.
  }
  return { ok: true };
}

/** Executes one action. Never throws — a thrown action would lose the run record. */
async function executeAction({
  action,
  organizationId,
  organizationName,
  applicationId,
  triggeredBy,
  webhookUrl,
  automationName,
}: {
  action: Action;
  organizationId: string;
  organizationName: string;
  applicationId: string;
  triggeredBy: string;
  webhookUrl: string;
  automationName: string;
}): Promise<ActionResult> {
  try {
    switch (action.type) {
      case "start_screening_call": {
        // Module 8's orchestration, called directly. The spec forbids
        // re-implementing the Bolna request here, and going through
        // startScreeningCall() also inherits the retry cap, the consent
        // disclosure and the "candidate asked for a callback" refusal — an
        // automation must not have a weaker safety path than the manual button.
        const result = await startScreeningCall({
          organizationId,
          applicationId,
          organizationName,
          triggeredBy,
          webhookUrl,
        });
        // Module 14. The route logs this for a manual call; the automation path
        // does not go through the route, so it is logged here too. actorId is
        // the user whose action triggered the rule, with the automation named in
        // the label — nobody chose to make this call personally.
        if (result.ok) {
          await logActivity({
            organizationId,
            entityType: "screening_call",
            entityId: result.callId,
            eventType: "screening_call.started",
            actorId: triggeredBy,
            actorLabel: `Automation: ${automationName}`,
            metadata: { application_id: applicationId, triggered_manually: false },
          });
        }

        return result.ok
          ? { action: action.type, status: "success", detail: "Screening call started." }
          : { action: action.type, status: "failed", detail: result.error };
      }

      case "calculate_match": {
        const result = await calculateAndStoreMatch({ organizationId, applicationId });

        // Module 14, same reasoning as above.
        if (result.ok) {
          await logActivity({
            organizationId,
            entityType: "application",
            entityId: applicationId,
            eventType: "match.calculated",
            actorId: triggeredBy,
            actorLabel: `Automation: ${automationName}`,
            metadata: { score: result.match.overallScore, ai_used: result.match.aiUsed },
          });
        }

        return result.ok
          ? {
              action: action.type,
              status: "success",
              detail: `Match calculated: ${result.match.overallScore}.`,
            }
          : { action: action.type, status: "failed", detail: result.error };
      }

      case "generate_screening_report": {
        const result = await generateReportForApplication({ organizationId, applicationId });

        // Module 14, same reasoning as above.
        if (result.ok) {
          await logActivity({
            organizationId,
            entityType: "screening_report",
            entityId: result.reportId,
            eventType: "screening_report.generated",
            actorId: triggeredBy,
            actorLabel: `Automation: ${automationName}`,
            metadata: { application_id: applicationId },
          });
        }

        return result.ok
          ? {
              action: action.type,
              status: "success",
              detail: "Screening report generated and awaiting review.",
            }
          : { action: action.type, status: "failed", detail: result.error };
      }

      case "move_to_stage": {
        const target = (action.config?.stage as string) ?? "";
        if (!isApplicationStage(target)) {
          return { action: action.type, status: "failed", detail: "That stage no longer exists." };
        }

        const supabase = await createClient();
        const { data: existing } = await supabase
          .from("applications")
          .select("stage")
          .eq("id", applicationId)
          .eq("organization_id", organizationId)
          .maybeSingle();

        if (!existing) {
          return { action: action.type, status: "failed", detail: "Application not found." };
        }

        const current = (existing as { stage: ApplicationStage }).stage;
        const transition = canTransition(current, target);
        if (!transition.allowed) {
          return { action: action.type, status: "skipped", detail: transition.reason };
        }
        if (current === target) {
          return {
            action: action.type,
            status: "skipped",
            detail: "Already in that stage.",
          };
        }

        const { error } = await supabase
          .from("applications")
          .update({ stage: target })
          .eq("id", applicationId)
          .eq("organization_id", organizationId);

        if (!error) {
          // Module 14. This write skips the PATCH route entirely, so without
          // this the timeline would show a candidate arriving in a stage with
          // nothing explaining how they got there.
          await logActivity({
            organizationId,
            entityType: "application",
            entityId: applicationId,
            eventType: "application.stage_changed",
            actorId: triggeredBy,
            actorLabel: `Automation: ${automationName}`,
            metadata: { from: current, to: target },
          });
        }

        return error
          ? { action: action.type, status: "failed", detail: "Could not move the application." }
          : { action: action.type, status: "success", detail: `Moved to ${target}.` };
      }

      case "add_note": {
        const supabase = await createClient();
        const text =
          (action.config?.text as string)?.trim() ||
          `Automation "${automationName}" ran on this application.`;

        const { error } = await supabase.from("application_notes").insert({
          organization_id: organizationId,
          application_id: applicationId,
          author_id: triggeredBy,
          // Attributed, so nobody mistakes an automated note for a colleague's
          // judgement about a candidate.
          body: `[Automation: ${automationName}] ${text}`,
        });

        if (!error) {
          await logActivity({
            organizationId,
            entityType: "application",
            entityId: applicationId,
            eventType: "application.note_added",
            actorId: triggeredBy,
            actorLabel: `Automation: ${automationName}`,
            metadata: {},
          });
        }

        return error
          ? { action: action.type, status: "failed", detail: "Could not add the note." }
          : { action: action.type, status: "success", detail: "Note added." };
      }

      case "notify_recruiter": {
        // MODULE 15 RETROFIT. This was a no-op that returned `skipped` and said
        // so; it now actually notifies.
        //
        // The recipient is the application's ASSIGNED recruiter, not the person
        // whose action triggered the rule — telling someone their own action
        // happened is not a notification. Falls back to the triggering user only
        // when nobody is assigned, so the alert reaches a human either way.
        const supabase = await createClient();
        const { data: assignment } = await supabase
          .from("applications")
          .select("assigned_recruiter_id, candidate:candidates(name), job:jobs(title)")
          .eq("id", applicationId)
          .eq("organization_id", organizationId)
          .maybeSingle();

        const row = assignment as unknown as {
          assigned_recruiter_id: string | null;
          candidate: { name: string } | null;
          job: { title: string } | null;
        } | null;

        const recipient = row?.assigned_recruiter_id ?? triggeredBy;

        const result = await notify({
          organizationId,
          userId: recipient,
          type: "assigned_to_application",
          values: {
            candidate_name: row?.candidate?.name ?? null,
            job_title: row?.job?.title ?? null,
          },
          linkPath: `/applications/${applicationId}`,
        });

        // A muted or unrenderable notification is a skip, not a failure — the
        // rule did its part and nothing is broken.
        if (!result.inAppCreated && result.emailStatus !== "sent") {
          return {
            action: action.type,
            status: "skipped",
            detail: result.detail ?? "Nothing was sent — check notification preferences.",
          };
        }

        return {
          action: action.type,
          status: "success",
          detail:
            result.emailStatus === "sent"
              ? "Recruiter notified in-app and by email."
              : "Recruiter notified in-app.",
        };
      }

      default:
        return { action: action.type, status: "failed", detail: "Unknown action." };
    }
  } catch (error) {
    console.error("[automation] action threw:", error);
    return { action: action.type, status: "failed", detail: "The action failed unexpectedly." };
  }
}

export type DispatchInput = {
  organizationId: string;
  organizationName: string;
  applicationId: string;
  trigger: TriggerType;
  /** The user whose action caused the trigger; recorded as the actor. */
  triggeredBy: string;
  webhookUrl: string;
  /** True for the "test this rule" path: evaluate and report, execute nothing. */
  dryRun?: boolean;
  /** Restricts dispatch to one rule, for the test button. */
  onlyAutomationId?: string;
};

/**
 * Runs every active rule for a trigger against one application.
 *
 * Returns an outcome per rule. Never throws: a failing automation must not take
 * down the stage change or webhook that triggered it. The spec's test — "the
 * automation engine failing does not block the underlying manual action" — is
 * why every caller can ignore the return value safely.
 */
export async function dispatch(input: DispatchInput): Promise<RunOutcome[]> {
  try {
    const supabase = await createClient();

    let query = supabase
      .from("automations")
      .select(AUTOMATION_COLUMNS)
      .eq("organization_id", input.organizationId)
      .eq("trigger", input.trigger)
      .eq("status", "active");

    if (input.onlyAutomationId) query = query.eq("id", input.onlyAutomationId);

    const { data, error } = await query;
    if (error) {
      console.error("[automation] loading rules failed:", error);
      return [];
    }

    const automations = (data ?? []) as unknown as StoredAutomation[];
    if (automations.length === 0) return [];

    const built = await buildContext({
      organizationId: input.organizationId,
      applicationId: input.applicationId,
    });
    if (!built) return [];

    const outcomes: RunOutcome[] = [];

    // Sequential, deliberately. Two rules on the same application can both move
    // its stage; running them concurrently would make the result depend on
    // timing, and "explainable and predictable" rules cannot race each other.
    for (const automation of automations) {
      outcomes.push(
        await runOne({
          automation,
          input,
          context: built.context,
          stageEnteredAt: built.stageEnteredAt,
        })
      );
    }

    return outcomes;
  } catch (error) {
    console.error("[automation] dispatch failed:", error);
    return [];
  }
}

async function runOne({
  automation,
  input,
  context,
  stageEnteredAt,
}: {
  automation: StoredAutomation;
  input: DispatchInput;
  context: EvaluationContext;
  stageEnteredAt: string | null;
}): Promise<RunOutcome> {
  const supabase = await createClient();

  const dedupeKey = buildDedupeKey({
    trigger: input.trigger,
    stage: context.stage,
    stageEnteredAt,
  });

  const evaluation = evaluateConditions(automation.conditions ?? [], context);

  if (input.dryRun) {
    return {
      automationId: automation.id,
      automationName: automation.name,
      status: evaluation.matched ? "success" : "skipped",
      reason: evaluation.reason ?? "All conditions match. Actions were not run — this was a test.",
      actionResults: [],
    };
  }

  // CLAIM FIRST. The insert is the lock: the unique index rejects a second run
  // for the same occasion, so a duplicated event cannot produce a second call.
  const { data: claimed, error: claimError } = await supabase
    .from("automation_runs")
    .insert({
      organization_id: input.organizationId,
      automation_id: automation.id,
      application_id: input.applicationId,
      status: "skipped",
      dedupe_key: dedupeKey,
      reason: "Running…",
    })
    .select("id")
    .single();

  if (claimError || !claimed) {
    // 23505 is unique_violation — this occasion was already handled. Everything
    // else is a real problem and is logged, but neither case may throw.
    const alreadyRan = (claimError as { code?: string } | null)?.code === "23505";
    if (!alreadyRan) console.error("[automation] could not claim run:", claimError);

    return {
      automationId: automation.id,
      automationName: automation.name,
      status: "deduped",
      reason: alreadyRan
        ? "This rule has already run for this application on this stage-entry."
        : "Could not record the run, so it was not executed.",
      actionResults: [],
    };
  }

  const runId = (claimed as { id: string }).id;

  const finish = async (
    status: RunOutcome["status"],
    reason: string | null,
    actionResults: ActionResult[],
    errorMessage: string | null = null
  ): Promise<RunOutcome> => {
    await supabase
      .from("automation_runs")
      .update({
        // 'deduped' never reaches here; the enum has no such value by design.
        status: status === "deduped" ? "skipped" : status,
        reason,
        error_message: errorMessage,
        action_results: actionResults,
        finished_at: new Date().toISOString(),
      })
      .eq("id", runId)
      .eq("organization_id", input.organizationId);

    // Module 14. Logged in finish() rather than at each call-site, so every
    // outcome is captured exactly once however dispatch was reached — including
    // skips and blocks, which are the ones people ask about.
    //
    // actorId is the user whose action triggered the rule, NOT the author of the
    // rule: they are the reason it ran. It reads on the candidate's timeline as
    // "Screen strong matches ran successfully", attributed to the automation by
    // name rather than blamed on whoever moved the stage.
    await logActivity({
      organizationId: input.organizationId,
      entityType: "application",
      entityId: input.applicationId,
      eventType: "automation.run",
      actorId: input.triggeredBy,
      actorLabel: `Automation: ${automation.name}`,
      metadata: {
        name: automation.name,
        automation_id: automation.id,
        status: status === "deduped" ? "skipped" : status,
        reason: reason ?? undefined,
      },
    });

    // MODULE 15 RETROFIT — automation failure alerts.
    //
    // Only FAILURES, and only to Owners/Admins. Notifying on every run would
    // make the notification centre useless within a day, and skips are normal
    // operation. A failure means a rule someone activated is not doing what they
    // think it is doing, which is worth interrupting them for.
    //
    // 'blocked' is included: a rule that cannot run because Bolna is
    // disconnected looks identical to a working one from the automations list.
    if (status === "failed" || status === "blocked") {
      const admins = await findOwnersAndAdmins(input.organizationId);
      await notifyMany(
        admins.map((userId) => ({
          organizationId: input.organizationId,
          userId,
          type: "automation_failed" as const,
          values: {
            automation_name: automation.name,
            reason: reason ?? errorMessage ?? "no reason recorded",
          },
          linkPath: `/automations/${automation.id}`,
        }))
      );
    }

    return {
      automationId: automation.id,
      automationName: automation.name,
      status,
      reason,
      actionResults,
    };
  };

  if (!evaluation.matched) {
    return finish("skipped", evaluation.reason, []);
  }

  const required =
    automation.required_integrations?.length > 0
      ? automation.required_integrations
      : requiredIntegrationsFor(automation.actions ?? []);

  const health = await checkIntegrations({ organizationId: input.organizationId, required });
  if (!health.ok) {
    return finish("blocked", health.reason, []);
  }

  const actionResults: ActionResult[] = [];
  for (const action of automation.actions ?? []) {
    actionResults.push(
      await executeAction({
        action,
        organizationId: input.organizationId,
        organizationName: input.organizationName,
        applicationId: input.applicationId,
        triggeredBy: input.triggeredBy,
        webhookUrl: input.webhookUrl,
        automationName: automation.name,
      })
    );
  }

  const failed = actionResults.filter((result) => result.status === "failed");

  return finish(
    failed.length > 0 ? "failed" : "success",
    failed.length > 0
      ? `${failed.length} of ${actionResults.length} actions failed.`
      : "All actions completed.",
    actionResults,
    failed.length > 0 ? failed.map((result) => result.detail).join(" ") : null
  );
}
