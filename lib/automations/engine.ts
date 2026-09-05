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
import { runResumeShortlist } from "@/lib/workflow/shortlist";
import { buildApplyUrl } from "@/lib/forms/token";
import { describeRecipients, recipientsFrom } from "@/lib/workflow/recipients";
import { BRANCH_TARGET_STAGE, type WorkflowBranch } from "@/lib/workflow/stages";
import { describeDelay, isDelayBasis } from "@/lib/workflow/delay";
import { resolveAnchor, scheduleDelayedAction } from "@/lib/workflow/delayQueue";

/**
 * The site origin, recovered from the Bolna webhook URL the caller passed.
 *
 * Every dispatch already carries `webhookUrl` — an absolute URL built from the
 * request's own origin — because Module 8 needs it. A form link needs the same
 * origin, and taking it from here rather than adding a second parameter means
 * one absolute-URL source rather than two that can disagree about which host
 * this deployment is on.
 *
 * Null when it cannot be parsed, at which point buildApplyUrl() falls back to
 * APP_URL and, failing that, refuses to mint a link rather than sending a
 * relative one nobody can open.
 */
function originFromWebhookUrl(webhookUrl: string): string | null {
  try {
    return new URL(webhookUrl).origin;
  } catch {
    return null;
  }
}

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
  /** Module 25. Null on every rule written before the Stage Workflow Builder. */
  job_id: string | null;
  stage_key: string | null;
  branch: WorkflowBranch;
  source: "manual" | "stage_workflow";
};

export type ActionResult = {
  action: ActionType;
  status: "success" | "failed" | "skipped";
  detail: string;
  /**
   * MODULE 25 — the outcome this action produced, when it produced one.
   *
   * Only `ai_resume_shortlist` sets it today. runOne() collects it and
   * re-dispatches so the On Pass / On Fail lists fire, which is why the verdict
   * travels back up rather than being re-derived from the row afterwards: by
   * then a pass has already moved the application, and reading its state would
   * answer a question about a later moment.
   */
  branch?: WorkflowBranch;
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
  // Module 25's provenance. Read on every dispatch because branch and job_id are
  // both FILTERS, not display fields — a rule that fetched them lazily would
  // have to decide whether to run before it knew whether it applied.
  "requires_approval, daily_run_cap, job_id, stage_key, branch, source";

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
      jobId: application.job_id ?? null,
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
  /*
    KEPT AS A GATE, RENAMED IN THE WARNING.

    The check still runs — a legacy rule with a hand-off action must not activate
    against an unreachable workflow engine. What changed is the LABEL: it named a
    product a customer can no longer see or connect anywhere, so the warning sent
    them looking for an integration card that does not exist. "The workflow
    engine" is what it is from their side.
  */
  n8n: {
    read: getN8nStatus,
    label: "the workflow engine",
    why: "this rule can't reach the workflow engine",
  },
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
  /**
   * MODULE 26 — everything `wait_then` needs to queue a row, and nothing else
   * reads.
   *
   * Threaded through rather than re-fetched inside the handler: the rule's id,
   * stage and branch are already in hand at the call site, and the application's
   * live stage was read into the evaluation context one step earlier. A handler
   * that re-queried for them would be three extra round trips per wait, and the
   * `currentStage` one would additionally be racing the value the rest of the run
   * was evaluated against.
   */
  automationId?: string | null;
  stageKey?: string | null;
  branch?: WorkflowBranch | null;
  currentStage?: string | null;
  /** Position in the rule's action list. Part of the wait's dedupe key. */
  actionIndex?: number;
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
    automationId,
    stageKey,
    branch,
    currentStage,
    actionIndex = 0,
  } = input;

  const useAdminClient = mode === "service";

  /**
   * MODULE 25 — a manual-trigger action is never executed by the engine.
   *
   * It is configuration for a BUTTON on the application, not work to do now.
   * Checked once, above the switch, rather than in each handler: a new action
   * type added later gets this behaviour without its author having to know the
   * rule exists.
   *
   * Reported as `skipped` with a reason, not silently dropped. A run whose only
   * action was manual would otherwise show as an empty success, and the next
   * person would reasonably read that as "the automation ran and did nothing".
   */
  if (action.config?.manual === true) {
    return {
      action: action.type,
      status: "skipped",
      detail: "Set to manual trigger — waiting for a recruiter to run it.",
    };
  }

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
          // MODULE 25. Null on every rule written before it, which resolves to
          // the organization's default agent exactly as it always did.
          voiceAgentId:
            typeof action.config?.agent_id === "string" ? action.config.agent_id : null,
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
          // MODULE 25. Absent on every rule written before it, and
          // recipientsFrom() reads that absence as "the candidate" — which is
          // exactly what those rules have always done.
          recipients: recipientsFrom(action.config),
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

      /**
       * MODULE 25 — AI Resume Shortlisting.
       *
       * The handler is thin on purpose: every decision lives in
       * lib/workflow/shortlist.ts as a pure verdict plus one effectful runner,
       * so the branching rule can be tested without a database and without the
       * engine. What the engine adds is the audit entry and the `branch` it
       * hands back to runOne(), which is what causes the On Pass / On Fail lists
       * to fire.
       */
      case "ai_resume_shortlist": {
        if (mode === "service") {
          return {
            action: action.type,
            status: "failed",
            detail: "Resume shortlisting can't run without a signed-in user.",
          };
        }

        const override = action.config?.passing_score;
        const outcome = await runResumeShortlist({
          client,
          organizationId,
          applicationId,
          passingScoreOverride: typeof override === "number" ? override : null,
          advanceOnPass: action.config?.advance_on_pass !== false,
        });

        await logActivity({
          organizationId,
          entityType: "application",
          entityId: applicationId,
          eventType: "application.resume_screened",
          actorId: triggeredBy,
          actorLabel: `Automation: ${automationName}`,
          metadata: {
            verdict: outcome.verdict,
            score: outcome.score,
            threshold: outcome.threshold,
            advanced: outcome.advanced,
            flagged: outcome.flagged,
          },
        });

        return {
          action: action.type,
          /**
           * A needs_review verdict is a SKIP, not a failure.
           *
           * Nothing went wrong — the job has no passing mark, or the resume
           * could not be scored. Reporting it as failed would put a red row in
           * the run history for a configuration gap, and a run history where
           * red does not mean broken is one nobody reads.
           */
          status: outcome.verdict === "needs_review" ? "skipped" : "success",
          detail: outcome.detail,
          branch: outcome.verdict === "needs_review" ? undefined : outcome.verdict,
        };
      }

      /**
       * MODULE 25 — Request Form.
       *
       * Sends a Module 18 form's link through the Module 15 template machinery.
       * The link is minted per send rather than stored on the rule: a form's
       * token_version is its revocation mechanism, so a URL frozen into a rule
       * would keep working after somebody revoked every link, or stop working
       * for no visible reason after they did.
       */
      case "request_form": {
        const formId = action.config?.form_id;
        const templateId = action.config?.template_id;

        if (typeof formId !== "string" || typeof templateId !== "string") {
          return {
            action: action.type,
            status: "failed",
            detail: "This action is missing its form or its message template.",
          };
        }

        const { data: formRow, error: formError } = await client
          .from("forms")
          .select("id, name, status, token_version")
          .eq("organization_id", organizationId)
          .eq("id", formId)
          .maybeSingle();

        if (formError || !formRow) {
          return {
            action: action.type,
            status: "failed",
            detail: "That form no longer exists, so nothing was sent.",
          };
        }

        const form = formRow as {
          id: string;
          name: string;
          status: string;
          token_version: number;
        };

        // A paused form would hand the candidate a link to a page that refuses
        // them. Skipped rather than failed: somebody switched it off on purpose.
        if (form.status !== "published") {
          return {
            action: action.type,
            status: "skipped",
            detail: `"${form.name}" isn't published, so no link was sent.`,
          };
        }

        const link = await buildApplyUrl({
          formId: form.id,
          tokenVersion: form.token_version,
          origin: originFromWebhookUrl(webhookUrl),
        });

        if (!link) {
          return {
            action: action.type,
            status: "failed",
            detail:
              "The form link could not be built — form link signing isn't configured on this deployment.",
          };
        }

        const formResult = await sendTemplatedMessage({
          client,
          organizationId,
          applicationId,
          templateId,
          eventKey: isCommunicationEvent(action.config?.event_key)
            ? action.config.event_key
            : null,
          recipients: recipientsFrom(action.config),
          // The two tokens this action exists to supply. Merged over the
          // resolved context by sendForEvent().
          extraValues: { "form.link": link, "form.name": form.name },
        });

        if (formResult.status === "sent") {
          return {
            action: action.type,
            status: "success",
            detail: `"${form.name}" sent to ${describeRecipients(recipientsFrom(action.config))}.`,
          };
        }

        return {
          action: action.type,
          status: formResult.status === "failed" ? "failed" : "skipped",
          detail: formResult.detail ?? "The form link was not sent.",
        };
      }

      /**
       * MODULE 25 — Schedule Interview.
       *
       * Unreachable in normal operation: validateRule() refuses to store this
       * action unless it is marked manual, and the manual check above the switch
       * returns before any handler runs. It exists so that a rule stored before
       * that validation — or edited directly through PostgREST — reports a
       * reason instead of falling through to the default and reading as
       * "unknown action".
       */
      case "schedule_interview": {
        return {
          action: action.type,
          status: "skipped",
          detail:
            "Interview scheduling needs a person to choose the time — run it from the application.",
        };
      }

      /**
       * MODULE 26 — "Wait, then…".
       *
       * This handler SCHEDULES; it never executes the nested list. That single
       * fact is what keeps the delay primitive on the product's one clock: the
       * row goes into automation_delayed_actions, and the existing sweep at
       * /api/automations/sweep drains it. There is no timer here, no setTimeout,
       * and nothing that depends on this process still being alive later.
       */
      case "wait_then": {
        if (!automationId) {
          // Only reachable from the dry-run/test path, which has no rule row to
          // hang a queued wait off. Reported rather than silently skipped.
          return {
            action: action.type,
            status: "skipped",
            detail: "A wait can only be scheduled by a saved rule.",
          };
        }

        const basis = isDelayBasis(action.config?.delay_basis)
          ? action.config.delay_basis
          : "after";

        const anchor = await resolveAnchor({
          client,
          organizationId,
          applicationId,
          basis,
        });

        const scheduled = await scheduleDelayedAction({
          client,
          organizationId,
          automationId,
          applicationId,
          stageKey: stageKey ?? "",
          branch: branch ?? "always",
          // The cancellation baseline: the stage the application is in at this
          // instant, which for a fail branch is NOT the rule's stage_key.
          currentStage: currentStage ?? "",
          actionIndex,
          config: action.config,
          anchor,
        });

        if (!scheduled.ok) {
          return { action: action.type, status: "skipped", detail: scheduled.reason };
        }

        const nested = Array.isArray(action.config?.actions) ? action.config.actions.length : 0;
        const minutes = Number(action.config?.delay_minutes ?? 0);

        return {
          action: action.type,
          status: "success",
          detail: scheduled.duplicate
            ? "Already waiting — nothing queued twice."
            : `Queued ${nested} action${nested === 1 ? "" : "s"} for ${describeDelay(minutes)}' time.`,
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
  /**
   * MODULE 25 — which outcome branch this dispatch represents.
   *
   * Defaults to 'always', which is what every caller written before the Stage
   * Workflow Builder means and what every rule written before it stores.
   *
   * THE BRANCH IS DISPATCHED, NOT DERIVED. The alternative was a condition field
   * — "latest outcome is pass" — evaluated per rule, and it would have been
   * wrong in a way that is hard to see: by the time a pass has moved the
   * application to Shortlisted and that move has dispatched its own
   * `application_stage_changed`, "the latest outcome" is a question about a
   * different moment than the one that caused this run. Passing the verdict down
   * from the thing that produced it removes the re-derivation entirely.
   */
  branch?: WorkflowBranch;
  /**
   * MODULE 25 — which stage's branch lists to consult, when that is not the
   * stage the application is currently sitting in.
   *
   * THE FAILED RESUME SCREEN IS THE WHOLE REASON THIS EXISTS.
   *
   * A failed screen leaves the application in Applied — deliberately; it is a
   * flag, not a move. But its "On Fail" actions are filed under Shortlisted,
   * because that is where a recruiter looks for "what happens when somebody is
   * not shortlisted" (see BRANCHING_STAGES). Without this override the stage
   * filter would compare Shortlisted's rules against an application in Applied,
   * find no match, and the On Fail branch would never fire — silently, which is
   * the exact failure mode the brief warns about.
   *
   * Absent, dispatch falls back to the application's real stage, which is right
   * for every other caller.
   */
  branchStage?: string;
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

    const allRules = (data ?? []) as unknown as StoredAutomation[];
    if (allRules.length === 0) return [];

    /**
     * MODULE 25 — branch and job scoping, applied in code rather than in the
     * query.
     *
     * The job filter needs the application's job_id, which `buildContext()`
     * below is what reads. Fetching it a second time to build a narrower
     * `.or()` clause would be one extra round trip on every dispatch, on every
     * trigger, to save filtering a list that is almost always under ten rows.
     *
     * Both filters are written so a rule with NULL provenance passes: those are
     * the organization-wide Module 13 rules, and every one of them must keep
     * behaving exactly as it did before this module existed.
     */
    const dispatchBranch: WorkflowBranch = input.branch ?? "always";

    const built = await buildContext({
      client,
      organizationId: input.organizationId,
      applicationId: input.applicationId,
    });
    if (!built) return [];

    const automations = allRules.filter((automation) => {
      // A branch rule fires only for its own outcome. An 'always' rule fires on
      // every dispatch, INCLUDING a pass or fail one — entering the stage
      // happened regardless of what the verdict turned out to be.
      if (automation.branch !== "always" && automation.branch !== dispatchBranch) return false;

      // A job-scoped rule fires only for its job. An unscoped rule fires for all.
      if (automation.job_id && automation.job_id !== built.context.jobId) return false;

      /**
       * A stage workflow fires only on entry into ITS stage.
       *
       * Redundant with the rule's own `stage` condition in the normal case —
       * the builder writes one — but not redundant when a workflow was created
       * with no conditions at all, which is the state a brand-new stage row is
       * in before anybody adds one. Without this, an empty Video Interview
       * workflow would fire on entry into every stage.
       */
      const effectiveStage = input.branchStage ?? built.context.stage;
      if (automation.stage_key && automation.stage_key !== effectiveStage) return false;

      return true;
    });

    if (automations.length === 0) return [];

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
      // MODULE 25. Which outcome branch this run was dispatched for, so the run
      // history answers "why did this fire?" without opening the rule.
      branch: input.branch ?? "always",
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
  for (const [actionIndex, action] of (automation.actions ?? []).entries()) {
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
        // MODULE 26 — only `wait_then` reads these.
        automationId: automation.id,
        stageKey: automation.stage_key,
        branch: automation.branch,
        currentStage: context.stage,
        actionIndex,
      })
    );
  }

  const failed = actionResults.filter((result) => result.status === "failed");

  const outcome = finish(
    failed.length > 0 ? "failed" : "success",
    failed.length > 0
      ? `${failed.length} of ${actionResults.length} actions failed.`
      : "All actions completed.",
    actionResults,
    failed.length > 0 ? failed.map((result) => result.detail).join(" ") : null
  );

  /**
   * MODULE 25 — THE BRANCH DISPATCH.
   *
   * An action that produced a verdict re-enters dispatch() with that verdict, so
   * the stage's On Pass / On Fail lists fire. This is the mechanism the brief's
   * central test exercises: "an action configured under Shortlisted's On Pass
   * branch fires only when the AI Resume Shortlisting step actually passes".
   *
   * FOUR THINGS ABOUT THE SHAPE OF THIS, EACH PREVENTING A SPECIFIC FAILURE:
   *
   *   1. AWAITED, AFTER `finish()`. The parent run row is written first, so the
   *      run history reads in causal order and a branch run can never appear
   *      before the run that caused it.
   *
   *   2. IT RE-DISPATCHES `application_stage_changed`, not the trigger that got
   *      us here. A pass has MOVED the application to Shortlisted, and the
   *      branch lists hang off the stage the application is now in — which is
   *      what makes "Shortlisted's On Pass branch" mean what it says.
   *
   *   3. ONE LEVEL ONLY, enforced by `branch` being set on the child dispatch:
   *      the branch rules that fire cannot themselves carry an
   *      `ai_resume_shortlist` action, because the catalogue restricts that
   *      action to the Applied stage and the stage filter in dispatch() drops
   *      anything attached elsewhere. Without that pairing this would be a loop.
   *
   *   4. WRAPPED. A failing branch rule must not retroactively fail the run that
   *      produced the verdict — the resume WAS screened and the application WAS
   *      moved, and reporting that as failed would be false.
   */
  const verdict = actionResults.find((result) => result.branch)?.branch;
  if (verdict && !input.dryRun) {
    try {
      await dispatch({
        ...input,
        trigger: "application_stage_changed",
        branch: verdict,
        /**
         * Pinned to the stage that OWNS these branches, not to wherever the
         * application ended up. On a pass those are the same thing (it moved to
         * Shortlisted); on a fail they are not (it stayed in Applied), and
         * reading the live stage would silently drop the On Fail branch.
         */
        branchStage:
          BRANCH_TARGET_STAGE[automation.stage_key as ApplicationStage] ??
          automation.stage_key ??
          undefined,
        // Not reused: the parent's client is correct, but `onlyAutomationId`
        // would pin the child dispatch to the rule that just ran.
        onlyAutomationId: undefined,
        client,
      });
    } catch (error) {
      console.error(`[automation] branch dispatch failed: ${formatDbError(error)}`);
    }
  }

  return outcome;
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

/**
 * MODULE 26 — fires the actions a "Wait, then…" queued, now that it is due.
 *
 * Called only by lib/workflow/delayQueue.ts, from inside the existing sweep.
 *
 * -----------------------------------------------------------------------------
 * WHY THIS WRITES A REAL automation_runs ROW.
 *
 * Because the alternative is a message a candidate received with nothing in the
 * product accounting for it. A recruiter looking at the run history half an hour
 * after a screening call has to be able to see "the thank-you went out" —
 * otherwise the delayed half of a rule is invisible and the history lies by
 * omission about what the automation did.
 *
 * The row carries the SAME automation_id as the run that queued it, so the two
 * appear together on the rule's history: one row for "queued 2 actions for 30
 * minutes' time", a later one for what those actions then did.
 *
 * -----------------------------------------------------------------------------
 * NO CONDITION RE-EVALUATION, DELIBERATELY.
 *
 * The conditions were true when the wait started; that is what the wait is a
 * promise about. Re-checking them here would mean a candidate whose match score
 * was recalculated during the wait silently stops receiving a message they were
 * already owed — and the recruiter would have no way to find out why.
 *
 * The one thing that DOES invalidate the promise is the application moving on,
 * and that is checked (twice: the trigger in migration 0038, and again in
 * drainDueActions before this is called).
 */
export async function executeQueuedActions({
  client,
  organizationId,
  organizationName,
  applicationId,
  automationId,
  actions,
  branch,
  webhookUrl,
}: {
  client: EngineClient;
  organizationId: string;
  organizationName: string;
  applicationId: string;
  automationId: string;
  actions: Action[];
  branch: WorkflowBranch;
  webhookUrl: string;
}): Promise<{ status: "success" | "failed"; reason: string | null; actionResults: ActionResult[] }> {
  const actionResults: ActionResult[] = [];

  // The rule's name, for the run row and for the "Automation: X" actor label on
  // every activity entry these actions write. A deleted rule cannot happen here
  // — the queue row cascades with it — so a missing name is a real anomaly and
  // is named as one rather than rendered as "undefined".
  const { data: ruleRow } = await client
    .from("automations")
    .select("name")
    .eq("id", automationId)
    .eq("organization_id", organizationId)
    .maybeSingle();

  const automationName = (ruleRow as { name: string } | null)?.name ?? "a deleted rule";

  for (const [actionIndex, action] of actions.entries()) {
    actionResults.push(
      await executeAction({
        action,
        client,
        /**
         * SERVICE MODE, ALWAYS.
         *
         * The sweep holds the service-role client and nobody is signed in. The
         * catalogue refuses to nest a session-only action inside a wait for
         * exactly this reason, so anything reaching here can run — but the mode
         * is stated rather than inferred, because a handler that guessed wrong
         * would be denied by RLS with nobody watching.
         */
        mode: "service",
        organizationId,
        organizationName,
        applicationId,
        // Nobody triggered this. The run row records it as scheduled, and every
        // activity entry it writes shows the automation as the actor.
        triggeredBy: null,
        webhookUrl,
        automationName,
        automationId,
        actionIndex,
      })
    );
  }

  const failed = actionResults.filter((result) => result.status === "failed");
  const status = failed.length > 0 ? ("failed" as const) : ("success" as const);
  const reason =
    failed.length > 0
      ? `${failed.length} of ${actionResults.length} actions failed after the wait.`
      : `${actionResults.length} action${actionResults.length === 1 ? "" : "s"} ran after the wait.`;

  const chargeable = actionResults.filter(
    (result) => result.status === "success" && CONSEQUENTIAL_ACTIONS.includes(result.action)
  ).length;

  const { error } = await client.from("automation_runs").insert({
    organization_id: organizationId,
    automation_id: automationId,
    application_id: applicationId,
    status,
    reason,
    action_results: actionResults,
    chargeable_actions: chargeable,
    trigger: "time_elapsed_in_stage",
    scheduled: true,
    triggered_by: null,
    branch,
    /**
     * A dedupe key unique to this firing.
     *
     * The queue row's own partial unique index already guarantees one firing per
     * wait, and the claim in drainDueActions() guarantees one winner among
     * concurrent sweeps. This key only has to avoid colliding with the run rows
     * the same rule wrote earlier — including the one that QUEUED this wait,
     * which shares automation_id and application_id and would otherwise be a
     * unique-index conflict that discarded the record of what actually happened.
     */
    dedupe_key: `wait_fired:${branch}:${new Date().toISOString()}`,
  });

  if (error) {
    // Reported, not swallowed. The actions already ran; losing the record of a
    // message that reached a real person is the worse outcome, and the sweep's
    // summary is where somebody would notice.
    console.error(`[automation] recording a delayed run failed: ${formatDbError(error)}`);
  }

  return { status, reason, actionResults };
}
