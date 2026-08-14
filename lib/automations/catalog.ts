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
// =============================================================================

export const TRIGGERS = [
  "application_stage_changed",
  "application_created",
  "screening_call_completed",
  "screening_report_created",
  "interview_completed",
] as const;

export type TriggerType = (typeof TRIGGERS)[number];

export const TRIGGER_LABELS: Record<TriggerType, string> = {
  application_stage_changed: "An application enters a stage",
  application_created: "An application is created",
  screening_call_completed: "A screening call completes",
  screening_report_created: "A screening report is generated",
  interview_completed: "An interview is completed",
};

/**
 * Which triggers are actually wired to a dispatch site today.
 *
 * `screening_call_completed` arrives on Bolna's webhook, which runs with no user
 * session — the engine's queries and every action it calls go through the
 * session-bound client, so it would be denied by RLS rather than run. Rather
 * than offer a trigger that silently never fires, it is listed as unavailable:
 * the UI says so, and activation is refused with a reason.
 *
 * A rule that quietly does nothing is worse than one you cannot create, because
 * an admin would believe their candidates were being screened.
 *
 * TODO: wire it once the engine has a service-role execution path (see
 * docs/modules/13-automations-notes.md).
 */
export const TRIGGER_AVAILABILITY: Record<TriggerType, { available: boolean; note?: string }> = {
  application_stage_changed: { available: true },
  application_created: { available: true },
  screening_report_created: { available: true },
  interview_completed: { available: true },
  screening_call_completed: {
    available: false,
    note: "Call-completion events arrive from Bolna's webhook, which can't run automations yet. Use “An application enters a stage” for now.",
  },
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
};

export const ACTIONS = [
  "start_screening_call",
  "generate_screening_report",
  "calculate_match",
  "move_to_stage",
  "notify_recruiter",
  "add_note",
] as const;

export type ActionType = (typeof ACTIONS)[number];

export const ACTION_LABELS: Record<ActionType, string> = {
  start_screening_call: "Start an AI screening call",
  generate_screening_report: "Generate the screening report",
  calculate_match: "Calculate the match score",
  move_to_stage: "Move to a stage",
  notify_recruiter: "Notify the assigned recruiter",
  add_note: "Add a note to the application",
};

/**
 * Which integration each action needs.
 *
 * Drives the activation check: "a rule cannot be activated if a required
 * integration is disconnected" (the spec's test).
 */
export const ACTION_INTEGRATIONS: Partial<Record<ActionType, string>> = {
  start_screening_call: "bolna",
  // notify_recruiter will require "email" once Module 15 ships; today it writes
  // to the internal log, which needs nothing.
};

/**
 * Actions that cost money or contact a person. Used to warn an admin before
 * activation and to decide what the dedupe guard must cover.
 */
export const CONSEQUENTIAL_ACTIONS: ActionType[] = [
  "start_screening_call",
  "generate_screening_report",
  "calculate_match",
];

export type Condition = {
  field: ConditionField;
  operator: Operator;
  /** Absent for is_true/is_false. */
  value?: string | number | null;
};

export type Action = {
  type: ActionType;
  config?: Record<string, unknown>;
};

export type AutomationRule = {
  trigger: TriggerType;
  conditions: Condition[];
  actions: Action[];
};

export function isTrigger(value: unknown): value is TriggerType {
  return typeof value === "string" && (TRIGGERS as readonly string[]).includes(value);
}

export function isActionType(value: unknown): value is ActionType {
  return typeof value === "string" && (ACTIONS as readonly string[]).includes(value);
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

export type ValidationResult =
  | { ok: true; rule: AutomationRule }
  | { ok: false; error: string };

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

  const conditions: Condition[] = [];
  if (raw.conditions !== undefined) {
    if (!Array.isArray(raw.conditions)) {
      return { ok: false, error: "Conditions must be a list." };
    }

    for (const item of raw.conditions) {
      if (typeof item !== "object" || item === null) continue;
      const entry = item as Record<string, unknown>;

      const field = entry.field as ConditionField;
      if (!(CONDITION_FIELDS as readonly string[]).includes(field)) {
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

      conditions.push({
        field,
        operator,
        value: needsValue ? (entry.value as string | number) : null,
      });

      if (conditions.length >= 10) break;
    }
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

    // move_to_stage without a target would silently do nothing.
    if (entry.type === "move_to_stage") {
      const stage = (entry.config as Record<string, unknown> | undefined)?.stage;
      if (typeof stage !== "string" || stage.length === 0) {
        return { ok: false, error: "Choose which stage to move the application to." };
      }
    }

    actions.push({
      type: entry.type,
      config: (entry.config as Record<string, unknown>) ?? {},
    });

    if (actions.length >= 5) break;
  }

  if (actions.length === 0) {
    return { ok: false, error: "A rule needs at least one action." };
  }

  return { ok: true, rule: { trigger: raw.trigger, conditions, actions } };
}

/** Plain-language rendering of a rule, for review before activation. */
export function describeRule(rule: AutomationRule): string {
  const when = TRIGGER_LABELS[rule.trigger];

  const ifPart =
    rule.conditions.length === 0
      ? null
      : rule.conditions
          .map((condition) => {
            const field = FIELD_LABELS[condition.field];
            const operator = OPERATOR_LABELS[condition.operator];
            return condition.value === null || condition.value === undefined
              ? `${field} ${operator}`
              : `${field} ${operator} ${condition.value}`;
          })
          .join(" and ");

  const then = rule.actions.map((action) => ACTION_LABELS[action.type]).join(", then ");

  return ifPart ? `When ${when}, if ${ifPart}, then ${then}.` : `When ${when}, then ${then}.`;
}
