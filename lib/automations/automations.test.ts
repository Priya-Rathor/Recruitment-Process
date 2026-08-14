import { describe, expect, it } from "vitest";
import {
  describeRule,
  requiredIntegrationsFor,
  validateRule,
  TRIGGER_AVAILABILITY,
  type Condition,
} from "@/lib/automations/catalog";
import { buildDedupeKey, evaluateConditions, type EvaluationContext } from "@/lib/automations/evaluate";

const FULL_CONTEXT: EvaluationContext = {
  stage: "screening",
  matchScore: 82,
  candidateHasPhone: true,
  candidateHasEmail: true,
  screeningConsentConfirmed: true,
  jobHasScreeningQuestions: true,
  daysInStage: 3,
  interestLevel: "high",
};

// -----------------------------------------------------------------------------
// The closed vocabulary. This is what makes an AI-drafted rule safe to store.
// -----------------------------------------------------------------------------
describe("validateRule", () => {
  it("accepts the spec's worked example", () => {
    const result = validateRule({
      trigger: "application_stage_changed",
      conditions: [
        { field: "stage", operator: "eq", value: "screening" },
        { field: "match_score", operator: "gt", value: 75 },
        { field: "candidate_has_phone", operator: "is_true" },
      ],
      actions: [{ type: "start_screening_call" }],
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.rule.conditions).toHaveLength(3);
      expect(result.rule.actions[0].type).toBe("start_screening_call");
    }
  });

  it("rejects a trigger outside the catalogue", () => {
    const result = validateRule({
      trigger: "candidate_sneezed",
      actions: [{ type: "add_note" }],
    });
    expect(result.ok).toBe(false);
  });

  it("rejects an action outside the catalogue", () => {
    // The failure mode this guards: a model inventing a plausible-sounding
    // action ("send_offer_letter") that would be stored as an inert rule.
    const result = validateRule({
      trigger: "application_created",
      actions: [{ type: "send_offer_letter" }],
    });
    expect(result.ok).toBe(false);
  });

  it("rejects an operator that doesn't apply to its field", () => {
    const result = validateRule({
      trigger: "application_created",
      conditions: [{ field: "candidate_has_phone", operator: "gt", value: 5 }],
      actions: [{ type: "add_note" }],
    });
    expect(result.ok).toBe(false);
  });

  it("rejects move_to_stage with no target stage", () => {
    const result = validateRule({
      trigger: "application_created",
      actions: [{ type: "move_to_stage" }],
    });
    expect(result.ok).toBe(false);
  });

  it("requires at least one action", () => {
    const result = validateRule({ trigger: "application_created", actions: [] });
    expect(result.ok).toBe(false);
  });

  it("derives the Bolna requirement from a screening action", () => {
    expect(requiredIntegrationsFor([{ type: "start_screening_call" }])).toEqual(["bolna"]);
    expect(requiredIntegrationsFor([{ type: "add_note" }])).toEqual([]);
  });
});

describe("describeRule", () => {
  it("renders a sentence a recruiter can check", () => {
    const summary = describeRule({
      trigger: "application_stage_changed",
      conditions: [{ field: "match_score", operator: "gt", value: 75 }],
      actions: [{ type: "start_screening_call" }],
    });

    expect(summary).toBe(
      "When An application enters a stage, if Match score is greater than 75, then Start an AI screening call."
    );
  });
});

// -----------------------------------------------------------------------------
// Condition evaluation. The direction of failure matters more than the logic.
// -----------------------------------------------------------------------------
describe("evaluateConditions", () => {
  it("matches when every condition passes", () => {
    const conditions: Condition[] = [
      { field: "match_score", operator: "gt", value: 75 },
      { field: "candidate_has_phone", operator: "is_true" },
    ];
    expect(evaluateConditions(conditions, FULL_CONTEXT).matched).toBe(true);
  });

  it("matches a rule with no conditions at all", () => {
    expect(evaluateConditions([], FULL_CONTEXT).matched).toBe(true);
  });

  it("fails the whole rule when one condition fails (AND, not OR)", () => {
    const conditions: Condition[] = [
      { field: "match_score", operator: "gt", value: 75 },
      { field: "match_score", operator: "gt", value: 95 },
    ];
    expect(evaluateConditions(conditions, FULL_CONTEXT).matched).toBe(false);
  });

  /**
   * The one that matters. An unknown field must NOT pass — a rule that dials a
   * candidate because we could not establish whether they have a phone number
   * is precisely the runaway this module has to prevent.
   */
  it("fails a condition whose field is unknown, and says so", () => {
    const result = evaluateConditions(
      [{ field: "candidate_has_phone", operator: "is_true" }],
      { ...FULL_CONTEXT, candidateHasPhone: null }
    );

    expect(result.matched).toBe(false);
    expect(result.outcomes[0].unknown).toBe(true);
    expect(result.reason).toContain("isn't known");
  });

  it("distinguishes unknown from false in the explanation", () => {
    const unknown = evaluateConditions(
      [{ field: "screening_consent_confirmed", operator: "is_true" }],
      { ...FULL_CONTEXT, screeningConsentConfirmed: null }
    );
    const actuallyFalse = evaluateConditions(
      [{ field: "screening_consent_confirmed", operator: "is_true" }],
      { ...FULL_CONTEXT, screeningConsentConfirmed: false }
    );

    expect(unknown.outcomes[0].unknown).toBe(true);
    expect(actuallyFalse.outcomes[0].unknown).toBe(false);
    expect(unknown.reason).not.toBe(actuallyFalse.reason);
  });

  it("treats a match score of 0 as a real value, not as missing", () => {
    // 0 is falsy; a naive `!value` check here would make a zero-scored candidate
    // look "unknown" and quietly change which rules fire.
    const result = evaluateConditions([{ field: "match_score", operator: "lt", value: 10 }], {
      ...FULL_CONTEXT,
      matchScore: 0,
    });
    expect(result.matched).toBe(true);
    expect(result.outcomes[0].unknown).toBe(false);
  });

  it("compares numbers numerically even when the value arrives as a string", () => {
    // Conditions round-trip through JSONB, so "75" is a realistic input.
    const result = evaluateConditions(
      [{ field: "match_score", operator: "gt", value: "75" as unknown as number }],
      FULL_CONTEXT
    );
    expect(result.matched).toBe(true);
  });

  it("fails a numeric comparison against a non-numeric value rather than passing it", () => {
    const result = evaluateConditions(
      [{ field: "match_score", operator: "gt", value: "high" as unknown as number }],
      FULL_CONTEXT
    );
    expect(result.matched).toBe(false);
  });
});

// -----------------------------------------------------------------------------
// The runaway guard's key.
// -----------------------------------------------------------------------------
describe("buildDedupeKey", () => {
  it("is stable for the same stage-entry", () => {
    const args = {
      trigger: "application_stage_changed",
      stage: "screening",
      stageEnteredAt: "2026-08-14T09:00:00.000Z",
    };
    expect(buildDedupeKey(args)).toBe(buildDedupeKey(args));
  });

  it("changes when the application re-enters the stage later", () => {
    const first = buildDedupeKey({
      trigger: "application_stage_changed",
      stage: "screening",
      stageEnteredAt: "2026-08-14T09:00:00.000Z",
    });
    const second = buildDedupeKey({
      trigger: "application_stage_changed",
      stage: "screening",
      stageEnteredAt: "2026-08-20T09:00:00.000Z",
    });
    expect(first).not.toBe(second);
  });

  it("normalises equivalent timestamp representations to one key", () => {
    // Otherwise "+00:00" and "Z" would be two different keys for one occasion,
    // and the unique index would let a second call through.
    expect(
      buildDedupeKey({
        trigger: "application_stage_changed",
        stage: "screening",
        stageEnteredAt: "2026-08-14T09:00:00+00:00",
      })
    ).toBe(
      buildDedupeKey({
        trigger: "application_stage_changed",
        stage: "screening",
        stageEnteredAt: "2026-08-14T09:00:00.000Z",
      })
    );
  });

  it("falls back to the STRICTER key when the stage-entry time is missing", () => {
    // No timestamp means at most one run per stage, ever — rather than an
    // unbounded number keyed on nothing.
    const key = buildDedupeKey({
      trigger: "application_stage_changed",
      stage: "screening",
      stageEnteredAt: null,
    });
    expect(key).toBe("application_stage_changed:screening");
    expect(key).not.toContain("null");
  });

  it("separates different triggers on the same stage-entry", () => {
    const stageChanged = buildDedupeKey({
      trigger: "application_stage_changed",
      stage: "interview",
      stageEnteredAt: "2026-08-14T09:00:00.000Z",
    });
    const interviewDone = buildDedupeKey({
      trigger: "interview_completed",
      stage: "interview",
      stageEnteredAt: "2026-08-14T09:00:00.000Z",
    });
    expect(stageChanged).not.toBe(interviewDone);
  });
});

// -----------------------------------------------------------------------------
// Honesty about what is actually wired.
// -----------------------------------------------------------------------------
describe("TRIGGER_AVAILABILITY", () => {
  it("gives every unavailable trigger a reason to show the user", () => {
    for (const [trigger, availability] of Object.entries(TRIGGER_AVAILABILITY)) {
      if (!availability.available) {
        expect(availability.note, `${trigger} needs an explanation`).toBeTruthy();
      }
    }
  });

  it("still lists the spec's canonical stage trigger as available", () => {
    expect(TRIGGER_AVAILABILITY.application_stage_changed.available).toBe(true);
  });
});
