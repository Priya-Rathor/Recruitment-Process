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
] as const;

export type ActionType = (typeof ACTIONS)[number];

export const ACTION_LABELS: Record<ActionType, string> = {
  start_screening_call: "Start an AI screening call",
  generate_screening_report: "Generate the screening report",
  calculate_match: "Calculate the match score",
  move_to_stage: "Move to a stage",
  notify_recruiter: "Notify the assigned recruiter",
  add_note: "Add a note to the application",
  send_candidate_email: "Email the candidate a stage update",
  assign_recruiter: "Assign a recruiter",
  call_n8n_webhook: "Hand off to an n8n workflow",
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
};

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
];

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
];

export function contactsCandidate(actions: Action[]): boolean {
  return actions.some((action) => CANDIDATE_CONTACT_ACTIONS.includes(action.type));
}

/** True when a rule's actions mean approval cannot be switched off. */
export function approvalIsMandatory(actions: Action[]): boolean {
  return actions.some((action) => action.type === "send_candidate_email");
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

/** Integrations a rule needs, derived from its actions. */
export function requiredIntegrationsFor(actions: Action[]): string[] {
  const required = new Set<string>();
  for (const action of actions) {
    const integration = ACTION_INTEGRATIONS[action.type];
    if (integration) required.add(integration);
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

const MAX_GROUPS = 5;
const MAX_CONDITIONS_PER_GROUP = 6;
const MAX_ACTIONS = 5;

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

    if (entry.type === "call_n8n_webhook") {
      const path = config.path;
      if (path !== undefined && path !== null && typeof path !== "string") {
        return { ok: false, error: "The n8n workflow path must be text." };
      }
      // Relative only. A rule that could name any host would be an outbound
      // request to anywhere, authored by whoever can edit a rule — the n8n
      // adapter owns the base URL and this stays a path within it.
      if (typeof path === "string" && /^[a-z]+:\/\//i.test(path)) {
        return {
          ok: false,
          error: "Give a path inside your n8n instance, not a full URL.",
        };
      }
      config.path = typeof path === "string" ? path.replace(/^\/+/, "").slice(0, 200) : "";
    }

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
