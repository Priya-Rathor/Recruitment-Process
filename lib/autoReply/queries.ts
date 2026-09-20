// =============================================================================
// Reads and writes for the auto-reply agent's configuration.
//
// Session-bound, so RLS is the tenant boundary and organization_id is a filter
// for index selectivity. The service-role paths are in lib/autoReply/run.ts,
// where the explicit organization_id filter IS the boundary — the same split as
// lib/communications and lib/messaging.
//
// The master switch lives on organization_settings and is read here too, because
// every question this file is asked ("is the agent on?") is answered by the
// switch AND the config together, and two callers assembling that pair
// themselves is how they come to disagree.
// =============================================================================
import { createClient } from "@/lib/supabase/server";
import type { AutoReplyConfig, AutoReplyInput } from "@/lib/autoReply/config";
import { formatDbError } from "@/lib/supabase/errors";

const CONFIG_COLUMNS =
  "id, organization_id, job_id, enabled, response_timing, delay_minutes, " +
  "tone_instructions, context_instructions, created_by, created_at, updated_at";

export type AutoReplySettingsView = {
  masterEnabled: boolean;
  /** The organization-wide default. Null until an admin saves one. */
  orgConfig: AutoReplyConfig | null;
  /** Per-job overrides, with the job's title resolved for the table. */
  jobOverrides: { config: AutoReplyConfig; jobTitle: string | null }[];
  /** Open jobs without an override yet — the "+ Add job override" picker. */
  availableJobs: { id: string; title: string }[];
  /** True when a read failed. Never rendered as "nothing is configured". */
  failed: boolean;
};

/**
 * Everything the settings page needs, in one call.
 *
 * `failed` rather than an empty view, for the reason every read in this codebase
 * does it: "the agent is not configured" and "we could not read the agent's
 * configuration" must never look the same on a page whose whole purpose is to
 * tell an admin whether an AI is currently messaging their candidates.
 */
export async function getAutoReplySettings(
  organizationId: string
): Promise<AutoReplySettingsView> {
  const supabase = await createClient();

  const [settings, configs, jobs] = await Promise.all([
    supabase
      .from("organization_settings")
      .select("auto_reply_master_enabled")
      .eq("organization_id", organizationId)
      .maybeSingle(),
    supabase
      .from("auto_reply_config")
      .select(CONFIG_COLUMNS)
      .eq("organization_id", organizationId),
    supabase
      .from("jobs")
      .select("id, title")
      .eq("organization_id", organizationId)
      .is("archived_at", null)
      .order("title", { ascending: true })
      .limit(200),
  ]);

  if (settings.error || configs.error) {
    console.error(
      `[autoReply] settings read failed: ${formatDbError(settings.error ?? configs.error)}`
    );
    return {
      masterEnabled: false,
      orgConfig: null,
      jobOverrides: [],
      availableJobs: [],
      failed: true,
    };
  }

  const rows = (configs.data ?? []) as unknown as AutoReplyConfig[];
  const jobRows = (jobs.data ?? []) as { id: string; title: string }[];
  const titles = new Map(jobRows.map((job) => [job.id, job.title]));

  const overrides = rows
    .filter((row) => row.job_id !== null)
    .map((config) => ({
      config,
      /*
        Null when the job is archived — the override row survives (it only
        cascades on a real delete), and the table says "archived job" rather
        than rendering a blank cell that reads as missing data.
      */
      jobTitle: titles.get(config.job_id as string) ?? null,
    }))
    .sort((a, b) => (a.jobTitle ?? "").localeCompare(b.jobTitle ?? ""));

  const overridden = new Set(rows.map((row) => row.job_id).filter(Boolean));

  return {
    // A missing settings row means OFF. See loadOrgContext() in run.ts for why
    // this `=== true` is the safety property rather than a style choice.
    masterEnabled:
      (settings.data as { auto_reply_master_enabled: boolean } | null)
        ?.auto_reply_master_enabled === true,
    orgConfig: rows.find((row) => row.job_id === null) ?? null,
    jobOverrides: overrides,
    availableJobs: jobRows.filter((job) => !overridden.has(job.id)),
    failed: false,
  };
}

/** Just the switch. For the inbox, which needs nothing else. */
export async function getMasterEnabled(organizationId: string): Promise<boolean> {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from("organization_settings")
    .select("auto_reply_master_enabled")
    .eq("organization_id", organizationId)
    .maybeSingle();

  if (error) {
    console.error(`[autoReply] master switch read failed: ${formatDbError(error)}`);
    // Reported as OFF on a failed read. The inbox then shows the agent as off,
    // which understates rather than overstates what is happening — and the
    // switch itself is idempotent, so turning it "on" again is harmless.
    return false;
  }

  return (
    (data as { auto_reply_master_enabled: boolean } | null)?.auto_reply_master_enabled === true
  );
}

export type SaveResult = { ok: true; id: string } | { ok: false; error: string };

/**
 * Creates or updates one scope's configuration.
 *
 * An UPSERT on the natural key rather than a read-then-branch: two admins saving
 * the organization default at once would otherwise both see "no row" and both
 * insert, and the partial unique index would reject the loser with a constraint
 * error instead of saving their work.
 */
export async function saveAutoReplyConfig({
  organizationId,
  userId,
  input,
}: {
  organizationId: string;
  userId: string;
  input: AutoReplyInput;
}): Promise<SaveResult> {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from("auto_reply_config")
    .upsert(
      {
        organization_id: organizationId,
        job_id: input.job_id,
        enabled: input.enabled,
        response_timing: input.response_timing,
        delay_minutes: input.delay_minutes,
        tone_instructions: input.tone_instructions,
        context_instructions: input.context_instructions,
        created_by: userId,
      },
      { onConflict: "organization_id,job_id" }
    )
    .select("id")
    .single();

  if (error || !data) {
    console.error(`[autoReply] config save failed: ${formatDbError(error)}`);
    return { ok: false, error: "Could not save that configuration." };
  }

  return { ok: true, id: (data as { id: string }).id };
}

/**
 * Removes a job's override, so that job falls back to the organization default.
 *
 * The ONLY way back to the default. A disabled override stops the agent for that
 * job rather than falling through — see resolveAutoReply() — so "use the org
 * default again" has to be expressible, and deleting the row is how.
 *
 * Refuses to delete the organization-wide row: there is nothing beneath it to
 * fall back to, and an admin who wants the agent off everywhere has the master
 * switch and the `enabled` toggle.
 */
export async function deleteJobOverride({
  organizationId,
  configId,
}: {
  organizationId: string;
  configId: string;
}): Promise<{ ok: true } | { ok: false; error: string }> {
  const supabase = await createClient();

  const { error } = await supabase
    .from("auto_reply_config")
    .delete()
    .eq("id", configId)
    .eq("organization_id", organizationId)
    // The guard, in the query rather than in a prior read: a request naming the
    // organization-wide row simply matches nothing.
    .not("job_id", "is", null);

  if (error) {
    console.error(`[autoReply] override delete failed: ${formatDbError(error)}`);
    return { ok: false, error: "Could not remove that override." };
  }

  return { ok: true };
}

/**
 * Flips the master switch.
 *
 * UPSERT, because an organization that has never opened Settings has no
 * organization_settings row and the switch must still work — the inbox is the
 * most likely place somebody meets this feature for the first time.
 */
export async function setMasterEnabled({
  organizationId,
  enabled,
}: {
  organizationId: string;
  enabled: boolean;
}): Promise<{ ok: true } | { ok: false; error: string }> {
  const supabase = await createClient();

  const { error } = await supabase
    .from("organization_settings")
    .upsert(
      { organization_id: organizationId, auto_reply_master_enabled: enabled },
      { onConflict: "organization_id" }
    );

  if (error) {
    console.error(`[autoReply] master switch write failed: ${formatDbError(error)}`);
    return { ok: false, error: "Could not change that setting." };
  }

  return { ok: true };
}

export type RecentAutoReply = {
  id: string;
  conversation_id: string | null;
  candidate_name: string | null;
  body: string;
  status: string;
  created_at: string;
};

/**
 * What the agent has been saying lately.
 *
 * The spot-check view the spec asks for, "especially useful in the first weeks
 * after enabling this feature". Reads the log rather than the queue, because the
 * question is what candidates actually received — a queue row says what we
 * intended.
 */
export async function listRecentAutoReplies({
  organizationId,
  limit = 50,
}: {
  organizationId: string;
  limit?: number;
}): Promise<{ replies: RecentAutoReply[]; failed: boolean }> {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from("message_log")
    .select("id, conversation_id, body_sent, status, created_at, candidate:candidates(name)")
    .eq("organization_id", organizationId)
    .eq("auto_replied", true)
    .order("created_at", { ascending: false })
    .limit(limit);

  if (error) {
    console.error(`[autoReply] recent replies read failed: ${formatDbError(error)}`);
    return { replies: [], failed: true };
  }

  const rows = (data ?? []) as unknown as {
    id: string;
    conversation_id: string | null;
    body_sent: string;
    status: string;
    created_at: string;
    candidate: { name: string } | null;
  }[];

  return {
    replies: rows.map((row) => ({
      id: row.id,
      conversation_id: row.conversation_id,
      candidate_name: row.candidate?.name ?? null,
      body: row.body_sent,
      status: row.status,
      created_at: row.created_at,
    })),
    failed: false,
  };
}
