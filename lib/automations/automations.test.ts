import { describe, expect, it } from "vitest";
import {
  ACTIONS,
  ACTION_MODES,
  OFFERED_ACTIONS,
  isActionType,
  isRetiredAction,
  TRIGGERS,
  TRIGGER_MODES,
  TRIGGER_SOURCES,
  approvalIsMandatory,
  checkExecutable,
  countChargeable,
  describeRule,
  minimumStageAgeDays,
  normalizeConditions,
  requiredIntegrationsFor,
  validateRule,
  type Condition,
} from "@/lib/automations/catalog";
import { contactsCandidate } from "@/lib/automations/catalog";
import { RULE_TEMPLATES } from "@/lib/automations/templates";
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
  applicationSource: "referral",
  candidateHasResume: true,
  daysSinceApplied: 10,
  assignedRecruiterPresent: true,
  jobIsOpen: true,
  evaluationOutcome: "pass",
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
      // A flat list is read as a single "all of these" group, so a rule written
      // before condition groups existed still validates and still means the same.
      expect(result.rule.conditions).toHaveLength(1);
      expect(result.rule.conditions[0].match).toBe("all");
      expect(result.rule.conditions[0].conditions).toHaveLength(3);
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
//
// Every trigger now has a dispatch site — the upgrade's service-role execution
// path wired the last one. What can still be unrunnable is a COMBINATION, and
// that is what checkExecutable exists to refuse.
// -----------------------------------------------------------------------------
describe("trigger and action modes", () => {
  it("gives every trigger a mode and a plain-language source", () => {
    for (const trigger of TRIGGERS) {
      expect(TRIGGER_MODES[trigger], `${trigger} needs a mode`).toBeTruthy();
      expect(TRIGGER_SOURCES[trigger], `${trigger} needs a source sentence`).toBeTruthy();
    }
  });

  it("gives every action at least one mode it can run in", () => {
    // An action runnable in neither mode would validate into a rule that can
    // never be activated on any trigger — a dead entry in the catalogue.
    for (const action of ACTIONS) {
      expect(ACTION_MODES[action]?.length, `${action} runs nowhere`).toBeGreaterThan(0);
    }
  });

  it("refuses a sessionless trigger paired with an action that needs a session", () => {
    const result = checkExecutable({
      trigger: "time_elapsed_in_stage",
      actions: [{ type: "start_screening_call" }],
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      // The message must name the action, or an admin has to guess which one.
      expect(result.reason).toContain("Start an AI screening call");
    }
  });

  it("allows the same action on a trigger a person caused", () => {
    expect(
      checkExecutable({
        trigger: "application_stage_changed",
        actions: [{ type: "start_screening_call" }],
      }).ok
    ).toBe(true);
  });

  it("allows the engine's own actions on a scheduled trigger", () => {
    expect(
      checkExecutable({
        trigger: "time_elapsed_in_stage",
        actions: [{ type: "notify_recruiter" }, { type: "add_note" }],
      }).ok
    ).toBe(true);
  });

  it("wires the trigger that used to be refused outright", () => {
    // screening_call_completed was listed unavailable because the engine had no
    // sessionless execution path. It has one now, for the actions it performs
    // itself.
    expect(TRIGGER_MODES.screening_call_completed).toBe("service");
    expect(
      checkExecutable({
        trigger: "screening_call_completed",
        actions: [{ type: "notify_recruiter" }],
      }).ok
    ).toBe(true);
  });
});

// -----------------------------------------------------------------------------
// Condition groups — the OR that used to be impossible.
// -----------------------------------------------------------------------------
describe("condition groups", () => {
  it("passes an ANY group when only one condition matches", () => {
    const result = evaluateConditions(
      [
        {
          match: "any",
          conditions: [
            { field: "match_score", operator: "gt", value: 95 },
            { field: "interest_level", operator: "eq", value: "high" },
          ],
        },
      ],
      FULL_CONTEXT
    );
    expect(result.matched).toBe(true);
  });

  it("fails an ANY group when nothing matches, and names them all", () => {
    // Naming one would be misleading: the rule needed only one to pass, so
    // "match score was 82" alone would send somebody editing the wrong condition.
    const result = evaluateConditions(
      [
        {
          match: "any",
          conditions: [
            { field: "match_score", operator: "gt", value: 95 },
            { field: "interest_level", operator: "eq", value: "low" },
          ],
        },
      ],
      FULL_CONTEXT
    );

    expect(result.matched).toBe(false);
    expect(result.reason).toContain("None of these matched");
  });

  it("ANDs groups with each other", () => {
    const result = evaluateConditions(
      [
        {
          match: "any",
          conditions: [
            { field: "interest_level", operator: "eq", value: "high" },
            { field: "interest_level", operator: "eq", value: "medium" },
          ],
        },
        { match: "all", conditions: [{ field: "match_score", operator: "gt", value: 95 }] },
      ],
      FULL_CONTEXT
    );

    // First group passes, second does not. "(A or B) and C" must fail on C.
    expect(result.matched).toBe(false);
  });

  it("lets an ANY group proceed on partial information", () => {
    // Documented behaviour rather than an accident: an unknown fails its own
    // condition but does not poison a group that only needed one to pass.
    const result = evaluateConditions(
      [
        {
          match: "any",
          conditions: [
            { field: "screening_consent_confirmed", operator: "is_true" },
            { field: "candidate_has_phone", operator: "is_true" },
          ],
        },
      ],
      { ...FULL_CONTEXT, screeningConsentConfirmed: null }
    );

    expect(result.matched).toBe(true);
    expect(result.outcomes.some((outcome) => outcome.unknown)).toBe(true);
  });

  it("reads a pre-upgrade flat condition list as one ALL group", () => {
    const groups = normalizeConditions([
      { field: "match_score", operator: "gt", value: 75 },
      { field: "candidate_has_phone", operator: "is_true" },
    ]);

    expect(groups).toHaveLength(1);
    expect(groups[0].match).toBe("all");
    expect(groups[0].conditions).toHaveLength(2);
  });

  it("evaluates a pre-upgrade flat list exactly as it did before", () => {
    const flat: Condition[] = [
      { field: "match_score", operator: "gt", value: 75 },
      { field: "match_score", operator: "gt", value: 95 },
    ];
    // Still AND. A live rule must not change meaning because the storage shape did.
    expect(evaluateConditions(flat, FULL_CONTEXT).matched).toBe(false);
  });

  it("normalises a single-condition ANY group to ALL so the sentence is true", () => {
    const result = validateRule({
      trigger: "application_created",
      conditions: [{ match: "any", conditions: [{ field: "job_is_open", operator: "is_true" }] }],
      actions: [{ type: "add_note" }],
    });

    expect(result.ok).toBe(true);
    // Rendering "if (job is open)" with an implied "or" would be a lie about a
    // group that has nothing to be an alternative to.
    if (result.ok) expect(result.rule.conditions[0].match).toBe("all");
  });

  it("drops an empty group rather than storing a no-op", () => {
    const result = validateRule({
      trigger: "application_created",
      conditions: [{ match: "any", conditions: [] }],
      actions: [{ type: "add_note" }],
    });

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.rule.conditions).toHaveLength(0);
  });

  it("parenthesises a multi-condition ANY group in the description", () => {
    const summary = describeRule({
      trigger: "application_created",
      conditions: [
        {
          match: "any",
          conditions: [
            { field: "interest_level", operator: "eq", value: "high" },
            { field: "interest_level", operator: "eq", value: "medium" },
          ],
        },
        { match: "all", conditions: [{ field: "match_score", operator: "gt", value: 75 }] },
      ],
      actions: [{ type: "add_note" }],
    });

    // Without the brackets "A or B and C" reads two different ways.
    expect(summary).toContain("(");
    expect(summary).toContain(" or ");
  });

  it("shows a fixed-vocabulary value by its label, not its stored key", () => {
    const summary = describeRule({
      trigger: "application_created",
      conditions: [{ match: "all", conditions: [{ field: "application_source", operator: "eq", value: "job_board" }] }],
      actions: [{ type: "add_note" }],
    });

    expect(summary).toContain("Job board");
    expect(summary).not.toContain("job_board");
  });
});

// -----------------------------------------------------------------------------
// The new guardrails.
// -----------------------------------------------------------------------------
describe("guardrails", () => {
  it("rejects a value outside a fixed vocabulary", () => {
    // This is the silent-failure class: `jobboard` validates as a string and then
    // never matches anything, so the rule appears healthy and does nothing.
    const result = validateRule({
      trigger: "application_created",
      conditions: [{ field: "application_source", operator: "eq", value: "jobboard" }],
      actions: [{ type: "add_note" }],
    });
    expect(result.ok).toBe(false);
  });

  it("refuses a scheduled rule with no time threshold", () => {
    // Without one it would match every open application on the first sweep — and
    // each match consumes the dedupe key, so it could not be undone by fixing the
    // rule afterwards.
    const result = validateRule({
      trigger: "time_elapsed_in_stage",
      conditions: [{ field: "stage", operator: "eq", value: "phone_interview" }],
      actions: [{ type: "notify_recruiter" }],
    });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain("Days in current stage");
  });

  it("accepts a scheduled rule that has one", () => {
    const result = validateRule({
      trigger: "time_elapsed_in_stage",
      conditions: [{ field: "days_in_stage", operator: "gte", value: 3 }],
      actions: [{ type: "notify_recruiter" }],
    });
    expect(result.ok).toBe(true);
  });

  it("scans from the earliest day any rule could fire", () => {
    // `gt 3` first matches on day 4, `gte 3` on day 3. The sweep must scan from
    // the earlier of the two or it misses the day a rule should fire.
    expect(
      minimumStageAgeDays([
        { match: "all", conditions: [{ field: "days_in_stage", operator: "gte", value: 3 }] },
      ])
    ).toBe(3);
    expect(
      minimumStageAgeDays([
        { match: "all", conditions: [{ field: "days_in_stage", operator: "gt", value: 3 }] },
      ])
    ).toBe(4);
  });

  it("takes the smallest threshold across several rules", () => {
    expect(
      minimumStageAgeDays([
        { match: "all", conditions: [{ field: "days_in_stage", operator: "gte", value: 7 }] },
        { match: "any", conditions: [{ field: "days_in_stage", operator: "gte", value: 2 }] },
      ])
    ).toBe(2);
  });

  it("returns null when there is no threshold to scan by", () => {
    // Null makes the sweep decline rather than scan everything, which is the safe
    // direction for a rule stored before the write-time check existed.
    expect(
      minimumStageAgeDays([
        { match: "all", conditions: [{ field: "stage", operator: "eq", value: "hired" }] },
      ])
    ).toBeNull();
    // `lte 3` is an upper bound, not a wait — it must not be read as one.
    expect(
      minimumStageAgeDays([
        { match: "all", conditions: [{ field: "days_in_stage", operator: "lte", value: 3 }] },
      ])
    ).toBeNull();
  });

  it("forces approval for a candidate email and not for internal actions", () => {
    expect(approvalIsMandatory([{ type: "send_candidate_email" }])).toBe(true);
    expect(approvalIsMandatory([{ type: "notify_recruiter" }, { type: "add_note" }])).toBe(false);
  });

  it("counts chargeable actions for the ledger", () => {
    expect(
      countChargeable([
        { type: "start_screening_call" },
        { type: "add_note" },
        { type: "calculate_match" },
      ])
    ).toBe(2);
  });

  /*
    THE RETIREMENT, ASSERTED.

    n8n is no longer customer-facing, so the hand-off action is not offered — but
    it must keep parsing and keep declaring its requirement, because rules saved
    before the retirement are still live. These two facts are easy to break in
    opposite directions, so both are pinned.
  */
  it("no longer OFFERS the workflow hand-off action", () => {
    expect(OFFERED_ACTIONS).not.toContain("call_n8n_webhook");
    expect(isRetiredAction("call_n8n_webhook")).toBe(true);
  });

  it("still ACCEPTS a stored rule that uses it, so nothing live breaks", () => {
    // The failure this guards against: removing it from ACTIONS makes
    // isActionType() reject it and every existing rule fails to save with
    // "Unknown action".
    expect(isActionType("call_n8n_webhook")).toBe(true);

    const result = validateRule({
      trigger: "application_stage_changed",
      actions: [{ type: "call_n8n_webhook", config: { path: "recruitment/hired" } }],
    });
    expect(result.ok, result.ok ? "" : result.error).toBe(true);
  });

  it("offers no template that needs a retired action", () => {
    for (const template of RULE_TEMPLATES) {
      for (const action of template.actions) {
        expect(isRetiredAction(action.type), `${template.id} offers ${action.type}`).toBe(false);
      }
    }
  });

  it("requires email for a candidate email and n8n for a hand-off", () => {
    expect(requiredIntegrationsFor([{ type: "send_candidate_email" }])).toEqual(["email"]);
    expect(requiredIntegrationsFor([{ type: "call_n8n_webhook" }])).toEqual(["n8n"]);
  });

  it("still requires nothing for notify_recruiter", () => {
    // In-app notification needs no integration; email is an optional extra. Naming
    // email here would block a rule from activating over a channel it does not
    // depend on.
    expect(requiredIntegrationsFor([{ type: "notify_recruiter" }])).toEqual([]);
  });

  it("refuses an absolute URL in an n8n path", () => {
    // The host is ours to choose, not a rule author's — otherwise anyone who can
    // edit an automation could make the server POST anywhere.
    const result = validateRule({
      trigger: "application_created",
      actions: [{ type: "call_n8n_webhook", config: { path: "https://evil.example/hook" } }],
    });
    expect(result.ok).toBe(false);
  });

  it("accepts a relative n8n path and strips its leading slashes", () => {
    const result = validateRule({
      trigger: "application_created",
      actions: [{ type: "call_n8n_webhook", config: { path: "//recruitment/hired" } }],
    });

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.rule.actions[0].config?.path).toBe("recruitment/hired");
  });

  it("rejects assign_recruiter with no strategy, and specific_user with no user", () => {
    expect(validateRule({
      trigger: "application_created",
      actions: [{ type: "assign_recruiter" }],
    }).ok).toBe(false);

    expect(validateRule({
      trigger: "application_created",
      actions: [{ type: "assign_recruiter", config: { strategy: "specific_user" } }],
    }).ok).toBe(false);

    expect(validateRule({
      trigger: "application_created",
      actions: [{ type: "assign_recruiter", config: { strategy: "job_owner" } }],
    }).ok).toBe(true);
  });

  it("rejects an unknown candidate email template", () => {
    const result = validateRule({
      trigger: "application_created",
      actions: [{ type: "send_candidate_email", config: { template: "make_something_up" } }],
    });
    expect(result.ok).toBe(false);
  });
});

// -----------------------------------------------------------------------------
// The templates. These are what most people will actually activate, so their
// defaults are the product's defaults in practice.
// -----------------------------------------------------------------------------
describe("RULE_TEMPLATES", () => {
  it("every template is a valid rule", () => {
    for (const template of RULE_TEMPLATES) {
      const result = validateRule({
        trigger: template.trigger,
        conditions: template.conditions,
        actions: template.actions,
      });
      expect(result.ok, `${template.id} is not a valid rule`).toBe(true);
    }
  });

  it("every template can actually run on the trigger it names", () => {
    for (const template of RULE_TEMPLATES) {
      const result = checkExecutable({ trigger: template.trigger, actions: template.actions });
      expect(result.ok, `${template.id} cannot run: ${result.ok ? "" : result.reason}`).toBe(true);
    }
  });

  it("every template that contacts a candidate requires approval", () => {
    for (const template of RULE_TEMPLATES) {
      if (contactsCandidate(template.actions)) {
        expect(template.requiresApproval, `${template.id} contacts candidates unattended`).toBe(true);
      }
    }
  });

  it("no template ends somebody's application", () => {
    // A template is handed to people who have not read the vocabulary. One that
    // quietly rejected candidates would be this file doing harm at scale.
    for (const template of RULE_TEMPLATES) {
      for (const action of template.actions) {
        if (action.type === "move_to_stage") {
          expect(
            ["rejected", "withdrawn"],
            `${template.id} moves applications to a terminal stage`
          ).not.toContain(action.config?.stage);
        }
      }
    }
  });

  it("every template that spends money is capped", () => {
    for (const template of RULE_TEMPLATES) {
      if (countChargeable(template.actions) > 0) {
        expect(template.dailyRunCap, `${template.id} spends money with no daily cap`).not.toBeNull();
      }
    }
  });

  it("declares the integrations its actions actually need", () => {
    for (const template of RULE_TEMPLATES) {
      for (const integration of requiredIntegrationsFor(template.actions)) {
        expect(template.needs, `${template.id} does not declare ${integration}`).toContain(
          integration
        );
      }
    }
  });

  it("has unique ids and names", () => {
    expect(new Set(RULE_TEMPLATES.map((t) => t.id)).size).toBe(RULE_TEMPLATES.length);
    expect(new Set(RULE_TEMPLATES.map((t) => t.name)).size).toBe(RULE_TEMPLATES.length);
  });
});
