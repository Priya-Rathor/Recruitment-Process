// =============================================================================
// RULE TEMPLATES — the starting points.
//
// A blank /automations/new is a hard screen. It asks somebody to invent a rule
// out of a vocabulary they have not read yet, and the usual outcome is either
// nothing or something over-broad.
//
// WHY THESE ARE CODE AND NOT A TABLE. The spec's Build Later list rules out a
// "cross-organization automation templates marketplace", and a table is the
// first two-thirds of one — rows, ownership, sharing, an admin screen to manage
// them. These are constants: they seed the builder and are then just a rule the
// organization owns. Nothing references the template afterwards, so there is no
// second source of truth to keep in step.
//
// WHY EVERY ONE IS CONSERVATIVE. A template is what most people will actually
// activate, so its defaults are the defaults of the product in practice. So:
// every candidate-contacting template arrives with approval on, every scheduled
// one has a real threshold, and none of them reject, archive or otherwise end
// somebody's application. A template that quietly rejects candidates would be
// this file doing harm at scale.
//
// They are also all DRAFTS when created, like every other rule — there is no
// path from picking a template to a live automation.
// =============================================================================
import type { Action, ConditionGroup, TriggerType } from "@/lib/automations/catalog";

export type RuleTemplate = {
  id: string;
  name: string;
  /** One line, shown on the card. What it does, in the user's terms. */
  summary: string;
  /** Why you would want it, and what it deliberately does not do. */
  note: string;
  trigger: TriggerType;
  conditions: ConditionGroup[];
  actions: Action[];
  /** Pre-set on the draft. Mandatory ones are forced by the API regardless. */
  requiresApproval: boolean;
  dailyRunCap: number | null;
  /** Which integrations must be connected before it can be activated. */
  needs: string[];
};

export const RULE_TEMPLATES: RuleTemplate[] = [
  {
    id: "screen_strong_matches",
    name: "Screen strong matches",
    summary:
      "When a strong match reaches AI Screening Call and can be reached by phone, start the screening call.",
    note:
      "The conditions are the safety: a phone number on file, consent recorded, and screening " +
      "questions configured on the job. Approval is on, so the first calls go out only after " +
      "somebody has read what the rule proposed.",
    trigger: "application_stage_changed",
    conditions: [
      {
        match: "all",
        conditions: [
          { field: "stage", operator: "eq", value: "ai_screening_call" },
          { field: "match_score", operator: "gte", value: 75 },
          { field: "candidate_has_phone", operator: "is_true", value: null },
          { field: "job_has_screening_questions", operator: "is_true", value: null },
        ],
      },
    ],
    actions: [{ type: "start_screening_call", config: {} }],
    requiresApproval: true,
    // Calls cost money per attempt, so the cap is low enough that a mis-set
    // condition costs an afternoon's worth rather than a month's budget.
    dailyRunCap: 25,
    needs: ["bolna"],
  },

  {
    id: "score_new_applications",
    name: "Score new applications",
    summary: "When an application is created, calculate its match score.",
    note:
      "The cheapest useful rule in the product, and the one most worth having on: without a " +
      "score, every other rule that reads match_score is permanently \"unknown\" and skips.",
    trigger: "application_created",
    conditions: [{ match: "all", conditions: [{ field: "job_is_open", operator: "is_true", value: null }] }],
    actions: [{ type: "calculate_match", config: {} }],
    requiresApproval: false,
    dailyRunCap: 200,
    needs: ["llm"],
  },

  {
    id: "chase_stale_screening",
    name: "Chase applications stuck in screening",
    summary:
      "When an application has sat in AI Screening Call for 3 days, notify the assigned recruiter and note it.",
    note:
      "The scheduler drives this one, so it needs the cron configured — the Automations page says " +
      "whether it is. It notifies a colleague rather than the candidate: an application going quiet " +
      "is our problem to fix, not something to tell them about.",
    trigger: "time_elapsed_in_stage",
    conditions: [
      {
        match: "all",
        conditions: [
          { field: "stage", operator: "eq", value: "ai_screening_call" },
          { field: "days_in_stage", operator: "gte", value: 3 },
          { field: "assigned_recruiter_present", operator: "is_true", value: null },
        ],
      },
    ],
    actions: [
      { type: "notify_recruiter", config: {} },
      {
        type: "add_note",
        config: { text: "Still in AI Screening Call after 3 days — flagged automatically." },
      },
    ],
    requiresApproval: false,
    dailyRunCap: 100,
    needs: [],
  },

  {
    id: "assign_unowned_applications",
    name: "Give every new application an owner",
    summary:
      "When an application is created with nobody assigned, assign the job's owning recruiter.",
    note:
      "Never takes an application off somebody — if anyone is already assigned, the action skips. " +
      "Jobs with no owning recruiter are skipped too rather than assigned to whoever was nearby.",
    trigger: "application_created",
    conditions: [
      {
        match: "all",
        conditions: [{ field: "assigned_recruiter_present", operator: "is_false", value: null }],
      },
    ],
    actions: [{ type: "assign_recruiter", config: { strategy: "job_owner" } }],
    requiresApproval: false,
    dailyRunCap: null,
    needs: [],
  },

  {
    id: "report_after_call",
    name: "Write up finished screening calls",
    summary: "When a screening call completes, generate the screening report.",
    note:
      "Bolna's webhook fires this, with nobody signed in — which is why report generation is not " +
      "in the actions here but a follow-up: the AI actions need a signed-in user. It moves the " +
      "application on and flags it instead, so the write-up is a human's next click rather than " +
      "something they have to notice.",
    trigger: "screening_call_completed",
    conditions: [],
    actions: [
      { type: "notify_recruiter", config: {} },
      { type: "add_note", config: { text: "Screening call finished — report not yet generated." } },
    ],
    requiresApproval: false,
    dailyRunCap: null,
    needs: [],
  },

  {
    id: "advance_after_evaluations",
    name: "Advance once every evaluation is in",
    summary:
      "When the last evaluation for an application is logged and it passed, move it to Director Round.",
    note:
      "Removes the wait between the final interviewer submitting feedback and somebody noticing. " +
      "It only advances on a pass; a fail changes nothing, because ending an application is a " +
      "decision a person makes.",
    trigger: "evaluations_complete",
    conditions: [
      {
        match: "all",
        conditions: [
          { field: "evaluation_outcome", operator: "eq", value: "pass" },
          { field: "stage", operator: "eq", value: "video_interview" },
        ],
      },
    ],
    actions: [
      { type: "move_to_stage", config: { stage: "director_round" } },
      { type: "notify_recruiter", config: {} },
    ],
    requiresApproval: false,
    dailyRunCap: null,
    needs: [],
  },

  {
    id: "tell_candidate_they_advanced",
    name: "Tell candidates when they advance",
    summary: "When an application enters Phone Interview, email the candidate a stage update.",
    note:
      "Approval cannot be switched off on this one — it is the only rule that writes to a " +
      "candidate, and every fact in the message is fixed by an approved template. It sends nothing " +
      "for a candidate with no email address on file.",
    trigger: "application_stage_changed",
    conditions: [
      {
        match: "all",
        conditions: [
          { field: "stage", operator: "eq", value: "phone_interview" },
          { field: "candidate_has_email", operator: "is_true", value: null },
        ],
      },
    ],
    actions: [{ type: "send_candidate_email", config: { template: "candidate_stage_update" } }],
    requiresApproval: true,
    dailyRunCap: 50,
    needs: ["email"],
  },

  {
    id: "handoff_hires_to_n8n",
    name: "Hand new hires to n8n",
    summary: "When an application reaches Hired, call an n8n workflow.",
    note:
      "For the work that lives outside this product — payroll, IT provisioning, a Slack " +
      "announcement. The payload is ids and the stage only: no name, email or phone leaves here, " +
      "because posting candidate details into a workflow engine is a decision an admin should make " +
      "deliberately, not inherit from a template.",
    trigger: "application_stage_changed",
    conditions: [
      { match: "all", conditions: [{ field: "stage", operator: "eq", value: "hired" }] },
    ],
    actions: [{ type: "call_n8n_webhook", config: { path: "recruitment/hired" } }],
    requiresApproval: false,
    dailyRunCap: null,
    needs: ["n8n"],
  },
];

export function getTemplate(id: string): RuleTemplate | null {
  return RULE_TEMPLATES.find((template) => template.id === id) ?? null;
}
