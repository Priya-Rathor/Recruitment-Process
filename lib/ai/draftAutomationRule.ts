// =============================================================================
// AI Service Layer — automation rule drafting.
//
// The spec's boundary for this module: "AI suggests automations; humans approve
// them. AI is not the execution engine."
//
// Two structural properties make that true rather than promised:
//
//   1. This function returns a DRAFT RULE OBJECT. It has no database handle and
//      no way to write one, so there is no code path where a model's output
//      becomes an active automation. Storing it is a separate, authenticated
//      act, and migration 0012's trigger refuses `active` without a named human.
//
//   2. The output is validated against the closed catalogue. A rule the model
//      invents — a trigger that does not exist, an action we never wrote — is
//      rejected here, not stored as an inert rule that quietly never fires.
//
// Together: the worst outcome is a suggestion that an Owner reads and discards.
// =============================================================================
import { aiFailure, completeJson, type AiResult } from "@/lib/ai/provider";
import {
  ACTIONS,
  ACTION_LABELS,
  CONDITION_FIELDS,
  FIELD_LABELS,
  FIELD_OPERATORS,
  TRIGGERS,
  TRIGGER_LABELS,
  describeRule,
  validateRule,
  type AutomationRule,
} from "@/lib/automations/catalog";
import { APPLICATION_STAGES } from "@/lib/applications/stages";

export type DraftedAutomation = {
  name: string;
  rule: AutomationRule;
  /** Plain-language rendering, derived from the rule — never from the model. */
  summary: string;
  /** The model's own words on why this rule makes sense. Advisory only. */
  rationale: string | null;
};

const SYSTEM_PROMPT = `You turn a recruiter's description of a workflow into a structured automation rule.

You may ONLY use the vocabulary below. Do not invent triggers, fields, operators, actions, or stages. If the request cannot be expressed in this vocabulary, return {"unsupported": true, "reason": "<one short sentence>"} instead of a rule.

TRIGGERS:
${TRIGGERS.map((trigger) => `- ${trigger} — ${TRIGGER_LABELS[trigger]}`).join("\n")}

CONDITION FIELDS (with the operators each allows):
${CONDITION_FIELDS.map(
  (field) => `- ${field} — ${FIELD_LABELS[field]} — operators: ${FIELD_OPERATORS[field].join(", ")}`
).join("\n")}

STAGES (valid values for the "stage" field and for move_to_stage):
${APPLICATION_STAGES.join(", ")}

ACTIONS:
${ACTIONS.map((action) => `- ${action} — ${ACTION_LABELS[action]}`).join("\n")}

Rules for good output:
- Prefer FEWER conditions. A rule the recruiter can read in one breath is better than an exhaustive one.
- If an action contacts a candidate (start_screening_call), include the conditions that make that safe — the candidate must have a phone number, and the job must have screening questions.
- move_to_stage requires config: {"stage": "<one of the stages above>"}.
- Never propose more than 3 actions.
- The name is a short label a recruiter would recognise, 60 characters or fewer.

Respond with JSON only:
{"name": "...", "trigger": "...", "conditions": [{"field": "...", "operator": "...", "value": "..."}], "actions": [{"type": "...", "config": {}}], "rationale": "one or two sentences"}`;

type RawDraft = {
  name?: unknown;
  trigger?: unknown;
  conditions?: unknown;
  actions?: unknown;
  rationale?: unknown;
  unsupported?: unknown;
  reason?: unknown;
};

/**
 * Drafts a rule from a description.
 *
 * Takes structured input only, returns a validated draft. It never touches the
 * database — the caller stores the result as a draft, and a human activates it.
 */
export async function draftAutomationRule({
  description,
  existingRuleNames,
}: {
  description: string;
  /** So the model does not propose a duplicate of a rule they already have. */
  existingRuleNames: string[];
}): Promise<AiResult<DraftedAutomation>> {
  const trimmed = description.trim();
  if (trimmed.length < 10) {
    return aiFailure(
      "invalid_output",
      "Describe the workflow in a sentence or two so there is something to work from."
    );
  }

  const userContent = [
    `Recruiter's description: ${trimmed.slice(0, 1200)}`,
    existingRuleNames.length > 0
      ? `Rules that already exist (do not duplicate): ${existingRuleNames.slice(0, 25).join("; ")}`
      : "No automations exist yet.",
  ].join("\n\n");

  const result = await completeJson<RawDraft>({
    system: SYSTEM_PROMPT,
    user: userContent,
    temperature: 0.1,
    maxOutputTokens: 700,
    validate: (value) =>
      typeof value === "object" && value !== null ? (value as RawDraft) : null,
  });

  if (!result.ok) return result;

  const raw = result.data;

  if (raw.unsupported === true) {
    const reason =
      typeof raw.reason === "string" && raw.reason.trim().length > 0
        ? raw.reason.trim()
        : "That workflow can't be expressed with the available triggers and actions yet.";
    return aiFailure("invalid_output", reason);
  }

  // The gate. Anything outside the catalogue is rejected rather than stored.
  const validated = validateRule({
    trigger: raw.trigger,
    conditions: raw.conditions,
    actions: raw.actions,
  });

  if (!validated.ok) {
    return aiFailure(
      "invalid_output",
      `The suggested rule wasn't usable: ${validated.error} Try describing it differently, or build it by hand.`
    );
  }

  const name =
    typeof raw.name === "string" && raw.name.trim().length > 0
      ? raw.name.trim().slice(0, 60)
      : "Suggested automation";

  return {
    ok: true,
    data: {
      name,
      rule: validated.rule,
      // Derived from the validated rule, so the sentence shown to the approver
      // describes what will actually run — not what the model said it wrote.
      summary: describeRule(validated.rule),
      rationale:
        typeof raw.rationale === "string" && raw.rationale.trim().length > 0
          ? raw.rationale.trim().slice(0, 400)
          : null,
    },
  };
}
