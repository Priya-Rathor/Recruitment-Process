// =============================================================================
// Condition evaluation and the runaway guard's key.
//
// Pure functions. No database handle, no LLM, no clock of their own — every
// input is passed in. That is what makes a rule "explainable and predictable"
// in the sense the spec requires: given the same context, a rule always reaches
// the same verdict, and the verdict can be shown to a recruiter as a sentence.
// =============================================================================
import type {
  Condition,
  ConditionField,
  ConditionGroup,
  Operator,
} from "@/lib/automations/catalog";
import { FIELD_LABELS, FIELD_VALUE_OPTIONS, OPERATOR_LABELS, normalizeConditions } from "@/lib/automations/catalog";

/**
 * Everything a rule is allowed to see.
 *
 * A closed context, like the closed vocabulary: conditions cannot reach into
 * arbitrary application data, so what a rule can depend on is auditable.
 *
 * `null` means "not known" — distinct from false. A candidate whose phone number
 * has not been loaded is not a candidate without a phone number, and a rule that
 * treated the two the same would either skip calls it should place or place
 * calls it should not.
 */
export type EvaluationContext = {
  stage: string | null;
  matchScore: number | null;
  candidateHasPhone: boolean | null;
  candidateHasEmail: boolean | null;
  screeningConsentConfirmed: boolean | null;
  jobHasScreeningQuestions: boolean | null;
  daysInStage: number | null;
  interestLevel: string | null;
  applicationSource: string | null;
  candidateHasResume: boolean | null;
  daysSinceApplied: number | null;
  assignedRecruiterPresent: boolean | null;
  jobIsOpen: boolean | null;
  evaluationOutcome: string | null;
};

const FIELD_ACCESSORS: Record<ConditionField, (ctx: EvaluationContext) => unknown> = {
  stage: (ctx) => ctx.stage,
  match_score: (ctx) => ctx.matchScore,
  candidate_has_phone: (ctx) => ctx.candidateHasPhone,
  candidate_has_email: (ctx) => ctx.candidateHasEmail,
  screening_consent_confirmed: (ctx) => ctx.screeningConsentConfirmed,
  job_has_screening_questions: (ctx) => ctx.jobHasScreeningQuestions,
  days_in_stage: (ctx) => ctx.daysInStage,
  interest_level: (ctx) => ctx.interestLevel,
  application_source: (ctx) => ctx.applicationSource,
  candidate_has_resume: (ctx) => ctx.candidateHasResume,
  days_since_applied: (ctx) => ctx.daysSinceApplied,
  assigned_recruiter_present: (ctx) => ctx.assignedRecruiterPresent,
  job_is_open: (ctx) => ctx.jobIsOpen,
  evaluation_outcome: (ctx) => ctx.evaluationOutcome,
};

export type ConditionOutcome = {
  condition: Condition;
  passed: boolean;
  /** True when the field's value was unknown rather than non-matching. */
  unknown: boolean;
  explanation: string;
};

export type GroupOutcome = {
  match: "all" | "any";
  passed: boolean;
  outcomes: ConditionOutcome[];
};

export type EvaluationResult = {
  matched: boolean;
  groups: GroupOutcome[];
  /** Every condition, flattened — the shape the run record and tests read. */
  outcomes: ConditionOutcome[];
  /** A sentence naming why the rule did not match, for the run record. */
  reason: string | null;
};

function compare(operator: Operator, actual: unknown, expected: unknown): boolean {
  switch (operator) {
    case "is_true":
      return actual === true;
    case "is_false":
      return actual === false;
    case "eq":
      return String(actual) === String(expected);
    case "neq":
      return String(actual) !== String(expected);
    case "gt":
    case "gte":
    case "lt":
    case "lte": {
      const left = Number(actual);
      const right = Number(expected);
      if (!Number.isFinite(left) || !Number.isFinite(right)) return false;
      if (operator === "gt") return left > right;
      if (operator === "gte") return left >= right;
      if (operator === "lt") return left < right;
      return left <= right;
    }
    default:
      return false;
  }
}

function describeCondition(condition: Condition): string {
  const field = FIELD_LABELS[condition.field];
  const operator = OPERATOR_LABELS[condition.operator];
  const options = FIELD_VALUE_OPTIONS[condition.field];
  const shown =
    options?.find((option) => option.value === String(condition.value))?.label ?? condition.value;

  return shown === null || shown === undefined
    ? `${field} ${operator}`
    : `${field} ${operator} ${shown}`;
}

function evaluateOne(condition: Condition, context: EvaluationContext): ConditionOutcome {
  const actual = FIELD_ACCESSORS[condition.field]?.(context);
  const unknown = actual === null || actual === undefined;
  const passed = unknown ? false : compare(condition.operator, actual, condition.value);

  return {
    condition,
    passed,
    unknown,
    explanation: unknown
      ? `${FIELD_LABELS[condition.field]} isn't known for this application.`
      : `${describeCondition(condition)} — ${passed ? "yes" : `no (it is ${String(actual)})`}`,
  };
}

/**
 * Evaluates a rule's condition groups against a context.
 *
 * Groups are ANDed; inside a group, `match` decides. So a rule reads
 * "(A or B) and C" and evaluates that way.
 *
 * An UNKNOWN field fails its condition. That is the safe direction — a rule that
 * dials a candidate when their consent state is unknown is exactly the failure
 * this module must not have. The run records `unknown: true` so a recruiter sees
 * "we couldn't tell", not "it didn't match".
 *
 * A NOTE ON `any` GROUPS AND UNKNOWNS. An unknown fails its own condition but
 * does not poison its group: `(consent recorded) or (phone present)` still
 * passes on the phone if consent is unknown. That is correct — the group says
 * either is sufficient — but it is worth knowing that an `any` group is a place
 * where a rule can proceed on partial information, which an `all` group is not.
 * That is why the group's own outcomes are kept and shown, not just the verdict.
 */
export function evaluateConditions(
  conditions: ConditionGroup[] | Condition[],
  context: EvaluationContext
): EvaluationResult {
  const groups = normalizeConditions(conditions);
  const groupOutcomes: GroupOutcome[] = [];

  for (const group of groups) {
    const outcomes = group.conditions.map((condition) => evaluateOne(condition, context));
    const passed =
      group.match === "any"
        ? outcomes.some((outcome) => outcome.passed)
        : outcomes.every((outcome) => outcome.passed);

    groupOutcomes.push({ match: group.match, passed, outcomes });
  }

  const failedGroup = groupOutcomes.find((group) => !group.passed);
  const flattened = groupOutcomes.flatMap((group) => group.outcomes);

  let reason: string | null = null;
  if (failedGroup) {
    if (failedGroup.match === "any") {
      // Naming one condition would be misleading — none of them passed, and the
      // rule needed only one to.
      reason = `None of these matched: ${failedGroup.outcomes
        .map((outcome) => outcome.explanation)
        .join("; ")}`;
    } else {
      reason =
        failedGroup.outcomes.find((outcome) => !outcome.passed)?.explanation ??
        "A condition did not match.";
    }
  }

  return {
    matched: !failedGroup,
    groups: groupOutcomes,
    outcomes: flattened,
    reason,
  };
}

/**
 * THE RUNAWAY GUARD'S KEY.
 *
 * The cost chapter: "An automation must not be able to trigger the same AI
 * action on the same application more than once per stage-entry — guard this at
 * the automation-run level, not just in the AI function itself."
 *
 * So the key identifies the OCCASION, not the moment. Every event arising from
 * the same stage-entry produces the same string, and the unique index in
 * migration 0012 rejects the second insert.
 *
 * `stageEnteredAt` comes from application_stage_history, which is written by a
 * database trigger — so it cannot be nudged by a caller trying to earn a second
 * run. When it is missing we fall back to the stage alone, which is the STRICTER
 * behaviour: at most one run per stage ever, rather than an unbounded number.
 *
 * THE SCHEDULER USES THE SAME KEY, and that is the whole reason a time-based
 * rule is safe. A sweep that runs hourly re-finds the same stale application
 * every hour; the key it computes is identical each time, so the second insert
 * is rejected and the candidate is chased once per stage-entry rather than 24
 * times a day. No separate "already reminded" bookkeeping, and no window where a
 * slow sweep overlapping the next one sends twice.
 */
export function buildDedupeKey({
  trigger,
  stage,
  stageEnteredAt,
}: {
  trigger: string;
  stage: string | null;
  stageEnteredAt: string | null;
}): string {
  const stagePart = stage ?? "unknown";
  if (!stageEnteredAt) return `${trigger}:${stagePart}`;

  // Normalised so two representations of the same instant ("...Z" vs "+00:00")
  // do not slip past the unique index as different keys.
  const parsed = new Date(stageEnteredAt);
  const entry = Number.isNaN(parsed.getTime()) ? stageEnteredAt : parsed.toISOString();
  return `${trigger}:${stagePart}:${entry}`;
}
