// =============================================================================
// Reading and writing stage workflows.
//
// A stage workflow IS an automations row. This file is the translation between
// the builder's shape ("stage → branch → ordered actions") and Module 13's shape
// ("trigger + conditions + actions"), and nothing more. There is no second
// storage format, no shadow table, and no separate executor.
//
// -----------------------------------------------------------------------------
// WHICH TRIGGER A STAGE WORKFLOW USES, AND WHY IT IS NOT ALWAYS THE SAME ONE.
//
// Applied gets `application_created`. Every other stage gets
// `application_stage_changed`.
//
// This is not a stylistic choice — it is the difference between firing and never
// firing. An application is CREATED at Applied; it does not "change stage into"
// Applied, so no `application_stage_changed` dispatch ever happens for it. A
// workflow on Applied wired to the stage-change trigger would validate, save,
// activate, show as green in the Automations list, and never once run.
//
// The three creation paths (the API route, bulk intake, a public form
// submission) all dispatch `application_created`, so wiring to it covers every
// way a resume can arrive.
//
// -----------------------------------------------------------------------------
// WHY THE ROWS CARRY NO STAGE CONDITION.
//
// The obvious implementation gives each workflow a `stage is <X>` condition.
// This one uses the `stage_key` COLUMN instead, and dispatch() filters on it.
//
// The column wins because a condition is editable from the Module 13 builder.
// Somebody tidying rules there could change "stage is Phone Interview" to
// something else, and the row would then be a Phone Interview workflow — named
// as one, listed as one, edited on that row in this builder — that fires
// somewhere else entirely. The column is not offered as a condition field
// anywhere, so it cannot drift from the row's identity.
// =============================================================================
import { createClient } from "@/lib/supabase/server";
import {
  ACTION_LABELS,
  ACTION_STAGE_RESTRICTIONS,
  requiredIntegrationsFor,
  validateRule,
  approvalIsMandatory,
  approvalIsRecommended,
  type Action,
} from "@/lib/automations/catalog";
import { resolveTemplatedMessageActions } from "@/lib/communications/ruleActions";
import { formatDbError } from "@/lib/supabase/errors";
import { isApplicationStage, STAGE_LABELS, type ApplicationStage } from "@/lib/applications/stages";
import {
  branchesFor,
  isWorkflowBranch,
  workflowRuleName,
  workflowStages,
  type WorkflowBranch,
} from "@/lib/workflow/stages";

export type WorkflowList = {
  stage: ApplicationStage;
  branch: WorkflowBranch;
  automationId: string | null;
  status: "draft" | "active" | "paused";
  actions: Action[];
  /** Null when nothing has been saved for this slot yet. */
  updatedAt: string | null;
  pausedReason: string | null;
};

export type JobWorkflow = {
  stages: {
    stage: ApplicationStage;
    label: string;
    branches: WorkflowBranch[];
    scoreSource: string | null;
    lists: WorkflowList[];
  }[];
  /** True when the read failed — the caller shows an error, never an empty board. */
  failed: boolean;
};

/** The trigger a stage's workflow fires on. See the header. */
export function triggerForStage(stage: ApplicationStage) {
  return stage === "applied" ? ("application_created" as const) : ("application_stage_changed" as const);
}

const WORKFLOW_COLUMNS =
  "id, name, stage_key, branch, actions, status, updated_at, paused_reason";

/**
 * Every stage's configured lists for one job.
 *
 * Returns a row for EVERY stage and branch, configured or not. A builder that
 * only rendered saved slots would show a job with no workflows as an empty
 * screen, which reads as "this feature is broken" rather than "nothing is set
 * up yet" — the same mistake JobHiringStages was fixed for.
 */
export async function loadJobWorkflow({
  organizationId,
  jobId,
}: {
  organizationId: string;
  jobId: string;
}): Promise<JobWorkflow> {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from("automations")
    .select(WORKFLOW_COLUMNS)
    .eq("organization_id", organizationId)
    .eq("job_id", jobId)
    .eq("source", "stage_workflow");

  const empty = workflowStages().map((definition) => ({
    stage: definition.stage,
    label: definition.label,
    branches: definition.branches,
    scoreSource: definition.scoreSource,
    lists: definition.branches.map((branch) => ({
      stage: definition.stage,
      branch,
      automationId: null,
      status: "draft" as const,
      actions: [] as Action[],
      updatedAt: null,
      pausedReason: null,
    })),
  }));

  if (error) {
    console.error(`[workflow] load failed: ${formatDbError(error)}`);
    return { stages: empty, failed: true };
  }

  const rows = (data ?? []) as unknown as {
    id: string;
    stage_key: string;
    branch: WorkflowBranch;
    actions: Action[];
    status: "draft" | "active" | "paused";
    updated_at: string;
    paused_reason: string | null;
  }[];

  const bySlot = new Map(rows.map((row) => [`${row.stage_key}:${row.branch}`, row]));

  return {
    failed: false,
    stages: empty.map((definition) => ({
      ...definition,
      lists: definition.lists.map((list) => {
        const row = bySlot.get(`${list.stage}:${list.branch}`);
        if (!row) return list;
        return {
          ...list,
          automationId: row.id,
          status: row.status,
          actions: Array.isArray(row.actions) ? row.actions : [],
          updatedAt: row.updated_at,
          pausedReason: row.paused_reason,
        };
      }),
    })),
  };
}

export type SaveWorkflowResult =
  | { ok: true; automationId: string; deleted: boolean }
  | { ok: false; error: string; status: number };

/**
 * Saves one stage + branch list.
 *
 * AN EMPTY ACTION LIST DELETES THE ROW rather than storing a rule with no
 * actions. Module 13 refuses a rule with zero actions (correctly — it would be a
 * rule that does nothing every time it matched), and an empty list in this
 * builder means "nothing happens here", which is the absence of a rule rather
 * than a rule about nothing. Deleting also keeps the Automations page honest:
 * an emptied stage stops appearing there instead of lingering as a rule with a
 * blank Then clause.
 */
export async function saveStageWorkflow({
  organizationId,
  jobId,
  jobTitle,
  stage,
  branch,
  actions,
  activate,
  userId,
}: {
  organizationId: string;
  jobId: string;
  jobTitle: string;
  stage: ApplicationStage;
  branch: WorkflowBranch;
  actions: unknown;
  /** Whether the saved workflow should be live. */
  activate: boolean;
  userId: string;
}): Promise<SaveWorkflowResult> {
  if (!isApplicationStage(stage)) {
    return { ok: false, error: "That isn't a pipeline stage.", status: 400 };
  }
  if (!isWorkflowBranch(branch)) {
    return { ok: false, error: "That isn't a valid branch.", status: 400 };
  }
  if (!branchesFor(stage).includes(branch)) {
    return {
      ok: false,
      // Named rather than generic: "Phone Interview has no pass/fail branches"
      // tells the caller what to change; "invalid branch" does not.
      error: `${stage} has no ${branch} branch — it records a written verdict, not a score.`,
      status: 400,
    };
  }

  const supabase = await createClient();

  const list = Array.isArray(actions) ? actions : [];

  // --- Empty means delete --------------------------------------------------
  if (list.length === 0) {
    const { error } = await supabase
      .from("automations")
      .delete()
      .eq("organization_id", organizationId)
      .eq("job_id", jobId)
      .eq("stage_key", stage)
      .eq("branch", branch)
      // Belt and braces: without this a hand-written Module 13 rule that
      // happened to share the slot could be deleted by somebody emptying a
      // stage here. The partial unique index means only builder rows can
      // occupy a slot, so this should never match anything else — "should
      // never" is why it is asserted rather than assumed.
      .eq("source", "stage_workflow");

    if (error) {
      return { ok: false, error: formatDbError(error), status: 500 };
    }
    return { ok: true, automationId: "", deleted: true };
  }

  // --- Validate against the SAME closed vocabulary Module 13 uses ----------
  const validated = validateRule({
    trigger: triggerForStage(stage),
    // No conditions. The stage_key column does the scoping — see the header.
    conditions: [],
    actions: list,
  });
  if (!validated.ok) return { ok: false, error: validated.error, status: 400 };

  /**
   * STAGE RESTRICTIONS, enforced here because this is the only place that knows
   * both the action list and the stage it is being attached to.
   *
   * validateRule() cannot check it: a rule in the Module 13 builder has no stage
   * to be attached to, only conditions that may or may not mention one.
   */
  for (const action of validated.rule.actions) {
    const allowed = ACTION_STAGE_RESTRICTIONS[action.type];
    if (allowed && !allowed.includes(stage)) {
      return {
        ok: false,
        error: `"${ACTION_LABELS[action.type]}" can only be added to the ${allowed
          .map((key) => STAGE_LABELS[key as ApplicationStage] ?? key)
          .join(" or ")} stage.`,
        status: 400,
      };
    }
  }

  /**
   * TENANCY FOR EVERY ID THE ACTIONS NAME.
   *
   * The same check the Module 13 route makes, for the same reason: a template
   * id, form id, agent id or member id arriving in a request body is not proof
   * that the object belongs to the caller's organization. Skipping it here
   * because "the builder only offers your own" would make the UI the security
   * boundary, and the UI is not a boundary at all.
   */
  const resolvedActions = await resolveTemplatedMessageActions({
    organizationId,
    actions: validated.rule.actions,
  });
  if (!resolvedActions.ok) {
    return { ok: false, error: resolvedActions.error, status: 422 };
  }

  const owned = await verifyActionReferences({
    client: supabase,
    organizationId,
    actions: resolvedActions.actions,
  });
  if (!owned.ok) return { ok: false, error: owned.error, status: 422 };

  const finalActions = owned.actions;

  const requiresApproval =
    approvalIsMandatory(finalActions) || approvalIsRecommended(finalActions);

  const payload = {
    organization_id: organizationId,
    job_id: jobId,
    stage_key: stage,
    branch,
    source: "stage_workflow" as const,
    name: workflowRuleName({ jobTitle, stage, branch }),
    trigger: triggerForStage(stage),
    conditions: [],
    actions: finalActions,
    required_integrations: requiredIntegrationsFor(finalActions),
    requires_approval: requiresApproval,
    /**
     * ACTIVATION IS EXPLICIT, exactly as it is in Module 13.
     *
     * A stage workflow reaches candidates. Saving one and having it go live in
     * the same click would mean a mis-typed threshold or a wrong template starts
     * mailing people before anybody has re-read the screen.
     */
    status: activate ? ("active" as const) : ("draft" as const),
    activated_by: activate ? userId : null,
    activated_at: activate ? new Date().toISOString() : null,
    paused_reason: null,
    created_by: userId,
  };

  const { data, error } = await supabase
    .from("automations")
    .upsert(payload, { onConflict: "job_id,stage_key,branch" })
    .select("id")
    .single();

  if (error) return { ok: false, error: formatDbError(error), status: 500 };

  return { ok: true, automationId: (data as { id: string }).id, deleted: false };
}

/**
 * Proves every id an action names belongs to this organization.
 *
 * Message template ids are already handled by resolveTemplatedMessageActions();
 * this covers the three Module 25 added — forms, voice agents and the named
 * organization member — plus it strips a recipient naming somebody who is not a
 * member rather than storing it and discovering the problem at send time.
 */
async function verifyActionReferences({
  client,
  organizationId,
  actions,
}: {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  client: any;
  organizationId: string;
  actions: Action[];
}): Promise<{ ok: true; actions: Action[] } | { ok: false; error: string }> {
  const formIds = new Set<string>();
  const agentIds = new Set<string>();
  const memberIds = new Set<string>();

  for (const action of actions) {
    const config = action.config ?? {};
    if (typeof config.form_id === "string") formIds.add(config.form_id);
    if (typeof config.agent_id === "string") agentIds.add(config.agent_id);
    for (const recipient of Array.isArray(config.recipients) ? config.recipients : []) {
      const userId = (recipient as { userId?: unknown }).userId;
      if (typeof userId === "string") memberIds.add(userId);
    }
  }

  if (formIds.size > 0) {
    const { data } = await client
      .from("forms")
      .select("id")
      .eq("organization_id", organizationId)
      .in("id", [...formIds]);
    const found = new Set(((data ?? []) as { id: string }[]).map((row) => row.id));
    for (const id of formIds) {
      if (!found.has(id)) return { ok: false, error: "That form doesn't exist in this organization." };
    }
  }

  if (agentIds.size > 0) {
    const { data } = await client
      .from("voice_agents")
      .select("id")
      .eq("organization_id", organizationId)
      .in("id", [...agentIds]);
    const found = new Set(((data ?? []) as { id: string }[]).map((row) => row.id));
    for (const id of agentIds) {
      if (!found.has(id)) return { ok: false, error: "That voice agent doesn't exist in this organization." };
    }
  }

  if (memberIds.size > 0) {
    const { data } = await client
      .from("organization_members")
      .select("user_id")
      .eq("organization_id", organizationId)
      .in("user_id", [...memberIds]);
    const found = new Set(((data ?? []) as { user_id: string }[]).map((row) => row.user_id));
    for (const id of memberIds) {
      if (!found.has(id)) {
        return { ok: false, error: "One of the chosen recipients isn't a member of this organization." };
      }
    }
  }

  return { ok: true, actions };
}
