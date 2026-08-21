// =============================================================================
// Privacy reads — the §10 activity log and the retention overview.
//
// Reads only. Every write goes through logActivity() in lib/activity/log.ts, the
// same as the rest of the audit trail. That is not tidiness: activity_events is
// append-only by design, and a second insert path into it is a second place the
// append-only guarantee could be broken.
// =============================================================================

import { createClient } from "@/lib/supabase/server";
import { describeEvent } from "@/lib/activity/events";
import { formatDbError } from "@/lib/supabase/errors";
import type { PrivacySettings } from "./settings";
import {
  findOrphanedArtifacts,
  planRetentionActions,
  type RetentionAction,
  type RetentionSubject,
} from "./retention";

/**
 * The privacy event types, as a prefix filter.
 *
 * Matched by prefix rather than enumerated so a new privacy.* event added to the
 * catalogue appears in this log without anyone remembering to register it here.
 * The migration adds a partial index on exactly this predicate.
 */
const PRIVACY_EVENT_PREFIX = "privacy.";

export type PrivacyLogRow = {
  id: string;
  eventType: string;
  description: string;
  actorLabel: string | null;
  entityId: string | null;
  createdAt: string;
};

/**
 * The §10 privacy activity log.
 *
 * DEGRADES RATHER THAN THROWS. A privacy screen that 500s because one panel
 * could not read its table is a screen nobody can use to turn recording off, and
 * the log is the least important panel on it. So a failure returns `failed: true`
 * and the page renders an error state for that section only.
 *
 * Crucially it does NOT return an empty list on failure. An empty privacy log
 * reads as "nothing sensitive has happened", which is a false statement to
 * somebody auditing a subject access request — the same reason
 * lib/dashboard/metrics.ts refuses to report a fake zero.
 */
export async function getPrivacyLog({
  organizationId,
  limit = 50,
}: {
  organizationId: string;
  limit?: number;
}): Promise<{ rows: PrivacyLogRow[]; failed: boolean }> {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from("activity_events")
    .select("id, event_type, actor_label, entity_id, metadata, created_at")
    .eq("organization_id", organizationId)
    .like("event_type", `${PRIVACY_EVENT_PREFIX}%`)
    .order("created_at", { ascending: false })
    .limit(Math.min(Math.max(limit, 1), 200));

  if (error) {
    console.error(`[privacy] log read failed: ${formatDbError(error)}`);
    return { rows: [], failed: true };
  }

  const rows = (data ?? []) as unknown as {
    id: string;
    event_type: string;
    actor_label: string | null;
    entity_id: string | null;
    metadata: Record<string, unknown> | null;
    created_at: string;
  }[];

  return {
    rows: rows.map((row) => ({
      id: row.id,
      eventType: row.event_type,
      // Rendered on read, so improving a catalogue description improves the
      // history too rather than only new rows.
      description: describeEvent(row.event_type, row.metadata ?? {}),
      actorLabel: row.actor_label,
      entityId: row.entity_id,
      createdAt: row.created_at,
    })),
    failed: false,
  };
}

/**
 * What retention would act on, if it ran now.
 *
 * A DRY RUN, ALWAYS. This function never deletes anything. The settings screen
 * needs to tell an admin "changing this to 30 days will affect 412 recordings"
 * BEFORE they save, and a preview that worked by performing the deletion would
 * be a remarkable way to find that out.
 *
 * The projection is deliberately narrow — ids, timestamps and three booleans. The
 * sweep has no business reading a transcript's contents in order to decide
 * whether it has expired, so it is not selected.
 */
export async function getRetentionOverview({
  organizationId,
  settings,
  now,
}: {
  organizationId: string;
  settings: PrivacySettings;
  now: Date;
}): Promise<{
  dueActions: RetentionAction[];
  orphans: { callId: string; artifact: string; reason: string }[];
  totalCalls: number;
  failed: boolean;
}> {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from("screening_calls")
    // recording_url is selected as a presence check only — the caller converts
    // it to a boolean immediately below and the URL never leaves this function.
    .select("id, ended_at, recording_url, transcript")
    .eq("organization_id", organizationId)
    .not("ended_at", "is", null)
    .order("ended_at", { ascending: true })
    // Bounded. An organization with a hundred thousand calls should not have its
    // settings page assemble a hundred thousand-element plan to show a count.
    .limit(5000);

  if (error) {
    console.error(`[privacy] retention overview failed: ${formatDbError(error)}`);
    return { dueActions: [], orphans: [], totalCalls: 0, failed: true };
  }

  const rows = (data ?? []) as unknown as {
    id: string;
    ended_at: string | null;
    recording_url: string | null;
    transcript: string | null;
  }[];

  const subjects: RetentionSubject[] = rows.map((row) => ({
    callId: row.id,
    capturedAt: row.ended_at ? new Date(row.ended_at) : null,
    hasRecording: Boolean(row.recording_url),
    hasTranscript: Boolean(row.transcript && row.transcript.trim().length > 0),
    // An evaluation lives on the screening report, which is a separate table.
    // Reported as false here rather than guessed: claiming an evaluation exists
    // when it does not would put a phantom row in a deletion plan.
    hasEvaluation: false,
  }));

  return {
    dueActions: planRetentionActions({ settings, subjects, now }),
    orphans: findOrphanedArtifacts({ settings, subjects }),
    totalCalls: subjects.length,
    failed: false,
  };
}

/**
 * Consent provenance for one call, for the interview record and any subject
 * access request.
 *
 * Rule 3 — "consent status must be stored with every interview" — is satisfied by
 * the columns; this is how they are read back in one shape rather than four
 * call sites each interpreting the nulls differently.
 */
export type ConsentRecord = {
  confirmed: boolean;
  confirmedAt: string | null;
  declinedAt: string | null;
  mode: "explicit" | "continuation" | null;
  recordingPermitted: boolean;
  aiDisclosureGiven: boolean;
};

export function describeConsentRecord(record: ConsentRecord): string {
  if (record.declinedAt) return "The candidate declined and the call was ended.";
  if (!record.confirmed) return "No consent recorded — the call did not reach that point.";
  return record.mode === "explicit"
    ? "The candidate explicitly agreed to continue."
    : "The candidate was told the call is automated and recorded, and continued.";
}
