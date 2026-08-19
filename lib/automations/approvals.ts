// =============================================================================
// HUMAN OVERSIGHT — the approval queue.
//
// A rule marked `requires_approval` does not act. It proposes: the run parks at
// `awaiting_approval` and a row lands here with the actions SNAPSHOTTED. Somebody
// reads it and approves or rejects.
//
// WHY THE SNAPSHOT MATTERS. The approver clicks on what they were shown. If the
// rule is edited between proposal and decision, executing its CURRENT actions
// would mean their click authorised something they never read. Same reasoning,
// and the same shape, as Module 19's document snapshots.
//
// WHY IT EXPIRES. A proposal about a candidate goes stale. Left pending forever
// it becomes an action taken weeks after the reason for it — an email about a
// stage they have since left. Seven days, and expiry is recorded as its own
// status: "we let it lapse" and "we said no" are different facts about somebody's
// application.
//
// THIS IS ALSO THE COMPLIANCE SURFACE. The EU AI Act's high-risk employment
// rules require an overseer with the effective capacity to intervene, and a log
// of what the system decided. Every row here names who decided, when, and what
// the alternative would have been — which is a stronger answer than a policy
// document, because it is a record rather than an intention.
// =============================================================================
import { createClient } from "@/lib/supabase/server";
import { executeApprovedActions, type ActionResult, type EngineClient } from "@/lib/automations/engine";
import { type Action } from "@/lib/automations/catalog";
import { logActivity } from "@/lib/activity/log";
import { formatDbError } from "@/lib/supabase/errors";

export type ApprovalStatus = "pending" | "approved" | "rejected" | "expired";

export type ApprovalRow = {
  id: string;
  organization_id: string;
  automation_id: string;
  run_id: string;
  application_id: string;
  actions: Action[];
  summary: string;
  status: ApprovalStatus;
  decided_by: string | null;
  decided_at: string | null;
  decision_note: string | null;
  expires_at: string;
  created_at: string;
};

export type ApprovalWithContext = ApprovalRow & {
  automation_name: string;
  candidate_name: string | null;
  job_title: string | null;
  decided_by_name: string | null;
};

const APPROVAL_COLUMNS =
  "id, organization_id, automation_id, run_id, application_id, actions, summary, status, " +
  "decided_by, decided_at, decision_note, expires_at, created_at";

const CONTEXT_JOINS =
  "automation:automations(name), " +
  "application:applications(candidate:candidates(name), job:jobs(title)), " +
  "decider:users!automation_approvals_decided_by_fkey(name, email)";

type RawApproval = ApprovalRow & {
  automation: { name: string } | null;
  application: {
    candidate: { name: string } | null;
    job: { title: string } | null;
  } | null;
  decider: { name: string | null; email: string } | null;
};

function decorate(row: RawApproval): ApprovalWithContext {
  return {
    ...row,
    automation_name: row.automation?.name ?? "Deleted automation",
    candidate_name: row.application?.candidate?.name ?? null,
    job_title: row.application?.job?.title ?? null,
    decided_by_name: row.decider?.name ?? row.decider?.email ?? null,
  };
}

/**
 * The queue.
 *
 * `failed: true` rather than an empty list on error — an unreadable queue must
 * not render as "nothing is waiting for you", which is a statement about the
 * organization rather than about our request, and here it would be a statement
 * that no candidate is waiting on a decision.
 */
export async function listApprovals({
  organizationId,
  status = "pending",
  limit = 100,
}: {
  organizationId: string;
  status?: ApprovalStatus | "all";
  limit?: number;
}): Promise<{ approvals: ApprovalWithContext[]; failed: boolean }> {
  const client = await createClient();

  let query = client
    .from("automation_approvals")
    .select(`${APPROVAL_COLUMNS}, ${CONTEXT_JOINS}`)
    .eq("organization_id", organizationId)
    .order("created_at", { ascending: true })
    .limit(limit);

  if (status !== "all") query = query.eq("status", status);

  const { data, error } = await query;

  if (error) {
    console.error(`[automations] approval queue read failed: ${formatDbError(error)}`);
    return { approvals: [], failed: true };
  }

  return {
    approvals: ((data ?? []) as unknown as RawApproval[]).map(decorate),
    failed: false,
  };
}

export async function countPendingApprovals(
  organizationId: string
): Promise<number | null> {
  const client = await createClient();

  const { count, error } = await client
    .from("automation_approvals")
    .select("id", { count: "exact", head: true })
    .eq("organization_id", organizationId)
    .eq("status", "pending")
    .gt("expires_at", new Date().toISOString());

  // null, not 0. "We couldn't count" must never display as "nothing pending".
  if (error) return null;
  return count ?? 0;
}

export async function getApproval({
  organizationId,
  approvalId,
}: {
  organizationId: string;
  approvalId: string;
}): Promise<ApprovalWithContext | null> {
  const client = await createClient();

  const { data, error } = await client
    .from("automation_approvals")
    .select(`${APPROVAL_COLUMNS}, ${CONTEXT_JOINS}`)
    .eq("id", approvalId)
    .eq("organization_id", organizationId)
    .maybeSingle();

  if (error || !data) return null;
  return decorate(data as unknown as RawApproval);
}

export type DecisionResult =
  | { ok: true; status: "approved" | "rejected"; actionResults: ActionResult[] }
  | { ok: false; error: string };

/**
 * Records a decision and, on approval, executes the snapshot.
 *
 * ORDER MATTERS, and it is the opposite of the engine's.
 *
 * The engine claims its run BEFORE acting, because a duplicate event must not
 * produce a second call. Here the DECISION is recorded before the actions run,
 * for the same reason from the other direction: two admins clicking Approve at
 * the same moment must not both execute. The update is conditional on
 * `status = 'pending'`, so the second one changes no rows and is told the
 * decision was already made — and migration 0029's trigger refuses it at the
 * database level too, for the PostgREST path.
 *
 * A consequence worth stating: if the actions fail after the decision is
 * recorded, the approval still reads "approved". That is correct. The person
 * approved; the system then failed, and the run record says so. Rolling the
 * decision back would erase the fact that a human authorised it.
 */
export async function decideApproval({
  organizationId,
  organizationName,
  approvalId,
  decision,
  decidedBy,
  note,
  webhookUrl,
}: {
  organizationId: string;
  organizationName: string;
  approvalId: string;
  decision: "approved" | "rejected";
  decidedBy: string;
  note?: string | null;
  webhookUrl: string;
}): Promise<DecisionResult> {
  const client = await createClient();

  const existing = await getApproval({ organizationId, approvalId });
  if (!existing) return { ok: false, error: "That approval request no longer exists." };

  if (existing.status !== "pending") {
    return { ok: false, error: "Somebody has already decided this one." };
  }

  // Expiry is checked here and not only by the sweep. A proposal that lapsed an
  // hour ago must not be actionable just because no sweep has run since.
  if (new Date(existing.expires_at).getTime() < Date.now()) {
    await expireApproval({ client, organizationId, approval: existing });
    return {
      ok: false,
      error: "That request expired before it was decided, so nothing was done.",
    };
  }

  const { data: decided, error } = await client
    .from("automation_approvals")
    .update({
      status: decision,
      decided_by: decidedBy,
      decided_at: new Date().toISOString(),
      decision_note: note?.trim()?.slice(0, 500) || null,
    })
    .eq("id", approvalId)
    .eq("organization_id", organizationId)
    // The race guard. Not decoration: two Approve clicks land here concurrently.
    .eq("status", "pending")
    .select("id")
    .maybeSingle();

  if (error) {
    console.error(`[automations] approval decision failed: ${formatDbError(error)}`);
    return { ok: false, error: "Could not record that decision." };
  }
  if (!decided) return { ok: false, error: "Somebody has already decided this one." };

  await logActivity({
    organizationId,
    entityType: "automation",
    entityId: existing.automation_id,
    eventType: decision === "approved" ? "automation.approved" : "automation.rejected",
    actorId: decidedBy,
    metadata: {
      name: existing.automation_name,
      application_id: existing.application_id,
      action_count: existing.actions.length,
    },
  });

  if (decision === "rejected") {
    // The run is completed as a SKIP, not a failure. A person deciding not to do
    // something is the system working, and colouring it red would train people
    // to ignore the real failures.
    await client
      .from("automation_runs")
      .update({
        status: "skipped",
        reason: "A person reviewed these actions and chose not to run them.",
        finished_at: new Date().toISOString(),
      })
      .eq("id", existing.run_id)
      .eq("organization_id", organizationId);

    return { ok: true, status: "rejected", actionResults: [] };
  }

  const executed = await executeApprovedActions({
    organizationId,
    organizationName,
    applicationId: existing.application_id,
    runId: existing.run_id,
    actions: existing.actions,
    automationName: existing.automation_name,
    approvedBy: decidedBy,
    webhookUrl,
  });

  return { ok: true, status: "approved", actionResults: executed.actionResults };
}

async function expireApproval({
  client,
  organizationId,
  approval,
}: {
  client: EngineClient;
  organizationId: string;
  approval: Pick<ApprovalRow, "id" | "run_id">;
}): Promise<void> {
  await client
    .from("automation_approvals")
    .update({ status: "expired" })
    .eq("id", approval.id)
    .eq("organization_id", organizationId)
    .eq("status", "pending");

  await client
    .from("automation_runs")
    .update({
      status: "skipped",
      reason: "Nobody approved these actions within seven days, so they were not run.",
      finished_at: new Date().toISOString(),
    })
    .eq("id", approval.run_id)
    .eq("organization_id", organizationId);
}

/**
 * Expires every lapsed proposal for an organization. Called by the sweep.
 *
 * Batched deliberately rather than done lazily on read: the parked runs need
 * completing too, and a read path that writes is a read path that fails
 * confusingly under a Viewer's session.
 */
export async function expireStaleApprovals({
  client,
  organizationId,
}: {
  client: EngineClient;
  organizationId: string;
}): Promise<{ expired: number; failed: boolean }> {
  const now = new Date().toISOString();

  const { data, error } = await client
    .from("automation_approvals")
    .select("id, run_id")
    .eq("organization_id", organizationId)
    .eq("status", "pending")
    .lte("expires_at", now)
    .limit(200);

  if (error) {
    console.error(`[automations] expiry scan failed: ${formatDbError(error)}`);
    return { expired: 0, failed: true };
  }

  const rows = (data ?? []) as { id: string; run_id: string }[];
  for (const row of rows) {
    await expireApproval({ client, organizationId, approval: row });
  }

  return { expired: rows.length, failed: false };
}
