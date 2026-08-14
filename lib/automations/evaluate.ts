// =============================================================================
// Condition evaluation and the runaway guard's key.
//
// Pure functions. No database handle, no LLM, no clock of their own — every
// input is passed in. That is what makes a rule "explainable and predictable"
// in the sense the spec requires: given the same context, a rule always reaches
// the same verdict, and the verdict can be shown to a recruiter as a sentence.
// =============================================================================
import type { Condition, ConditionField, Operator } from "@/lib/automations/catalog";
import { FIELD_LABELS, OPERATOR_LABELS } from "@/lib/automations/catalog";

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
};

export type ConditionOutcome = {
  condition: Condition;
  passed: boolean;
  /** True when the field's value was unknown rather than non-matching. */
  unknown: boolean;
  explanation: string;
};

export type EvaluationResult = {
  matched: boolean;
  outcomes: ConditionOutcome[];
  /** A sentence naming the first condition that failed, for the run record. */
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
  return condition.value === null || condition.value === undefined
    ? `${field} ${operator}`
    : `${field} ${operator} ${condition.value}`;
}

/**
 * Evaluates conditions against a context. All conditions must pass (AND).
 *
 * OR is deliberately absent: the spec's Build Later list keeps rule complexity
 * down, and two rules read more clearly than one rule with a boolean tree.
 *
 * An UNKNOWN field fails its condition. That is the safe direction — a rule that
 * dials a candidate when their consent state is unknown is exactly the failure
 * this module must not have. The run records `unknown: true` so a recruiter sees
 * "we couldn't tell", not "it didn't match".
 */
export function evaluateConditions(
  conditions: Condition[],
  context: EvaluationContext
): EvaluationResult {
  const outcomes: ConditionOutcome[] = [];

  for (const condition of conditions) {
    const actual = FIELD_ACCESSORS[condition.field]?.(context);
    const unknown = actual === null || actual === undefined;
    const passed = unknown ? false : compare(condition.operator, actual, condition.value);

    outcomes.push({
      condition,
      passed,
      unknown,
      explanation: unknown
        ? `${FIELD_LABELS[condition.field]} isn't known for this application.`
        : `${describeCondition(condition)} — ${passed ? "yes" : `no (it is ${String(actual)})`}`,
    });
  }

  const firstFailure = outcomes.find((outcome) => !outcome.passed);

  return {
    matched: !firstFailure,
    outcomes,
    reason: firstFailure ? firstFailure.explanation : null,
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
