// =============================================================================
// The When / If / Then vocabulary.
//
// The spec is explicit that this module is "primarily deterministic — When/If/
// Then rules must be explainable and predictable, so AI is not the execution
// engine". So the catalogue is a closed set: a rule can only be built from
// triggers, fields, operators and actions defined here, and anything else is
// rejected on write.
//
// A closed vocabulary is also what makes the AI drafting assistant safe. It can
// only propose rules expressible in this language, so the worst it can produce
// is a rule that is wrong — never one that does something unanticipated.
// Arbitrary scripting inside rules is explicitly Build Later.
//
// -----------------------------------------------------------------------------
// TWO THINGS THE UPGRADE ADDED TO THIS FILE, AND WHY THEY LIVE HERE
//
// 1. CONDITION GROUPS. Conditions used to be one flat AND-list. "(Java or
//    Kotlin) and score above 75" was inexpressible, and the workaround —
//    duplicate the whole rule per language — is how rule sets become unreadable.
//    A rule is now an AND of groups, each group an ANY or ALL of conditions.
//    Two levels, not arbitrary nesting: two levels covers the real requests and
//    still renders as a sentence a recruiter can check.
//
// 2. EXECUTION MODE. Some triggers arrive with no user session — Bolna's
//    webhook, the scheduler's cron. The engine can run its own actions there
//    with a service-role client, but the actions that call into Modules 7-9
//    (screening call, match, report) create their own session-bound clients
//    inside those modules and would be denied by RLS.
//
//    Rather than let such a rule activate and quietly never work, each action
//    declares which modes can execute it, each trigger declares which mode it
//    arrives in, and activation refuses the combinations that cannot run. This
//    is the same honesty rule that used to make `screening_call_completed`
//    unavailable outright — except now that trigger WORKS, for the subset of
//    actions the engine performs itself.
// =============================================================================

/**
 * The ONLY import in this file, and it is a pure one.
 *
 * This file was import-free by design: a closed vocabulary that depends on
 * nothing cannot be dragged into a client bundle by accident. lib/workflow/
 * recipients.ts preserves that — it has no imports of its own, touches no
 * database and reads no headers, and the builder UI already imports it directly.
 *
 * The alternative was to re-implement recipient validation here, which would
 * have put the rules that decide who receives a message in two files. The first
 * time somebody added a recipient kind to one of them, a rule would validate in
 * the editor and be rejected on save, or worse, the other way round.
 */
import { validateRecipients } from "@/lib/workflow/recipients";

export const TRIGGERS = [
  "application_stage_changed",
  "application_created",
  "screening_call_completed",
  "screening_report_created",
  "interview_completed",
  // Added by the upgrade.
  "evaluations_complete",
  "onboarding_document_uploaded",
  "onboarding_completed",
  "time_elapsed_in_stage",
] as const;

export type TriggerType = (typeof TRIGGERS)[number];

export const TRIGGER_LABELS: Record<TriggerType, string> = {
  application_stage_changed: "An application enters a stage",
  application_created: "An application is created",
  screening_call_completed: "A screening call completes",
  screening_report_created: "A screening report is generated",
  interview_completed: "An interview is completed",
  evaluations_complete: "Every evaluation for an application is in",
  onboarding_document_uploaded: "A new hire uploads an onboarding document",
  onboarding_completed: "A new hire's onboarding is completed",
  time_elapsed_in_stage: "An application has sat in a stage too long",
};

/**
 * Which client the engine has when this trigger arrives.
 *
 * 'session' — a signed-in person's action caused it. Every action is available.
 * 'service' — nobody is signed in. The engine uses the service-role client and
 *             only the actions it performs itself are available.
 */
export type ExecutionMode = "session" | "service";

export const TRIGGER_MODES: Record<TriggerType, ExecutionMode> = {
  application_stage_changed: "session",
  application_created: "session",
  screening_report_created: "session",
  interview_completed: "session",
  evaluations_complete: "session",
  onboarding_document_uploaded: "session",
  onboarding_completed: "session",
  // Bolna's webhook. No session, by definition — the caller is a phone system.
  screening_call_completed: "service",
  // The scheduler. Nobody is there at 3am; that is the point of it.
  time_elapsed_in_stage: "service",
};

/** True for triggers the scheduler produces rather than a user action. */
export const SCHEDULED_TRIGGERS: TriggerType[] = ["time_elapsed_in_stage"];

export function isScheduledTrigger(trigger: TriggerType): boolean {
  return SCHEDULED_TRIGGERS.includes(trigger);
}

/**
 * Where each trigger is dispatched from.
 *
 * Kept as prose because the honest answer to "will my rule actually fire?" is a
 * sentence, and the detail page shows it. Every trigger listed here is wired;
 * the upgrade removed the last unwired one.
 */
export const TRIGGER_SOURCES: Record<TriggerType, string> = {
  application_stage_changed: "when an application's stage changes",
  application_created: "when an application is created, including by bulk intake",
  screening_call_completed: "when Bolna reports a finished call",
  screening_report_created: "when a screening report is generated",
  interview_completed: "when interview feedback is submitted",
  evaluations_complete: "when the last outstanding evaluation is logged",
  onboarding_document_uploaded: "when a document is uploaded against an onboarding record",
  onboarding_completed: "when an onboarding record is marked complete",
  time_elapsed_in_stage: "by the scheduler, once per sweep",
};

export const CONDITION_FIELDS = [
  "stage",
  "match_score",
  "candidate_has_phone",
  "candidate_has_email",
  "screening_consent_confirmed",
  "job_has_screening_questions",
  "days_in_stage",
  "interest_level",
  // Added by the upgrade.
  "application_source",
  "candidate_has_resume",
  "days_since_applied",
  "assigned_recruiter_present",
  "job_is_open",
  "evaluation_outcome",
] as const;

export type ConditionField = (typeof CONDITION_FIELDS)[number];

export const FIELD_LABELS: Record<ConditionField, string> = {
  stage: "Pipeline stage",
  match_score: "Match score",
  candidate_has_phone: "Candidate has a phone number",
  candidate_has_email: "Candidate has an email address",
  screening_consent_confirmed: "Screening consent was recorded",
  job_has_screening_questions: "Job has screening questions",
  days_in_stage: "Days in current stage",
  interest_level: "Screening interest level",
  application_source: "How the application arrived",
  candidate_has_resume: "Candidate has a resume on file",
  days_since_applied: "Days since applying",
  assigned_recruiter_present: "Application has an assigned recruiter",
  job_is_open: "Job is open",
  evaluation_outcome: "Latest evaluation outcome",
};

export const OPERATORS = ["eq", "neq", "gt", "gte", "lt", "lte", "is_true", "is_false"] as const;
export type Operator = (typeof OPERATORS)[number];

export const OPERATOR_LABELS: Record<Operator, string> = {
  eq: "is",
  neq: "is not",
  gt: "is greater than",
  gte: "is at least",
  lt: "is less than",
  lte: "is at most",
  is_true: "is true",
  is_false: "is false",
};

/** Which operators make sense for which field. */
export const FIELD_OPERATORS: Record<ConditionField, Operator[]> = {
  stage: ["eq", "neq"],
  match_score: ["gt", "gte", "lt", "lte", "eq"],
  candidate_has_phone: ["is_true", "is_false"],
  candidate_has_email: ["is_true", "is_false"],
  screening_consent_confirmed: ["is_true", "is_false"],
  job_has_screening_questions: ["is_true", "is_false"],
  days_in_stage: ["gt", "gte", "lt", "lte", "eq"],
  interest_level: ["eq", "neq"],
  application_source: ["eq", "neq"],
  candidate_has_resume: ["is_true", "is_false"],
  days_since_applied: ["gt", "gte", "lt", "lte", "eq"],
  assigned_recruiter_present: ["is_true", "is_false"],
  job_is_open: ["is_true", "is_false"],
  evaluation_outcome: ["eq", "neq"],
};

/**
 * Fields whose value comes from a fixed list.
 *
 * The builder renders a select instead of a text box for these. A rule saying
 * `application_source is jobboard` validates fine and then never matches, which
 * is the silent-failure class this module keeps designing out. `stage` is absent
 * on purpose — its list lives in lib/applications/stages.ts and the form already
 * reads it from there.
 */
export const FIELD_VALUE_OPTIONS: Partial<Record<ConditionField, { value: string; label: string }[]>> =
  {
    interest_level: [
      { value: "high", label: "High" },
      { value: "medium", label: "Medium" },
      { value: "low", label: "Low" },
      { value: "unclear", label: "Unclear" },
    ],
    application_source: [
      { value: "career_page", label: "Career page" },
      { value: "resume_upload", label: "Resume upload" },
      { value: "email", label: "Email" },
      { value: "referral", label: "Referral" },
      { value: "job_board", label: "Job board" },
      { value: "agency_database", label: "Agency database" },
      { value: "manual", label: "Added manually" },
    ],
    evaluation_outcome: [
      { value: "pass", label: "Pass" },
      { value: "fail", label: "Fail" },
      { value: "pending", label: "Pending" },
    ],
  };

export const ACTIONS = [
  "start_screening_call",
  "generate_screening_report",
  "calculate_match",
  "move_to_stage",
  "notify_recruiter",
  "add_note",
  // Added by the upgrade.
  "send_candidate_email",
  "assign_recruiter",
  "call_n8n_webhook",
  // Module 15's candidate communication. See the block comment above
  // ACTION_INTEGRATIONS for why this one's required integrations are computed
  // from its config rather than fixed.
  "send_templated_message",
  /**
   * ADDED BY MODULE 25 (Stage Workflow Builder).
   *
   * All four are ordinary members of this closed vocabulary — the builder does
   * not get a private action list, because a rule it writes has to be
   * executable, explainable and visible on the Module 13 Automations page like
   * every other rule. Adding them here rather than beside the builder is what
   * makes that true.
   *
   * ai_resume_shortlist is the only genuinely new capability. The other three
   * are entry points into engines that already exist (Module 18's forms,
   * Module 11's scheduling, Module 24's agents), reached from a stage.
   */
  "ai_resume_shortlist",
  "request_form",
  "schedule_interview",
] as const;

export type ActionType = (typeof ACTIONS)[number];

/**
 * Actions that still RUN but are no longer OFFERED.
 *
 * `call_n8n_webhook` is retired from the builder because the integration it
 * depends on is no longer customer-facing: an admin could pick the action and
 * then find no card anywhere to connect it, which is a worse outcome than not
 * offering it.
 *
 * IT STAYS IN `ACTIONS` DELIBERATELY. `isActionType()` gates parseActions(), so
 * dropping it would make every stored rule containing it fail to save with
 * "Unknown action" — silently breaking live automations to tidy a picker. The
 * engine's handler stays too, so a rule that already exists keeps working
 * exactly as it did.
 */
export const RETIRED_ACTIONS: ActionType[] = ["call_n8n_webhook"];

export function isRetiredAction(action: ActionType): boolean {
  return RETIRED_ACTIONS.includes(action);
}

/** What the builder offers for a NEW action. Everything not retired. */
export const OFFERED_ACTIONS: ActionType[] = ACTIONS.filter(
  (action) => !RETIRED_ACTIONS.includes(action)
);

export const ACTION_LABELS: Record<ActionType, string> = {
  start_screening_call: "Start an AI screening call",
  generate_screening_report: "Generate the screening report",
  calculate_match: "Calculate the match score",
  move_to_stage: "Move to a stage",
  notify_recruiter: "Notify the assigned recruiter",
  add_note: "Add a note to the application",
  send_candidate_email: "Email the candidate a stage update",
  assign_recruiter: "Assign a recruiter",
  // RETIRED — see RETIRED_ACTIONS. Kept so an existing rule still renders with a
  // readable label instead of a raw slug, and unbranded because the integration
  // it named is no longer something a customer can see or connect.
  call_n8n_webhook: "Hand off to an external workflow",
  send_templated_message: "Send templated message",
  ai_resume_shortlist: "Screen the resume against the passing mark",
  request_form: "Send the candidate a form to complete",
  schedule_interview: "Schedule an interview",
};

/**
 * Which modes can execute each action.
 *
 * The three Module 7-9 actions are session-only: `startScreeningCall`,
 * `calculateAndStoreMatch` and `generateReportForApplication` each build their
 * own session-bound Supabase client internally, so under the service role they
 * would be denied by RLS rather than run. Giving them a service path means
 * threading a client through three modules — a real refactor with tenant-
 * isolation risk, and a follow-up rather than something to fake here.
 *
 * Everything else the engine does itself with whichever client it was handed, so
 * it works in both modes.
 */
export const ACTION_MODES: Record<ActionType, ExecutionMode[]> = {
  start_screening_call: ["session"],
  generate_screening_report: ["session"],
  calculate_match: ["session"],
  move_to_stage: ["session", "service"],
  notify_recruiter: ["session", "service"],
  add_note: ["session", "service"],
  send_candidate_email: ["session", "service"],
  assign_recruiter: ["session", "service"],
  call_n8n_webhook: ["session", "service"],
  // The engine renders and sends this itself, with whichever client it holds, so
  // a scheduled sweep and the Bolna webhook can both run it.
  send_templated_message: ["session", "service"],
  /**
   * SESSION-ONLY, and for the same reason the three Module 7-9 actions above
   * are: it calls calculateAndStoreMatch(), which builds its own session-bound
   * client internally and would be denied by RLS under the service role.
   *
   * This is not a limitation in practice. Every path that creates an application
   * — the API route, bulk intake, a public form submission — dispatches
   * `application_created`, which is a session trigger. A resume cannot arrive
   * without somebody or something signed in having put it there.
   */
  ai_resume_shortlist: ["session"],
  request_form: ["session", "service"],
  // Manual-trigger only (see MANUAL_ONLY_ACTIONS), so the mode list is
  // permissive: whichever client the recruiter's click arrives with will do.
  schedule_interview: ["session", "service"],
};

export function actionRunsIn(action: ActionType, mode: ExecutionMode): boolean {
  return ACTION_MODES[action]?.includes(mode) ?? false;
}

/**
 * Which integration each action needs.
 *
 * Drives the activation check: "a rule cannot be activated if a required
 * integration is disconnected" (the spec's test).
 */
export const ACTION_INTEGRATIONS: Partial<Record<ActionType, string>> = {
  start_screening_call: "bolna",
  // send_candidate_email genuinely cannot work without email — unlike
  // notify_recruiter, whose in-app notification needs no integration at all and
  // whose email is an optional extra. Listing email there would block a rule
  // from activating over a channel it does not depend on.
  send_candidate_email: "email",
  call_n8n_webhook: "n8n",
  /**
   * send_templated_message is DELIBERATELY ABSENT.
   *
   * Its integrations depend on the template it names: an email-only template
   * needs `email`, a WhatsApp one needs `whatsapp`, a `both` template needs
   * either to be useful. A fixed entry here could only name one, and naming
   * `email` would block an organization that runs WhatsApp-only from activating
   * a rule that never touches email.
   *
   * requiredIntegrationsFor() reads the action's config instead — see below.
   *
   * MODULE 25's `request_form` is absent for exactly the same reason: it also
   * names a template, and its channels also come from that template's row.
   *
   * `ai_resume_shortlist` is absent because `calculate_match` is — the matching
   * engine is a first-party capability, not a connected integration, and neither
   * action can be blocked by a disconnected card.
   *
   * `schedule_interview` is absent because it is manual-only: it opens a
   * scheduling screen. Requiring a calendar connection to put a BUTTON on an
   * application would refuse the action to every team that schedules by hand,
   * which is most of them.
   */
};

/**
 * The channels a "Send templated message" action will use.
 *
 * Copied into the action's config from the template at SAVE time by the API,
 * which is also where the template's ownership is verified. Stored rather than
 * looked up so requiredIntegrationsFor() stays a pure function — the activation
 * check, the settings page's dependency list and the builder all call it, and
 * making it asynchronous would push a database read into three UI paths.
 *
 * A stale copy (somebody edits the template's channel afterwards) can only make
 * the activation check more permissive than needed. It cannot make the send
 * wrong: the engine reads the live template every time it runs.
 */
export function messageChannelsFor(action: Action): string[] {
  const raw = action.config?.channels;
  if (!Array.isArray(raw)) return [];
  return raw.filter(
    (channel): channel is string => channel === "email" || channel === "whatsapp"
  );
}

/**
 * Actions that cost money or contact a person. Used to warn an admin before
 * activation, to decide what the dedupe guard must cover, and to fill
 * automation_runs.chargeable_actions.
 */
export const CONSEQUENTIAL_ACTIONS: ActionType[] = [
  "start_screening_call",
  "generate_screening_report",
  "calculate_match",
  "send_candidate_email",
  "send_templated_message",
  // Runs the matching engine — the same LLM spend `calculate_match` incurs.
  "ai_resume_shortlist",
  // Sends the candidate a link and asks them for their time.
  "request_form",
];

/**
 * Actions that never fire automatically, whatever the rule says.
 *
 * `schedule_interview` is here because scheduling needs a slot, and a slot is a
 * negotiation with two diaries. The engine could invent a time, and it would be
 * wrong often enough that every recruiter would learn to check — at which point
 * the automation has cost more attention than it saved. So this action's only
 * mode is the manual trigger: it puts a button on the application that opens
 * Module 11's existing scheduling flow, pre-filled, and a person picks the time.
 *
 * The brief asks for exactly this ("reuse the existing manual-trigger pattern
 * already used for AI Screening Call"), and validateRule() refuses to store the
 * action any other way rather than storing a rule that silently never runs.
 */
export const MANUAL_ONLY_ACTIONS: ActionType[] = ["schedule_interview"];

export function isManualOnly(action: ActionType): boolean {
  return MANUAL_ONLY_ACTIONS.includes(action);
}

/**
 * Actions valid only on a specific pipeline stage.
 *
 * AI Resume Shortlisting screens a resume the moment the application exists, so
 * it belongs to Applied and nowhere else. Offered on Video Interview it would
 * re-score a candidate three rounds after anybody cared about their resume, and
 * — because it moves the application on a pass and flags it on a fail — it would
 * do so destructively.
 *
 * Keyed by ApplicationStage from lib/applications/stages.ts, as plain strings:
 * importing the stage list here would make the vocabulary depend on the pipeline
 * definition, and the check that these strings are real stages belongs in the
 * builder's tests rather than in a type.
 */
export const ACTION_STAGE_RESTRICTIONS: Partial<Record<ActionType, string[]>> = {
  ai_resume_shortlist: ["applied"],
};

/**
 * Actions that reach a candidate directly, with no colleague in between.
 *
 * These FORCE requires_approval on. A rule that telephones or emails a candidate
 * unattended is the one place where "explainable and predictable" is not enough
 * on its own — the message has left before anybody could have objected. The API
 * sets the flag regardless of what the client sent.
 */
export const CANDIDATE_CONTACT_ACTIONS: ActionType[] = [
  "start_screening_call",
  "send_candidate_email",
  "send_templated_message",
  "request_form",
];

/**
 * True when a `send_templated_message` reaches the CANDIDATE specifically.
 *
 * Module 25 made the recipient configurable, and that breaks a flat action-type
 * list: "email the assigned recruiter that a candidate passed" is in
 * CANDIDATE_CONTACT_ACTIONS by type and contacts no candidate at all. Forcing
 * approval on it would put a human review step in front of an internal
 * notification — the exact friction that makes people switch automation off.
 *
 * So the type list stays the coarse filter and this is the precise one. A rule
 * with no recipients configured is treated as candidate-facing: every row
 * written before recipients existed meant the candidate, and defaulting the
 * unknown case toward MORE review is the safe direction to be wrong in.
 */
export function actionReachesCandidate(action: Action): boolean {
  if (!CANDIDATE_CONTACT_ACTIONS.includes(action.type)) return false;
  if (action.type !== "send_templated_message") return true;

  const recipients = action.config?.recipients;
  if (!Array.isArray(recipients) || recipients.length === 0) return true;

  return recipients.some(
    (recipient) =>
      typeof recipient === "object" &&
      recipient !== null &&
      (recipient as { kind?: unknown }).kind === "candidate"
  );
}

export function contactsCandidate(actions: Action[]): boolean {
  return actions.some((action) => actionReachesCandidate(action));
}

/** True when a rule's actions mean approval cannot be switched off. */
export function approvalIsMandatory(actions: Action[]): boolean {
  return actions.some((action) => action.type === "send_candidate_email");
}

/**
 * Actions where approval is switched ON by default but may be switched off.
 *
 * `send_templated_message` sits here rather than in approvalIsMandatory, and the
 * difference is where the human review happened:
 *
 *   - send_candidate_email sends wording that lives in this codebase. Nobody in
 *     the organization ever read it, so a person reads the proposal instead.
 *   - send_templated_message sends a template an Owner or Admin wrote AND
 *     explicitly activated — the default library ships inactive precisely so
 *     that switch is a deliberate act. The review already happened, once, over
 *     the words themselves.
 *
 * Forcing per-run approval would also make an automation strictly worse than the
 * built-in event triggers, which send the very same template with no approval
 * step. An admin who wants the extra gate keeps the default; one automating a
 * hundred rejections a week can turn it off having read the words.
 */
export const APPROVAL_RECOMMENDED_ACTIONS: ActionType[] = ["send_templated_message"];

export function approvalIsRecommended(actions: Action[]): boolean {
  return actions.some((action) => {
    if (!APPROVAL_RECOMMENDED_ACTIONS.includes(action.type)) return false;
    // Same carve-out as contactsCandidate(): a templated message addressed only
    // to colleagues is internal mail, and recommending review for it would train
    // people to click through the review screen without reading it.
    if (action.type === "send_templated_message") return actionReachesCandidate(action);
    return true;
  });
}

export type Condition = {
  field: ConditionField;
  operator: Operator;
  /** Absent for is_true/is_false. */
  value?: string | number | null;
};

/**
 * A group of conditions and how they combine.
 *
 * Groups are ANDed with each other; conditions inside a group use the group's
 * own `match`. So `[{any: A,B}, {all: C}]` reads "(A or B) and C".
 */
export type ConditionGroup = {
  match: "all" | "any";
  conditions: Condition[];
};

export type Action = {
  type: ActionType;
  config?: Record<string, unknown>;
};

export type AutomationRule = {
  trigger: TriggerType;
  conditions: ConditionGroup[];
  actions: Action[];
};

export function isTrigger(value: unknown): value is TriggerType {
  return typeof value === "string" && (TRIGGERS as readonly string[]).includes(value);
}

export function isActionType(value: unknown): value is ActionType {
  return typeof value === "string" && (ACTIONS as readonly string[]).includes(value);
}

export function isConditionField(value: unknown): value is ConditionField {
  return typeof value === "string" && (CONDITION_FIELDS as readonly string[]).includes(value);
}

/** Integrations a rule needs, derived from its actions and their config. */
export function requiredIntegrationsFor(actions: Action[]): string[] {
  const required = new Set<string>();

  for (const action of actions) {
    const integration = ACTION_INTEGRATIONS[action.type];
    if (integration) required.add(integration);

    if (action.type === "send_templated_message" || action.type === "request_form") {
      const channels = messageChannelsFor(action);
      /**
       * A `both` template requires NEITHER channel, not both of them.
       *
       * Requiring both would mean an organization that has never configured
       * WhatsApp — the normal state — could not activate a rule whose email half
       * works perfectly. The two channels are independent at send time, and the
       * spec is explicit that email-only usage must work completely. So a rule
       * naming one channel requires it, and a rule naming two requires nothing:
       * whichever is connected sends, and the log records the other as skipped.
       */
      if (channels.length === 1) required.add(channels[0]);
    }
  }

  return [...required];
}

/** Chargeable actions in a rule — the number that fills the cost ledger. */
export function countChargeable(actions: Action[]): number {
  return actions.filter((action) => CONSEQUENTIAL_ACTIONS.includes(action.type)).length;
}

/**
 * READS BOTH SHAPES.
 *
 * Rules stored before the upgrade hold a flat `Condition[]`, and there are live
 * ones in every existing organization. Rather than migrate the JSONB — a data
 * migration that silently mangles one row is worse than a branch here — a flat
 * array is read as a single ALL group. New writes always store groups.
 */
export function normalizeConditions(raw: unknown): ConditionGroup[] {
  if (!Array.isArray(raw)) return [];

  // Legacy: an array whose first element looks like a condition, not a group.
  const looksLegacy = raw.some(
    (entry) => typeof entry === "object" && entry !== null && "field" in entry
  );

  if (looksLegacy) {
    const conditions = raw.filter(
      (entry): entry is Condition =>
        typeof entry === "object" && entry !== null && isConditionField((entry as Condition).field)
    );
    return conditions.length > 0 ? [{ match: "all", conditions }] : [];
  }

  const groups: ConditionGroup[] = [];
  for (const entry of raw) {
    if (typeof entry !== "object" || entry === null) continue;
    const group = entry as Partial<ConditionGroup>;
    if (!Array.isArray(group.conditions)) continue;
    groups.push({
      match: group.match === "any" ? "any" : "all",
      conditions: group.conditions.filter(
        (condition): condition is Condition =>
          typeof condition === "object" &&
          condition !== null &&
          isConditionField((condition as Condition).field)
      ),
    });
  }
  return groups;
}

/** Flattens groups back to a list, for counting and for the AI prompt. */
export function allConditions(groups: ConditionGroup[]): Condition[] {
  return groups.flatMap((group) => group.conditions);
}

export type ValidationResult =
  | { ok: true; rule: AutomationRule }
  | { ok: false; error: string };

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const MAX_GROUPS = 5;
const MAX_CONDITIONS_PER_GROUP = 6;
/**
 * RAISED FROM 5 TO 10 BY MODULE 25.
 *
 * Five was right for a hand-written When/If/Then rule, where a sixth action is
 * usually a sign the rule is doing two things. A stage workflow is a different
 * shape: one stage plausibly acknowledges the candidate, notifies the recruiter,
 * notifies the job owner, requests a form and schedules a call — five before
 * anybody has done anything unusual.
 *
 * Raising a maximum is backward-compatible in a way that lowering one is not:
 * every rule that validated at five still validates at ten.
 */
const MAX_ACTIONS = 10;

function validateCondition(entry: Record<string, unknown>): ValidationResult | Condition {
  const field = entry.field as ConditionField;
  if (!isConditionField(field)) {
    return { ok: false, error: `Unknown condition field: ${String(entry.field)}` };
  }

  const operator = entry.operator as Operator;
  if (!(OPERATORS as readonly string[]).includes(operator)) {
    return { ok: false, error: `Unknown operator: ${String(entry.operator)}` };
  }

  if (!FIELD_OPERATORS[field].includes(operator)) {
    return {
      ok: false,
      error: `"${OPERATOR_LABELS[operator]}" doesn't apply to ${FIELD_LABELS[field]}.`,
    };
  }

  const needsValue = operator !== "is_true" && operator !== "is_false";
  if (needsValue && (entry.value === undefined || entry.value === null || entry.value === "")) {
    return { ok: false, error: `${FIELD_LABELS[field]} needs a value to compare against.` };
  }

  // A fixed-vocabulary field with a value outside its list would validate and
  // then never match. Caught here rather than discovered as a rule that "does
  // nothing" three weeks later.
  if (needsValue) {
    const options = FIELD_VALUE_OPTIONS[field];
    if (options && !options.some((option) => option.value === String(entry.value))) {
      return {
        ok: false,
        error: `${FIELD_LABELS[field]} must be one of: ${options
          .map((option) => option.label)
          .join(", ")}.`,
      };
    }
  }

  return {
    field,
    operator,
    value: needsValue ? (entry.value as string | number) : null,
  };
}

/**
 * Validates a rule against the catalogue.
 *
 * Rejects anything outside the closed vocabulary. This is the gate that makes an
 * AI-drafted rule safe to store: it may be wrong, but it cannot be arbitrary.
 */
export function validateRule(value: unknown): ValidationResult {
  if (typeof value !== "object" || value === null) {
    return { ok: false, error: "Invalid rule." };
  }
  const raw = value as Record<string, unknown>;

  if (!isTrigger(raw.trigger)) {
    return { ok: false, error: "Choose a valid trigger." };
  }

  const groups: ConditionGroup[] = [];
  if (raw.conditions !== undefined) {
    if (!Array.isArray(raw.conditions)) {
      return { ok: false, error: "Conditions must be a list." };
    }

    for (const rawGroup of normalizeConditions(raw.conditions).slice(0, MAX_GROUPS)) {
      const conditions: Condition[] = [];

      for (const item of rawGroup.conditions.slice(0, MAX_CONDITIONS_PER_GROUP)) {
        const outcome = validateCondition(item as unknown as Record<string, unknown>);
        if ("ok" in outcome) return outcome;
        conditions.push(outcome);
      }

      // An empty group would silently pass an ANY group and silently pass an ALL
      // group too — meaningless either way, so it is dropped rather than stored.
      if (conditions.length > 0) groups.push({ match: rawGroup.match, conditions });
    }
  }

  // An ANY group with one condition is an ALL group with one condition, and the
  // "or" in the sentence would be a lie. Normalised so the description is true.
  for (const group of groups) {
    if (group.conditions.length === 1) group.match = "all";
  }

  if (!Array.isArray(raw.actions) || raw.actions.length === 0) {
    return { ok: false, error: "A rule needs at least one action." };
  }

  const actions: Action[] = [];
  for (const item of raw.actions) {
    if (typeof item !== "object" || item === null) continue;
    const entry = item as Record<string, unknown>;

    if (!isActionType(entry.type)) {
      return { ok: false, error: `Unknown action: ${String(entry.type)}` };
    }

    const config = (entry.config as Record<string, unknown>) ?? {};

    // move_to_stage without a target would silently do nothing.
    if (entry.type === "move_to_stage") {
      const stage = config.stage;
      if (typeof stage !== "string" || stage.length === 0) {
        return { ok: false, error: "Choose which stage to move the application to." };
      }
    }

    if (entry.type === "assign_recruiter") {
      const strategy = config.strategy;
      if (strategy !== "job_owner" && strategy !== "specific_user") {
        return { ok: false, error: "Choose who the recruiter assignment should pick." };
      }
      if (strategy === "specific_user" && typeof config.user_id !== "string") {
        return { ok: false, error: "Choose which recruiter to assign." };
      }
    }

    if (entry.type === "send_candidate_email") {
      // One approved template today. Named in config so adding a second is a
      // catalogue change rather than a schema one, and so the stored rule says
      // which words were approved.
      const template = config.template ?? "candidate_stage_update";
      if (template !== "candidate_stage_update") {
        return { ok: false, error: "That candidate email template doesn't exist." };
      }
      config.template = template;
    }

    /**
     * Module 15's "Send templated message".
     *
     * The rule names a template by id. The three derived fields — event_key and
     * channels — are copied from the template by the API, which is also the only
     * place that can prove the template belongs to the caller's organization: a
     * pure validator cannot, and a rule whose template id came from another
     * tenant would be a cross-tenant read dressed up as a configuration value.
     *
     * So the shape is checked here and the ownership is checked there, and the
     * API overwrites whatever the client sent for the derived fields.
     */
    if (entry.type === "send_templated_message") {
      const templateId = config.template_id;
      if (typeof templateId !== "string" || !UUID_PATTERN.test(templateId)) {
        return { ok: false, error: "Choose which message template to send." };
      }

      const channels = Array.isArray(config.channels)
        ? config.channels.filter((channel) => channel === "email" || channel === "whatsapp")
        : [];

      config.template_id = templateId;
      config.channels = channels;
      // event_key is carried through untouched when present; the API sets it from
      // the template. Absent, the engine falls back to reading the template.
      if (typeof config.event_key !== "string") delete config.event_key;
    }

    /**
     * MODULE 25 — AI Resume Shortlisting.
     *
     * `passing_score` is OPTIONAL and null means "use this job's Resume Score
     * passing mark" (job_hiring_stages.config.passingScore). That indirection is
     * deliberate: the passing mark is already configured per job on the Resume
     * Score row, and copying it into the rule would create a second number that
     * silently stops agreeing with the first the day somebody edits one of them.
     *
     * An explicit number here overrides it, for the case where a stage workflow
     * genuinely wants a different bar from the one the scoring row displays.
     */
    if (entry.type === "ai_resume_shortlist") {
      const passing = config.passing_score;
      if (passing !== undefined && passing !== null) {
        const score = Number(passing);
        if (!Number.isFinite(score) || score < 0 || score > 100) {
          return { ok: false, error: "The passing mark must be between 0 and 100." };
        }
        config.passing_score = Math.round(score);
      } else {
        config.passing_score = null;
      }

      // What happens on a pass. Advancing is the point of the step, but a team
      // that wants the screen to only FLAG and never move anybody can switch it
      // off — the score and the branch still fire.
      config.advance_on_pass = config.advance_on_pass !== false;
    }

    /**
     * MODULE 25 — Request Form.
     *
     * Two ids, both verified server-side for tenancy by the API (a pure
     * validator cannot prove either belongs to the caller's organization — the
     * same split send_templated_message already uses).
     */
    if (entry.type === "request_form") {
      const formId = config.form_id;
      if (typeof formId !== "string" || !UUID_PATTERN.test(formId)) {
        return { ok: false, error: "Choose which form to send." };
      }
      const templateId = config.template_id;
      if (typeof templateId !== "string" || !UUID_PATTERN.test(templateId)) {
        return { ok: false, error: "Choose the message that carries the form link." };
      }
      const channels = Array.isArray(config.channels)
        ? config.channels.filter((channel) => channel === "email" || channel === "whatsapp")
        : [];
      config.channels = channels;
      if (typeof config.event_key !== "string") delete config.event_key;
    }

    /**
     * MODULE 25 — Schedule Interview.
     *
     * Manual-only, enforced below rather than here so the message can name the
     * setting the user has to change.
     */
    if (entry.type === "schedule_interview") {
      const mode = config.mode;
      if (mode !== undefined && mode !== null && typeof mode !== "string") {
        return { ok: false, error: "The interview mode must be text." };
      }
    }

    if (entry.type === "call_n8n_webhook") {
      const path = config.path;
      if (path !== undefined && path !== null && typeof path !== "string") {
        return { ok: false, error: "The workflow path must be text." };
      }
      // Relative only. A rule that could name any host would be an outbound
      // request to anywhere, authored by whoever can edit a rule — the n8n
      // adapter owns the base URL and this stays a path within it.
      if (typeof path === "string" && /^[a-z]+:\/\//i.test(path)) {
        return {
          ok: false,
          error: "Give a path inside your workflow engine, not a full URL.",
        };
      }
      config.path = typeof path === "string" ? path.replace(/^\/+/, "").slice(0, 200) : "";
    }

    /**
     * MODULE 25 — the AI agent an outbound call uses.
     *
     * EXTENDS `start_screening_call` rather than adding a "place_ai_call"
     * action. The brief asks for per-stage agent choice, and the difference
     * between "the screening call" and "a call with the Technical Screening
     * Agent" is which agent row Bolna is handed — not a different action, a
     * different execution path or a different cost line. A second action type
     * would have needed its own handler, its own integration check and its own
     * consent disclosure, and the day one of those three was edited the other
     * copy would have quietly diverged on the thing that telephones people.
     *
     * Absent means the organization's default agent, which is what every rule
     * written before Module 25 does today.
     */
    if (entry.type === "start_screening_call") {
      const agentId = config.agent_id;
      if (agentId === undefined || agentId === null || agentId === "") {
        config.agent_id = null;
      } else if (typeof agentId !== "string" || !UUID_PATTERN.test(agentId)) {
        return { ok: false, error: "Choose a valid voice agent for this call." };
      }
    }

    /**
     * MODULE 25 — recipients.
     *
     * Only `send_templated_message` and `request_form` carry them: those are the
     * two actions that render a template and send it somewhere. `notify_recruiter`
     * already has a fixed audience by definition, and giving it a recipient list
     * would make its name a lie.
     *
     * Validated here by shape; a named organization_member is proved to be a
     * member of the CALLER'S organization by the API, for the same reason
     * template ids are. A pure function cannot check tenancy, and a user id
     * accepted from a request body without that check would be a cross-tenant
     * read wearing a configuration value's clothes.
     */
    if (entry.type === "send_templated_message" || entry.type === "request_form") {
      const recipients = validateRecipients(config.recipients);
      if (!recipients.ok) return { ok: false, error: recipients.error };
      config.recipients = recipients.recipients;
    }

    /**
     * MODULE 25 — automatic vs manual trigger.
     *
     * `manual: true` means the action does not fire on entry into the stage; it
     * renders as a button on the application and waits for a recruiter. Stored
     * on the action rather than the rule because one stage's list mixes the two
     * freely — the acknowledgement email should send itself, the interview
     * invitation should not.
     */
    const manualRequested = config.manual === true;
    if (isManualOnly(entry.type) && !manualRequested) {
      return {
        ok: false,
        error: `"${ACTION_LABELS[entry.type]}" has to be set to Manual trigger — it needs a person to choose the time.`,
      };
    }
    config.manual = manualRequested;

    actions.push({ type: entry.type, config });

    if (actions.length >= MAX_ACTIONS) break;
  }

  if (actions.length === 0) {
    return { ok: false, error: "A rule needs at least one action." };
  }

  /**
   * A "sat in a stage too long" rule with no duration is not a rule.
   *
   * Without a `days_in_stage` threshold the scheduler would match every
   * application in every stage on its first sweep — and because a scheduled run
   * consumes the dedupe key for that stage-entry, it would do so once for every
   * open application in the organization before anyone could stop it.
   *
   * So the duration is required at WRITE time, not merely warned about in the UI.
   * The sweep also reads the threshold to bound its scan, so a rule without one
   * has nothing to scan by either.
   */
  if (raw.trigger === "time_elapsed_in_stage") {
    const hasThreshold = groups.some((group) =>
      group.conditions.some(
        (condition) =>
          condition.field === "days_in_stage" &&
          (condition.operator === "gt" || condition.operator === "gte")
      )
    );

    if (!hasThreshold) {
      return {
        ok: false,
        error:
          'A "sat in a stage too long" rule needs a "Days in current stage is at least …" condition, ' +
          "or it would match every open application at once.",
      };
    }
  }

  return { ok: true, rule: { trigger: raw.trigger, conditions: groups, actions } };
}

/**
 * The smallest days-in-stage threshold a rule waits for.
 *
 * The sweep uses the minimum across all of an organization's scheduled rules to
 * bound its scan: an application that has not been anywhere long enough for the
 * most impatient rule cannot match any of them.
 *
 * Returns null when there is no threshold, which validateRule makes impossible
 * for a scheduled rule — but a rule stored before this check existed, or one
 * hand-written into the database, would land here. Null means "do not scan on
 * this rule's behalf", which is the safe direction.
 */
export function minimumStageAgeDays(groups: ConditionGroup[]): number | null {
  let smallest: number | null = null;

  for (const group of groups) {
    for (const condition of group.conditions) {
      if (condition.field !== "days_in_stage") continue;
      if (condition.operator !== "gt" && condition.operator !== "gte") continue;

      const value = Number(condition.value);
      if (!Number.isFinite(value)) continue;

      // `gt 3` first matches on day 4; `gte 3` on day 3. Scanning from the
      // earlier of the two is harmless — evaluateConditions still decides — and
      // scanning from the later would miss the day the rule should fire.
      const threshold = condition.operator === "gt" ? value + 1 : value;
      smallest = smallest === null ? threshold : Math.min(smallest, threshold);
    }
  }

  return smallest;
}

/**
 * Can this rule actually run, given where its trigger comes from?
 *
 * Separate from validateRule because an unrunnable rule is still worth SAVING as
 * a draft — the admin may be halfway through building it. It is activation that
 * must refuse, with the reason spelled out.
 */
export function checkExecutable(rule: {
  trigger: TriggerType;
  actions: Action[];
}): { ok: true } | { ok: false; reason: string } {
  const mode = TRIGGER_MODES[rule.trigger];
  const unrunnable = rule.actions.filter((action) => !actionRunsIn(action.type, mode));

  if (unrunnable.length === 0) return { ok: true };

  const names = unrunnable.map((action) => `"${ACTION_LABELS[action.type]}"`).join(" and ");
  const arrival =
    rule.trigger === "time_elapsed_in_stage"
      ? "The scheduler runs with nobody signed in"
      : "This trigger arrives from an external system with nobody signed in";

  return {
    ok: false,
    reason:
      `${arrival}, and ${names} can only run on behalf of a signed-in user. ` +
      `Use a trigger someone's action causes, or drop ${
        unrunnable.length === 1 ? "that action" : "those actions"
      }.`,
  };
}

/** Plain-language rendering of one group. */
function describeGroup(group: ConditionGroup): string {
  const joiner = group.match === "any" ? " or " : " and ";
  const parts = group.conditions.map((condition) => {
    const field = FIELD_LABELS[condition.field];
    const operator = OPERATOR_LABELS[condition.operator];

    // Show the label, not the stored key: "is Job board", not "is job_board".
    const options = FIELD_VALUE_OPTIONS[condition.field];
    const shown =
      options?.find((option) => option.value === String(condition.value))?.label ??
      condition.value;

    return shown === null || shown === undefined
      ? `${field} ${operator}`
      : `${field} ${operator} ${shown}`;
  });

  const joined = parts.join(joiner);
  // Parenthesise a multi-condition ANY group so "(A or B) and C" is unambiguous.
  return group.match === "any" && group.conditions.length > 1 ? `(${joined})` : joined;
}

/** Plain-language rendering of a rule, for review before activation. */
export function describeRule(rule: {
  trigger: TriggerType;
  conditions: ConditionGroup[] | Condition[];
  actions: Action[];
}): string {
  const when = TRIGGER_LABELS[rule.trigger] ?? rule.trigger;
  const groups = normalizeConditions(rule.conditions);

  const ifPart =
    groups.length === 0 ? null : groups.map(describeGroup).filter(Boolean).join(" and ");

  const then = rule.actions
    .map((action) => ACTION_LABELS[action.type] ?? action.type)
    .join(", then ");

  return ifPart ? `When ${when}, if ${ifPart}, then ${then}.` : `When ${when}, then ${then}.`;
}
