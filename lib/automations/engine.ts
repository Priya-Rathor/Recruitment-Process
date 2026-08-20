// =============================================================================
// The execution engine.
//
// Dispatch order, and why:
//
//   1. Check the ORGANIZATION KILL SWITCH. Before a single rule is loaded, so
//      "turn all of it off" is one column and takes effect immediately.
//   2. Load the ACTIVE rules for this trigger. Drafts and paused rules never
//      execute — that is the whole point of them.
//   3. Build the evaluation context once, from the database, for all rules.
//   4. CLAIM THE RUN before doing anything. The run row is inserted first, and
//      the unique index on (automation_id, application_id, dedupe_key) is what
//      makes concurrent triggers safe. If the insert conflicts, this occasion
//      has already been handled and we stop — no call, no AI spend.
//   5. Evaluate conditions. Not matching is a SKIP, not a failure.
//   6. Check the DAILY CAP. Over it is BLOCKED, and the rule pauses itself.
//   7. Check integration health. Missing integration is BLOCKED, not failed.
//   8. If the rule requires approval, PROPOSE and stop. Nothing is executed.
//   9. Otherwise execute actions, each recording its own outcome.
//
// Claiming before evaluating means a skipped run also consumes the dedupe key.
// That is deliberate: a rule that did not match on this stage-entry will not
// match on a re-delivery of the same event either, and re-evaluating costs
// database work for no benefit. It also means the run history shows every
// occasion the engine considered, which is what makes "why didn't my automation
// fire?" answerable.
//
// -----------------------------------------------------------------------------
// THE CLIENT IS NOW A PARAMETER, AND THAT IS THE UPGRADE'S CENTRAL CHANGE.
//
// Every query used to call `await createClient()` — the session-bound client. So
// any trigger arriving without a session (Bolna's webhook, the scheduler's cron)
// would have every query denied by RLS: the rule would look active and quietly
// never fire, which is why `screening_call_completed` was refused at activation
// rather than offered.
//
// The engine now takes an `ExecutionMode`, resolves the right client once, and
// threads it through every query and every action it performs itself. That makes
// the webhook trigger and the whole scheduler possible.
//
// It does NOT make the Module 7-9 actions possible: `startScreeningCall`,
// `calculateAndStoreMatch` and `generateReportForApplication` each construct
// their own session client deep inside those modules. `ACTION_MODES` in the
// catalogue records that, and activation refuses a rule that pairs them with a
// sessionless trigger — same honesty rule, applied one level finer.
// =============================================================================
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  ACTION_LABELS,
  CONSEQUENTIAL_ACTIONS,
  approvalIsMandatory,
  describeRule,
  normalizeConditions,
  requiredIntegrationsFor,
  TRIGGER_MODES,
  type Action,
  type ActionType,
  type ConditionGroup,
  type ExecutionMode,
  type TriggerType,
} from "@/lib/automations/catalog";
import { buildDedupeKey, evaluateConditions, type EvaluationContext } from "@/lib/automations/evaluate";
import { getStatus as getBolnaStatus } from "@/lib/integrations/bolna";
import { getStatus as getEmailStatus } from "@/lib/integrations/email";
import { getStatus as getCalendarStatus } from "@/lib/integrations/calendar";
import { getStatus as getLlmStatus } from "@/lib/integrations/llm";
import { getStatus as getN8nStatus, triggerWorkflow } from "@/lib/integrations/n8n";
import { getStatus as getWhatsAppStatus } from "@/lib/integrations/whatsapp";
import { startScreeningCall } from "@/lib/screening/queries";
import { calculateAndStoreMatch } from "@/lib/matching/queries";
import { generateReportForApplication } from "@/lib/screening/reportQueries";
import { canTransition, isApplicationStage, STAGE_LABELS, type ApplicationStage } from "@/lib/applications/stages";
import { logActivity } from "@/lib/activity/log";
import { notify, notifyMany } from "@/lib/notifications/notify";
import { sendTemplatedMessage } from "@/lib/communications/triggers";
import { isCommunicationEvent } from "@/lib/communications/events";
import { findOwnersAndAdmins } from "@/lib/notifications/queries";
import { startOfDayInZone, resolveTimeZone } from "@/lib/time";
import { formatDbError } from "@/lib/supabase/errors";

/**
 * Either Supabase client. The union, not `any` — every call in this file is
 * checked against both, which is what stops a service-mode path quietly
 * depending on something only the session client has.
 */
export type EngineClient =
  | NonNullable<ReturnType<typeof createAdminClient>>
  | Awaited<ReturnType<typeof createClient>>;

export type StoredAutomation = {
  id: string;
  organization_id: string;
  name: string;
  trigger: TriggerType;
  conditions: ConditionGroup[];
  actions: Action[];
  status: "draft" | "active" | "paused";
  required_integrations: string[];
  requires_approval: boolean;
  daily_run_cap: number | null;
};

export type ActionResult = {
  action: ActionType;
  status: "success" | "failed" | "skipped";
  detail: string;
};

export type RunOutcome = {
  automationId: string;
  automationName: string;
  status: "success" | "failed" | "skipped" | "blocked" | "deduped" | "awaiting_approval";
  reason: string | null;
  actionResults: ActionResult[];
};

const AUTOMATION_COLUMNS =
  "id, organization_id, name, trigger, conditions, actions, status, required_integrations, " +
  "requires_approval, daily_run_cap";

/**
 * Resolves the client for a mode.
 *
 * Returns null in service mode when no service-role key is configured, which is
 * a real deployment state and must degrade to "the scheduler cannot run" rather
 * than to a crash or, worse, to silence.
 */
export async function clientFor(mode: ExecutionMode): Promise<EngineClient | null> {
  if (mode === "service") return createAdminClient();
  return await createClient();
}

/**
 * Is this organization's automation engine switched on?
 *
 * Read before any rule is loaded. Returns `unknown` on a failed read rather than
 * defaulting either way: assuming ON would run rules an admin may have disabled,
 * and assuming OFF would silently stop an organization's automation because of a
 * transient database error. Unknown blocks and says so.
 */
export async function readOrganizationGate({
  client,
  organizationId,
}: {
  client: EngineClient;
  organizationId: string;
}): Promise<{ enabled: boolean | null; timeZone: string }> {
  const { data, error } = await client
    .from("organizations")
    .select("automations_enabled, timezone")
    .eq("id", organizationId)
    .maybeSingle();

  if (error || !data) {
    console.error(`[automation] org gate read failed: ${formatDbError(error)}`);
    return { enabled: null, timeZone: resolveTimeZone(null) };
  }

  const row = data as { automations_enabled: boolean | null; timezone: string | null };
  return {
    enabled: row.automations_enabled ?? true,
    timeZone: resolveTimeZone(row.timezone),
  };
}

/**
 * Builds the evaluation context for one application.
 *
 * Every field that cannot be established is left `null` rather than defaulted.
 * `evaluateConditions` fails an unknown field, so a partial load makes rules
 * cautious, never reckless.
 */
export async function buildContext({
  client,
  organizationId,
  applicationId,
}: {
  client: EngineClient;
  organizationId: string;
  applicationId: string;
}): Promise<{ context: EvaluationContext; stageEnteredAt: string | null } | null> {
  const { data, error } = await client
    .from("applications")
    .select(
      "id, stage, match_score, job_id, candidate_id, source, assigned_recruiter_id, created_at, " +
        "candidate:candidates(phone, email), job:jobs(id, status)"
    )
    .eq("id", applicationId)
    .eq("organization_id", organizationId)
    .maybeSingle();

  if (error || !data) return null;

  const application = data as unknown as {
    stage: string;
    match_score: number | null;
    job_id: string | null;
    candidate_id: string | null;
    source: string | null;
    assigned_recruiter_id: string | null;
    created_at: string | null;
    candidate: { phone: string | null; email: string | null } | null;
    job: { id: string; status: string | null } | null;
  };

  // Stage entry, from the trigger-written history. This is both the dedupe key's
  // basis and the source of days_in_stage.
  const { data: stageRow } = await client
    .from("application_stage_history")
    .select("entered_at")
    // organization_id is filtered explicitly even though application_id already
    // pins the row. This function now runs under the SERVICE-ROLE client for
    // webhook and scheduled triggers, and that client bypasses RLS — so the
    // standing rule applies: every query made with it names its tenant.
    .eq("organization_id", organizationId)
    .eq("application_id", applicationId)
    .is("exited_at", null)
    .order("entered_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  const stageEnteredAt = (stageRow as { entered_at: string } | null)?.entered_at ?? null;

  const daysInStage = stageEnteredAt
    ? Math.floor((Date.now() - new Date(stageEnteredAt).getTime()) / 86_400_000)
    : null;

  const daysSinceApplied = application.created_at
    ? Math.floor((Date.now() - new Date(application.created_at).getTime()) / 86_400_000)
    : null;

  let jobHasScreeningQuestions: boolean | null = null;
  if (application.job_id) {
    const { count, error: questionError } = await client
      .from("job_screening_questions")
      .select("id", { count: "exact", head: true })
      .eq("organization_id", organizationId)
      .eq("job_id", application.job_id);
    // A failed count stays null — "we couldn't tell", not "there are none".
    if (!questionError) jobHasScreeningQuestions = (count ?? 0) > 0;
  }

  const { data: callRow } = await client
    .from("screening_calls")
    .select("consent_confirmed")
    .eq("organization_id", organizationId)
    .eq("application_id", applicationId)
    .order("attempt_number", { ascending: false })
    .limit(1)
    .maybeSingle();

  // screening_reports.interest_level IS the authoritative value: Module 9 writes
  // a human's correction over it and preserves the model's original in
  // ai_interest_level. An earlier version of this query selected a
  // `reviewed_interest_level` column that has never existed, which made the
  // whole select fail and left every interest_level condition permanently
  // "unknown" — so any rule using it silently never matched.
  const { data: reportRow } = await client
    .from("screening_reports")
    .select("interest_level")
    .eq("organization_id", organizationId)
    .eq("application_id", applicationId)
    .maybeSingle();

  const report = reportRow as unknown as { interest_level: string | null } | null;

  // Resume presence. A failed read stays null for the same reason as the
  // question count: "we could not tell" is not "they have no resume", and a rule
  // gating an email on having one must not fire on a database hiccup.
  let candidateHasResume: boolean | null = null;
  if (application.candidate_id) {
    const { count, error: resumeError } = await client
      .from("resumes")
      .select("id", { count: "exact", head: true })
      .eq("organization_id", organizationId)
      .eq("candidate_id", application.candidate_id);
    if (!resumeError) candidateHasResume = (count ?? 0) > 0;
  }

  // The most recent evaluation's outcome. Ordered by when the thing HAPPENED,
  // matching how Module 11's list is ordered — a call written up late is still
  // the older evaluation.
  let evaluationOutcome: string | null = null;
  {
    const { data: evaluationRow, error: evaluationError } = await client
      .from("application_evaluations")
      .select("outcome")
      .eq("organization_id", organizationId)
      .eq("application_id", applicationId)
      .order("occurred_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (!evaluationError) {
      evaluationOutcome = (evaluationRow as { outcome: string } | null)?.outcome ?? null;
    }
  }

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
      interestLevel: report?.interest_level ?? null,
      applicationSource: application.source ?? null,
      candidateHasResume,
      daysSinceApplied,
      // A boolean about our OWN column, so absence is a real answer: nobody is
      // assigned. Unlike the counts above, this cannot be "unknown" once the
      // application row loaded at all.
      assignedRecruiterPresent: Boolean(application.assigned_recruiter_id),
      jobIsOpen: application.job ? application.job.status === "open" : null,
      evaluationOutcome,
    },
  };
}

/**
 * Integration health for a rule's requirements.
 *
 * MODULE 17 RETROFIT. This used to carry the spec's forward stub — "for
 * integrations without a real getStatus() yet, default to 'unknown — assume
 * connected'" — because only Bolna had a real check.
 *
 * All five adapters now expose getStatus(), so the fallback is GONE and an
 * unrecognised provider BLOCKS. That is the safe direction and the right one:
 * assume-connected means a rule activates, appears healthy, and fails at run
 * time against a candidate; blocking means an admin is told at activation, when
 * they are looking at the screen and can fix it.
 *
 * Each provider gets a genuine health read, and the reason names the provider
 * so the message is actionable rather than "an integration is missing".
 */
const HEALTH_CHECKS: Record<
  string,
  { read: (organizationId: string) => Promise<{ status: string }>; label: string; why: string }
> = {
  bolna: {
    read: getBolnaStatus,
    label: "Bolna",
    why: "this rule can't place screening calls",
  },
  email: {
    read: getEmailStatus,
    label: "Email",
    why: "this rule can't send external messages",
  },
  calendar: {
    read: getCalendarStatus,
    label: "Google Calendar",
    why: "this rule can't create calendar invites",
  },
  llm: { read: getLlmStatus, label: "the AI provider", why: "this rule can't run AI actions" },
  n8n: { read: getN8nStatus, label: "n8n", why: "this rule can't reach the workflow engine" },
  // MODULE 15's channel. Only ever REQUIRED by a "Send templated message" action
  // whose template is WhatsApp-only — a `both` template requires neither channel,
  // because either one delivering is enough. See requiredIntegrationsFor().
  whatsapp: {
    read: getWhatsAppStatus,
    label: "WhatsApp",
    why: "this rule can't send the WhatsApp message it's configured to send",
  },
};

export async function checkIntegrations({
  organizationId,
  required,
}: {
  organizationId: string;
  required: string[];
}): Promise<{ ok: true } | { ok: false; reason: string }> {
  for (const provider of required) {
    const check = HEALTH_CHECKS[provider];

    if (!check) {
      // No assume-connected fallback. An action declaring a requirement nobody
      // can verify is a bug in the catalogue, and blocking surfaces it now
      // rather than at run time against a real candidate.
      return {
        ok: false,
        reason: `This rule needs an integration this version can't check ("${provider}"), so it can't be activated.`,
      };
    }

    const status = await check.read(organizationId);
    if (status.status !== "connected") {
      return {
        ok: false,
        reason: `${check.label} isn't connected, so ${check.why}. Connect it in Settings.`,
      };
    }
  }

  return { ok: true };
}

/**
 * Runs today, for one rule, in the ORGANIZATION's day.
 *
 * The project rule is that every "today" uses lib/time.ts with the org's
 * configured timezone. A cap counted on the server's midnight would reset in the
 * middle of an Indian working afternoon, which is the sort of thing nobody
 * notices until a rule spends twice its budget on one day.
 */
async function countRunsToday({
  client,
  organizationId,
  automationId,
  timeZone,
}: {
  client: EngineClient;
  organizationId: string;
  automationId: string;
  timeZone: string;
}): Promise<number | null> {
  const since = startOfDayInZone(timeZone).toISOString();

  const { count, error } = await client
    .from("automation_runs")
    .select("id", { count: "exact", head: true })
    // Explicit tenant filter, for the service-role client's sake — see the note
    // in buildContext. automation_id alone would be correct but not compliant.
    .eq("organization_id", organizationId)
    .eq("automation_id", automationId)
    .gte("started_at", since);

  // null, not 0. A failed count must never be read as "well under the cap".
  if (error) {
    console.error(`[automation] cap count failed: ${formatDbError(error)}`);
    return null;
  }
  return count ?? 0;
}

export type ExecuteActionInput = {
  action: Action;
  client: EngineClient;
  mode: ExecutionMode;
  organizationId: string;
  organizationName: string;
  applicationId: string;
  /** The user whose action triggered the rule. Null for a scheduled run. */
  triggeredBy: string | null;
  webhookUrl: string;
  automationName: string;
};

/** Executes one action. Never throws — a thrown action would lose the run record. */
async function executeAction(input: ExecuteActionInput): Promise<ActionResult> {
  const {
    action,
    client,
    mode,
    organizationId,
    organizationName,
    applicationId,
    triggeredBy,
    webhookUrl,
    automationName,
  } = input;

  const useAdminClient = mode === "service";

  try {
    switch (action.type) {
      case "start_screening_call": {
        // Module 8's orchestration, called directly. The spec forbids
        // re-implementing the Bolna request here, and going through
        // startScreeningCall() also inherits the retry cap, the consent
        // disclosure and the "candidate asked for a callback" refusal — an
        // automation must not have a weaker safety path than the manual button.
        //
        // Session-only: it builds its own session client internally. The
        // catalogue records that and activation refuses the bad pairing, so
        // reaching here in service mode would be a bug — hence the explicit
        // refusal rather than an attempt that RLS would deny with no explanation.
        if (mode === "service" || !triggeredBy) {
          return {
            action: action.type,
            status: "failed",
            detail: "Screening calls can't be placed by the scheduler or a webhook.",
          };
        }

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
        if (mode === "service") {
          return {
            action: action.type,
            status: "failed",
            detail: "Match scoring can't run without a signed-in user.",
          };
        }

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
        if (mode === "service") {
          return {
            action: action.type,
            status: "failed",
            detail: "Report generation can't run without a signed-in user.",
          };
        }

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

        const { data: existing } = await client
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

        const { error } = await client
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
            useAdminClient,
          });
        }

        return error
          ? { action: action.type, status: "failed", detail: "Could not move the application." }
          : { action: action.type, status: "success", detail: `Moved to ${target}.` };
      }

      case "add_note": {
        const text =
          (action.config?.text as string)?.trim() ||
          `Automation "${automationName}" ran on this application.`;

        const { error } = await client.from("application_notes").insert({
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
            useAdminClient,
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
        const { data: assignment } = await client
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

        // A SCHEDULED run has no triggering user to fall back on. Rather than
        // pick someone, it says nobody was assigned — which is both true and the
        // thing to fix. Broadcasting to the whole team is how a notification
        // centre becomes noise (Module 19's reminders make the same call).
        if (!recipient) {
          return {
            action: action.type,
            status: "skipped",
            detail: "Nobody is assigned to this application, so there was no one to notify.",
          };
        }

        const result = await notify({
          organizationId,
          userId: recipient,
          type: "assigned_to_application",
          values: {
            candidate_name: row?.candidate?.name ?? null,
            job_title: row?.job?.title ?? null,
          },
          linkPath: `/applications/${applicationId}`,
          useAdminClient,
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

      /**
       * THE ONLY ACTION THAT SPEAKS TO A CANDIDATE IN WRITING.
       *
       * Three constraints, all of them structural rather than a matter of the
       * template's wording:
       *
       *   - It goes through Module 15's notify() with an approved EXTERNAL
       *     template. The facts (candidate name, job title, stage) are fixed
       *     placeholders; there is no free-text field a rule can fill.
       *   - A rule containing it CANNOT have approval switched off
       *     (`approvalIsMandatory`), so a person reads the proposal first.
       *   - No email address, no send. Not a guess, not a fallback to the
       *     recruiter — that would mail a colleague a message addressed to a
       *     candidate.
       */
      case "send_candidate_email": {
        const { data: row } = await client
          .from("applications")
          .select("stage, candidate:candidates(name, email), job:jobs(title)")
          .eq("id", applicationId)
          .eq("organization_id", organizationId)
          .maybeSingle();

        const application = row as unknown as {
          stage: string;
          candidate: { name: string | null; email: string | null } | null;
          job: { title: string | null } | null;
        } | null;

        const address = application?.candidate?.email?.trim();
        if (!address) {
          return {
            action: action.type,
            status: "skipped",
            detail: "The candidate has no email address on file, so nothing was sent.",
          };
        }

        // The recipient of the notification ROW is still an internal user — the
        // in-app copy is the recruiter's record that it went out. emailOverride
        // is what sends the message itself to the candidate.
        const { data: assignment } = await client
          .from("applications")
          .select("assigned_recruiter_id")
          .eq("id", applicationId)
          .eq("organization_id", organizationId)
          .maybeSingle();

        const owner =
          (assignment as { assigned_recruiter_id: string | null } | null)?.assigned_recruiter_id ??
          triggeredBy;

        if (!owner) {
          return {
            action: action.type,
            status: "skipped",
            detail:
              "Nobody is assigned to this application, so there is no recruiter to record the email against.",
          };
        }

        const rawStage = application?.stage ?? null;
        const stageLabel = isApplicationStage(rawStage) ? STAGE_LABELS[rawStage] : rawStage;

        const result = await notify({
          organizationId,
          userId: owner,
          type: "candidate_stage_update",
          values: {
            candidate_name: application?.candidate?.name ?? null,
            job_title: application?.job?.title ?? null,
            stage_name: stageLabel,
            organization_name: organizationName,
          },
          linkPath: `/applications/${applicationId}`,
          emailOverride: address,
          useAdminClient,
        });

        if (result.emailStatus !== "sent") {
          return {
            action: action.type,
            status: "failed",
            detail:
              result.detail ??
              "The email could not be sent. The candidate has not been contacted.",
          };
        }

        return {
          action: action.type,
          status: "success",
          detail: "Stage update emailed to the candidate.",
        };
      }

      /**
       * MODULE 15 — "Send templated message".
       *
       * The organization's OWN template library, not a template that lives in
       * this codebase. Which is the whole point of the action: `send_candidate_email`
       * can only ever send the one stage-update wording we wrote, and the spec
       * asks for an org to be able to combine message-sending with other actions
       * on any trigger it likes, using words it approved.
       *
       * Everything about the send itself — opt-out enforcement, the unsubscribe
       * footer, the log row, one-per-application dedupe, email and WhatsApp being
       * independent — belongs to lib/communications/send.ts and happens the same
       * way it does for a built-in trigger. Nothing about messaging is
       * reimplemented here.
       *
       * WHY A SKIP RATHER THAN A FAILURE IN MOST CASES. A deactivated template, a
       * candidate who opted out, an unconnected WhatsApp: none of these is a
       * broken rule, and marking them failed would pause a working automation
       * (`paused_reason`) over an organization's own settings.
       */
      case "send_templated_message": {
        const templateId = action.config?.template_id;
        if (typeof templateId !== "string") {
          return {
            action: action.type,
            status: "failed",
            detail: "No message template is configured on this action.",
          };
        }

        const eventKey = isCommunicationEvent(action.config?.event_key)
          ? action.config.event_key
          : null;

        const result = await sendTemplatedMessage({
          client,
          organizationId,
          applicationId,
          templateId,
          eventKey,
        });

        if (result.status === "sent") {
          const channels = result.outcomes
            .filter((outcome) => outcome.delivered)
            .map((outcome) => (outcome.channel === "email" ? "email" : "WhatsApp"));

          return {
            action: action.type,
            status: "success",
            detail: `"${result.templateName ?? "Message"}" sent by ${channels.join(" and ")}.`,
          };
        }

        if (result.status === "failed") {
          return {
            action: action.type,
            status: "failed",
            detail: result.detail ?? "The message could not be sent.",
          };
        }

        return {
          action: action.type,
          status: "skipped",
          detail: result.detail ?? "Nothing was sent.",
        };
      }

      case "assign_recruiter": {
        const strategy = action.config?.strategy;

        let assignee: string | null = null;
        if (strategy === "specific_user") {
          assignee = (action.config?.user_id as string) ?? null;

          // Membership is verified before writing. A user id in a rule's config
          // is client-authored data, and assigning a stranger's id would leak an
          // application into someone else's queue — the exact thing
          // organization_members' wide SELECT policy makes easy to get wrong.
          if (assignee) {
            const { data: member } = await client
              .from("organization_members")
              .select("user_id")
              .eq("organization_id", organizationId)
              .eq("user_id", assignee)
              .maybeSingle();

            if (!member) {
              return {
                action: action.type,
                status: "failed",
                detail: "That recruiter is no longer a member of this organization.",
              };
            }
          }
        }

        const { data: current } = await client
          .from("applications")
          .select(
            "assigned_recruiter_id, candidate:candidates(name), job:jobs(title, owner_recruiter_id)"
          )
          .eq("id", applicationId)
          .eq("organization_id", organizationId)
          .maybeSingle();

        const row = current as unknown as {
          assigned_recruiter_id: string | null;
          candidate: { name: string | null } | null;
          job: { title: string | null; owner_recruiter_id: string | null } | null;
        } | null;

        // 'job_owner' means the job's owning recruiter. Resolved from the same
        // read as the current assignee so the two cannot disagree.
        if (strategy !== "specific_user") {
          assignee = row?.job?.owner_recruiter_id ?? null;
        }

        if (!assignee) {
          return {
            action: action.type,
            status: "skipped",
            detail: "There was nobody to assign — the job has no owning recruiter recorded.",
          };
        }

        const existingAssignee = row?.assigned_recruiter_id ?? null;

        // Never reassign over a person. A recruiter working an application must
        // not have it taken off them by a rule; "already assigned" is a skip.
        if (existingAssignee) {
          return {
            action: action.type,
            status: "skipped",
            detail:
              existingAssignee === assignee
                ? "Already assigned to that recruiter."
                : "Somebody is already assigned, so this was left alone.",
          };
        }

        const { error } = await client
          .from("applications")
          .update({ assigned_recruiter_id: assignee })
          .eq("id", applicationId)
          .eq("organization_id", organizationId);

        if (error) {
          return { action: action.type, status: "failed", detail: "Could not assign a recruiter." };
        }

        await logActivity({
          organizationId,
          entityType: "application",
          entityId: applicationId,
          eventType: "application.recruiter_assigned",
          actorId: triggeredBy,
          actorLabel: `Automation: ${automationName}`,
          metadata: { assigned_to: assignee },
          useAdminClient,
        });

        // The assignee learns about it, because an application appearing in
        // somebody's queue silently is how work gets dropped. The names are real
        // values, not nulls: notify() treats a missing fixed fact as a hard
        // failure rather than rendering "You've been assigned not recorded".
        await notify({
          organizationId,
          userId: assignee,
          type: "assigned_to_application",
          values: {
            candidate_name: row?.candidate?.name ?? null,
            job_title: row?.job?.title ?? null,
          },
          linkPath: `/applications/${applicationId}`,
          useAdminClient,
        });

        return { action: action.type, status: "success", detail: "Recruiter assigned." };
      }

      /**
       * The n8n hand-off — and the point at which the adapter stops being
       * decorative.
       *
       * The engine still executes rules in-process; this does not change that.
       * What it does is give a rule a way to reach the workflows an organization
       * has already built in n8n, with the org's own credentials, over a path
       * inside their own instance (validated in the catalogue — a rule cannot
       * name an arbitrary host).
       *
       * The payload is IDS AND STAGE ONLY. No candidate name, email or phone: the
       * moment this posts personal data to a third-party workflow engine it
       * becomes a data-processing decision an admin never made.
       */
      case "call_n8n_webhook": {
        const { data: row } = await client
          .from("applications")
          .select("stage, candidate_id, job_id")
          .eq("id", applicationId)
          .eq("organization_id", organizationId)
          .maybeSingle();

        const application = row as {
          stage: string;
          candidate_id: string;
          job_id: string;
        } | null;

        const result = await triggerWorkflow({
          organizationId,
          path: (action.config?.path as string) ?? "",
          payload: {
            event: "automation",
            automation: automationName,
            application_id: applicationId,
            candidate_id: application?.candidate_id ?? null,
            job_id: application?.job_id ?? null,
            stage: application?.stage ?? null,
          },
        });

        return result.ok
          ? { action: action.type, status: "success", detail: result.data }
          : { action: action.type, status: "failed", detail: result.error };
      }

      default:
        return { action: action.type, status: "failed", detail: "Unknown action." };
    }
  } catch (error) {
    console.error(`[automation] action threw: ${formatDbError(error)}`);
    return { action: action.type, status: "failed", detail: "The action failed unexpectedly." };
  }
}

export type DispatchInput = {
  organizationId: string;
  organizationName: string;
  applicationId: string;
  trigger: TriggerType;
  /** The user whose action caused the trigger. Null for webhook/scheduled runs. */
  triggeredBy: string | null;
  webhookUrl: string;
  /** True for the "test this rule" path: evaluate and report, execute nothing. */
  dryRun?: boolean;
  /** Restricts dispatch to one rule, for the test button. */
  onlyAutomationId?: string;
  /**
   * Which client to use. Defaults to the trigger's declared mode, which is what
   * every route caller wants; the sweep passes it explicitly.
   */
  mode?: ExecutionMode;
  /** Reuses a client the caller already resolved — the sweep, per application. */
  client?: EngineClient;
  /** Org timezone, when the caller already read it. Saves a query per dispatch. */
  timeZone?: string;
  /** Set by the sweep so the run records that nobody was there. */
  scheduled?: boolean;
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
    const mode = input.mode ?? TRIGGER_MODES[input.trigger] ?? "session";

    const client = input.client ?? (await clientFor(mode));
    if (!client) {
      // Service mode with no service-role key. Loud, because it means the
      // scheduler and the Bolna webhook cannot run any rule at all.
      console.error(
        "[automation] no service-role client configured; sessionless triggers cannot run"
      );
      return [];
    }

    const gate =
      input.timeZone !== undefined
        ? { enabled: true as boolean | null, timeZone: input.timeZone }
        : await readOrganizationGate({ client, organizationId: input.organizationId });

    if (gate.enabled !== true) {
      // Nothing is claimed and nothing is recorded: with the engine switched off
      // there was no occasion, and filling the run history with "the switch is
      // off" rows would bury the runs that matter.
      if (gate.enabled === null) {
        console.error("[automation] could not read the organization's automation switch; stopping");
      }
      return [];
    }

    let query = client
      .from("automations")
      .select(AUTOMATION_COLUMNS)
      .eq("organization_id", input.organizationId)
      .eq("trigger", input.trigger)
      .eq("status", "active");

    if (input.onlyAutomationId) query = query.eq("id", input.onlyAutomationId);

    const { data, error } = await query;
    if (error) {
      console.error(`[automation] loading rules failed: ${formatDbError(error)}`);
      return [];
    }

    const automations = (data ?? []) as unknown as StoredAutomation[];
    if (automations.length === 0) return [];

    const built = await buildContext({
      client,
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
          client,
          mode,
          timeZone: gate.timeZone,
          context: built.context,
          stageEnteredAt: built.stageEnteredAt,
        })
      );
    }

    return outcomes;
  } catch (error) {
    console.error(`[automation] dispatch failed: ${formatDbError(error)}`);
    return [];
  }
}

async function runOne({
  automation,
  input,
  client,
  mode,
  timeZone,
  context,
  stageEnteredAt,
}: {
  automation: StoredAutomation;
  input: DispatchInput;
  client: EngineClient;
  mode: ExecutionMode;
  timeZone: string;
  context: EvaluationContext;
  stageEnteredAt: string | null;
}): Promise<RunOutcome> {
  const dedupeKey = buildDedupeKey({
    trigger: input.trigger,
    stage: context.stage,
    stageEnteredAt,
  });

  const evaluation = evaluateConditions(normalizeConditions(automation.conditions), context);

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
  const { data: claimed, error: claimError } = await client
    .from("automation_runs")
    .insert({
      organization_id: input.organizationId,
      automation_id: automation.id,
      application_id: input.applicationId,
      status: "skipped",
      dedupe_key: dedupeKey,
      reason: "Running…",
      trigger: input.trigger,
      scheduled: input.scheduled === true,
      triggered_by: input.triggeredBy,
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
  const useAdminClient = mode === "service";

  const finish = async (
    status: RunOutcome["status"],
    reason: string | null,
    actionResults: ActionResult[],
    errorMessage: string | null = null
  ): Promise<RunOutcome> => {
    const chargeable = actionResults.filter(
      (result) => result.status === "success" && CONSEQUENTIAL_ACTIONS.includes(result.action)
    ).length;

    // awaiting_approval leaves finished_at NULL: the run is not over, and
    // migration 0029's trigger allows exactly one later completion.
    const terminal = status !== "awaiting_approval";

    const { error: updateError } = await client
      .from("automation_runs")
      .update({
        // 'deduped' never reaches here; the enum has no such value by design.
        status: status === "deduped" ? "skipped" : status,
        reason,
        error_message: errorMessage,
        action_results: actionResults,
        chargeable_actions: chargeable,
        finished_at: terminal ? new Date().toISOString() : null,
      })
      .eq("id", runId)
      .eq("organization_id", input.organizationId);

    // Loud, because this is what broke silently before migration 0029: the
    // claim succeeded, the completion was discarded by RLS, and every run in the
    // product read "Running…" forever. If it happens again it must be visible.
    if (updateError) {
      console.error(
        `[automation] could not complete run ${runId}: ${formatDbError(updateError)}`
      );
    }

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
        scheduled: input.scheduled === true,
      },
      useAdminClient,
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
          useAdminClient,
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

  /**
   * THE DAILY CAP.
   *
   * 0012's dedupe index bounds a rule to one run per application per occasion.
   * That says nothing about a rule loose across a thousand applications — a
   * mis-set condition on a bulk import, and the cap is the only thing between
   * that and a thousand screening calls.
   *
   * Hitting it PAUSES the rule and records why. Blocking the run alone would
   * mean the rule keeps trying all day and the admin finds out from the invoice.
   */
  if (automation.daily_run_cap !== null && automation.daily_run_cap > 0) {
    const runsToday = await countRunsToday({
      client,
      organizationId: input.organizationId,
      automationId: automation.id,
      timeZone,
    });

    if (runsToday === null) {
      return finish(
        "blocked",
        "Couldn't check this rule's daily limit, so it didn't run. Nothing was spent.",
        []
      );
    }

    // Strictly greater: this run's own claim is already counted.
    if (runsToday > automation.daily_run_cap) {
      const reason = `Daily limit of ${automation.daily_run_cap} reached, so this rule paused itself.`;

      await client
        .from("automations")
        .update({
          status: "paused",
          activated_by: null,
          activated_at: null,
          paused_reason: reason,
        })
        .eq("id", automation.id)
        .eq("organization_id", input.organizationId);

      const admins = await findOwnersAndAdmins(input.organizationId);
      await notifyMany(
        admins.map((userId) => ({
          organizationId: input.organizationId,
          userId,
          type: "automation_failed" as const,
          values: { automation_name: automation.name, reason },
          linkPath: `/automations/${automation.id}`,
          useAdminClient,
        }))
      );

      return finish("blocked", reason, []);
    }
  }

  const required =
    automation.required_integrations?.length > 0
      ? automation.required_integrations
      : requiredIntegrationsFor(automation.actions ?? []);

  const health = await checkIntegrations({ organizationId: input.organizationId, required });
  if (!health.ok) {
    return finish("blocked", health.reason, []);
  }

  /**
   * HUMAN OVERSIGHT.
   *
   * A rule marked requires_approval does not act — it PROPOSES. The actions are
   * snapshotted into automation_approvals and the run parks at
   * awaiting_approval, which is a distinct status precisely so it does not read
   * as a success (it did nothing) or a failure (nothing is wrong).
   *
   * The dedupe key is still consumed. A proposal per occasion, not a proposal
   * per delivery of the same event.
   */
  if (automation.requires_approval || approvalIsMandatory(automation.actions ?? [])) {
    const summary = describeRule({
      trigger: automation.trigger,
      conditions: normalizeConditions(automation.conditions),
      actions: automation.actions ?? [],
    });

    const { error: approvalError } = await client.from("automation_approvals").insert({
      organization_id: input.organizationId,
      automation_id: automation.id,
      run_id: runId,
      application_id: input.applicationId,
      actions: automation.actions ?? [],
      summary,
    });

    if (approvalError) {
      return finish(
        "failed",
        "Couldn't create the approval request, so nothing was done.",
        [],
        formatDbError(approvalError)
      );
    }

    const admins = await findOwnersAndAdmins(input.organizationId);
    await notifyMany(
      admins.map((userId) => ({
        organizationId: input.organizationId,
        userId,
        type: "automation_needs_approval" as const,
        values: { automation_name: automation.name },
        linkPath: `/automations/approvals`,
        useAdminClient,
      }))
    );

    return finish(
      "awaiting_approval",
      "Conditions matched. Waiting for someone to approve these actions — nothing has run.",
      []
    );
  }

  const actionResults: ActionResult[] = [];
  for (const action of automation.actions ?? []) {
    actionResults.push(
      await executeAction({
        action,
        client,
        mode,
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

/**
 * Executes the actions a human just approved.
 *
 * Runs the SNAPSHOT from the approval row, not the rule's current actions. If
 * somebody edited the rule between proposal and approval, the approver's click
 * still means what they were shown — the same reasoning as Module 19's document
 * snapshots.
 *
 * Always session mode: a person is pressing the button, so every action is
 * available, including the ones the scheduler cannot run. That is a genuine
 * feature of the approval path rather than an accident of it — "propose at 3am,
 * a human approves at 9am and the call goes out" is exactly how a time-based
 * screening rule works.
 */
export async function executeApprovedActions({
  organizationId,
  organizationName,
  applicationId,
  runId,
  actions,
  automationName,
  approvedBy,
  webhookUrl,
}: {
  organizationId: string;
  organizationName: string;
  applicationId: string;
  runId: string;
  actions: Action[];
  automationName: string;
  approvedBy: string;
  webhookUrl: string;
}): Promise<{ status: "success" | "failed"; actionResults: ActionResult[] }> {
  const client = await createClient();

  const actionResults: ActionResult[] = [];
  for (const action of actions) {
    actionResults.push(
      await executeAction({
        action,
        client,
        mode: "session",
        organizationId,
        organizationName,
        applicationId,
        // The approver is the actor. They are the person who decided this
        // happens, which is the whole point of recording an approval.
        triggeredBy: approvedBy,
        webhookUrl,
        automationName,
      })
    );
  }

  const failed = actionResults.filter((result) => result.status === "failed");
  const status = failed.length > 0 ? "failed" : "success";

  const chargeable = actionResults.filter(
    (result) => result.status === "success" && CONSEQUENTIAL_ACTIONS.includes(result.action)
  ).length;

  // Completes the parked run. Migration 0029's trigger permits this exactly once
  // — finished_at was null while the proposal stood, and is set here.
  const { error } = await client
    .from("automation_runs")
    .update({
      status,
      reason:
        failed.length > 0
          ? `Approved, then ${failed.length} of ${actionResults.length} actions failed.`
          : `Approved and completed.`,
      error_message: failed.length > 0 ? failed.map((result) => result.detail).join(" ") : null,
      action_results: actionResults,
      chargeable_actions: chargeable,
      finished_at: new Date().toISOString(),
    })
    .eq("id", runId)
    .eq("organization_id", organizationId);

  if (error) {
    console.error(`[automation] could not complete approved run: ${formatDbError(error)}`);
  }

  await logActivity({
    organizationId,
    entityType: "application",
    entityId: applicationId,
    eventType: "automation.run",
    actorId: approvedBy,
    actorLabel: `Automation: ${automationName}`,
    metadata: {
      name: automationName,
      status,
      reason: `Approved by a person, then ${status === "success" ? "completed" : "failed"}.`,
      approved: true,
    },
  });

  return { status, actionResults };
}

/** Human-readable summary of what a run's actions did, for the UI. */
export function summarizeActionResults(results: ActionResult[]): string {
  if (results.length === 0) return "No actions ran.";
  return results
    .map((result) => `${ACTION_LABELS[result.action] ?? result.action}: ${result.detail}`)
    .join(" ");
}
