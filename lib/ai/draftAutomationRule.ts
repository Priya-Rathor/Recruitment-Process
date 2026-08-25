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
  ACTION_MODES,
  CANDIDATE_CONTACT_ACTIONS,
  CONDITION_FIELDS,
  FIELD_LABELS,
  FIELD_OPERATORS,
  FIELD_VALUE_OPTIONS,
  TRIGGERS,
  TRIGGER_LABELS,
  TRIGGER_MODES,
  approvalIsMandatory,
  checkExecutable,
  describeRule,
  validateRule,
  type ActionType,
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
  /**
   * Whether the drafted actions force human approval. Computed from the
   * VALIDATED rule, not asked of the model — a guardrail nobody may negotiate
   * cannot be something the model gets a say in.
   */
  requiresApproval: boolean;
};

/**
 * Actions the AI is not shown, and why.
 *
 * `send_templated_message` names a template by UUID. The model cannot know which
 * templates an organization has, so anything it proposed would be a fabricated id
 * — and validateRule() would reject the whole draft over it, losing every other
 * part of a rule that was otherwise fine. Offering the action and having it always
 * fail is worse than not offering it, so the prompt asks the model to say plainly
 * that this part needs a person, which the "unsupported" path already renders.
 *
 * Filtered from the prompt rather than removed from the catalogue: the action is
 * fully available in the builder, which is where the template list exists.
 *
 * DECLARED ABOVE SYSTEM_PROMPT DELIBERATELY. That prompt is a module-level template
 * literal evaluated at import time, so a `const` declared below it sits in its
 * temporal dead zone and every import of this module throws.
 */
const UNDRAFTABLE_ACTIONS: ActionType[] = ["send_templated_message"];

const SYSTEM_PROMPT = `You turn a recruiter's description of a workflow into a structured automation rule.

You may ONLY use the vocabulary below. Do not invent triggers, fields, operators, actions, or stages. If the request cannot be expressed in this vocabulary, return {"unsupported": true, "reason": "<one short sentence>"} instead of a rule.

TRIGGERS:
${TRIGGERS.map((trigger) => `- ${trigger} — ${TRIGGER_LABELS[trigger]}`).join("\n")}

CONDITION FIELDS (with the operators each allows):
${CONDITION_FIELDS.map((field) => {
  const options = FIELD_VALUE_OPTIONS[field];
  const values = options ? ` — value must be one of: ${options.map((o) => o.value).join(", ")}` : "";
  return `- ${field} — ${FIELD_LABELS[field]} — operators: ${FIELD_OPERATORS[field].join(", ")}${values}`;
}).join("\n")}

STAGES (valid values for the "stage" field and for move_to_stage):
${APPLICATION_STAGES.join(", ")}

ACTIONS:
${ACTIONS.filter((action) => !UNDRAFTABLE_ACTIONS.includes(action))
  .map(
    (action) => `- ${action} — ${ACTION_LABELS[action]} — runs on: ${ACTION_MODES[action].join(", ")} triggers`
  )
  .join("\n")}

CONDITION STRUCTURE. Conditions are a list of GROUPS. Groups are combined with AND; inside a group, "match" decides:
  [{"match": "all", "conditions": [...]}, {"match": "any", "conditions": [...]}]
Use "any" only when the request genuinely says "or". A single condition belongs in an "all" group.

Rules for good output:
- Prefer FEWER conditions. A rule the recruiter can read in one breath is better than an exhaustive one.
- If an action contacts a candidate (${CANDIDATE_CONTACT_ACTIONS.join(", ")}), include the conditions that make that safe — for a call, the candidate must have a phone number and the job must have screening questions; for an email, the candidate must have an email address.
- Never pair a "service" trigger (${TRIGGERS.filter((t) => TRIGGER_MODES[t] === "service").join(", ")}) with an action that only runs on "session" triggers. Nobody is signed in for those, so such a rule can never run.
- time_elapsed_in_stage REQUIRES a days_in_stage condition using gte or gt. Without one the rule would match every open application at once.
- move_to_stage requires config: {"stage": "<one of the stages above>"}.
- assign_recruiter requires config: {"strategy": "job_owner"}.
- If the request asks to send a message from the organization's own template library, say so in "unsupported" and explain that the person should add the "Send templated message" action themselves and pick the template. You cannot know which templates exist.
- Never propose rejecting or withdrawing an application. Ending somebody's application is a decision a person makes.
- Never propose more than 3 actions.
- The name is a short label a recruiter would recognise, 60 characters or fewer.

Respond with JSON only:
{"name": "...", "trigger": "...", "conditions": [{"match": "all", "conditions": [{"field": "...", "operator": "...", "value": "..."}]}], "actions": [{"type": "...", "config": {}}], "rationale": "one or two sentences"}`;

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

  /**
   * THE SECOND GATE, added by the upgrade.
   *
   * validateRule proves the rule is expressible. This proves it can actually RUN:
   * a sessionless trigger paired with an action that needs a signed-in user
   * validates perfectly and then never fires. Storing that would hand somebody a
   * rule they would activate, believe in, and never see work — which is worse than
   * being told now that the model got it wrong.
   */
  const executable = checkExecutable(validated.rule);
  if (!executable.ok) {
    return aiFailure(
      "invalid_output",
      `The suggested rule couldn't run as drafted. ${executable.reason} Try describing it differently, or build it by hand.`
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
      requiresApproval: approvalIsMandatory(validated.rule.actions),
    },
  };
}
