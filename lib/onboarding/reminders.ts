// =============================================================================
// Module 19 — the overdue-document sweep.
//
// Reuses Module 15's notify() and the SAME dedupe discipline as
// lib/notifications/reminders.ts: a reminder that repeats every time somebody
// loads a page gets muted, and a muted reminder system is worse than none.
//
// WHO IT GOES TO. The record's assignee, and nobody else. A required document
// sitting Pending is one person's job to chase; broadcasting it to the whole
// team is how a notification centre becomes noise. A record with no assignee is
// SKIPPED rather than broadcast — and it is visible as Unassigned on the list,
// which is the honest place to fix it.
//
// WHAT IT DOES NOT DO. It never emails the candidate. See the note on the
// templates: chasing a new hire for their PAN card is a conversation a human is
// already having, and an automated nag in a recruiter's name is not ours to
// send.
// =============================================================================
import { createClient } from "@/lib/supabase/server";
import { notify } from "@/lib/notifications/notify";
import { formatDbError } from "@/lib/supabase/errors";
import { getOrganizationSettings } from "@/lib/settings/queries";
import { daysWaiting, overduePendingDocuments } from "@/lib/onboarding/documents";
import { REMINDER_COOLDOWN_HOURS } from "@/lib/notifications/reminders";

export type OnboardingReminderSummary = {
  sent: number;
  suppressed: number;
  /** True when the queue could not be read. Never reported as "0 sent". */
  failed: boolean;
  /** Null when reminders are switched off for this org. */
  reminderDays: number | null;
};

/**
 * Reminds each assignee about their overdue required documents.
 *
 * One notification PER DOCUMENT, not per record: "three documents are overdue"
 * cannot be acted on without opening the page anyway, and the document name is
 * the only part that tells the reader what to chase.
 */
export async function sendOnboardingDocumentReminders(
  organizationId: string
): Promise<OnboardingReminderSummary> {
  try {
    const { settings, failed: settingsFailed } = await getOrganizationSettings(organizationId);

    // A settings read failure means we do not know the window. Fall silent
    // rather than assume the default and nag on a number nobody chose.
    if (settingsFailed) {
      return { sent: 0, suppressed: 0, failed: true, reminderDays: null };
    }

    const reminderDays = settings.onboarding_settings.pendingReminderDays;
    if (reminderDays <= 0) {
      return { sent: 0, suppressed: 0, failed: false, reminderDays: 0 };
    }

    const supabase = await createClient();

    // Only IN PROGRESS records. An on-hold hire is paused deliberately — a
    // delayed start date — and reminding somebody about paperwork they chose to
    // park is the fastest way to teach them to ignore this.
    const { data, error } = await supabase
      .from("onboarding_documents")
      .select(
        "id, name, required, status, created_at, " +
          "record:onboarding_records!inner(id, status, assigned_to, candidate:candidates(name))"
      )
      .eq("organization_id", organizationId)
      .eq("status", "pending")
      .eq("required", true)
      .eq("record.status", "in_progress");

    if (error) {
      console.error(`[onboarding] reminder queue read failed: ${formatDbError(error)}`);
      return { sent: 0, suppressed: 0, failed: true, reminderDays };
    }

    type Row = {
      id: string;
      name: string;
      required: boolean;
      status: "pending";
      created_at: string;
      record: {
        id: string;
        assigned_to: string | null;
        candidate: { name: string } | null;
      };
    };

    const rows = (data ?? []) as unknown as Row[];
    const now = new Date();

    const overdue = overduePendingDocuments({ documents: rows, reminderDays, now })
      // No assignee, no recipient. Skipped, not broadcast.
      .filter((row) => Boolean(row.record.assigned_to));

    if (overdue.length === 0) {
      return { sent: 0, suppressed: 0, failed: false, reminderDays };
    }

    const alreadySent = await recentlyReminded({ organizationId });

    // Null means the dedupe read failed, so we cannot tell who was already
    // nagged. Send nothing: a missed reminder is recoverable, a reputation for
    // spam is not. Reported as a failure rather than as "0 sent".
    if (alreadySent === null) {
      return { sent: 0, suppressed: overdue.length, failed: true, reminderDays };
    }

    let sent = 0;
    let suppressed = 0;

    for (const row of overdue) {
      // The link carries the DOCUMENT id in its fragment, which is what makes
      // the dedupe per-document rather than per-record — otherwise the first
      // overdue document would suppress the reminder for all the others.
      const linkPath = `/hires/${row.record.id}#document-${row.id}`;

      if (alreadySent.has(linkPath)) {
        suppressed += 1;
        continue;
      }

      const result = await notify({
        organizationId,
        userId: row.record.assigned_to as string,
        type: "onboarding_document_pending",
        values: {
          candidate_name: row.record.candidate?.name ?? null,
          document_name: row.name,
          days_waiting: daysWaiting(row.created_at, now),
        },
        linkPath,
      });

      if (result.inAppCreated || result.emailStatus === "sent") sent += 1;
      else suppressed += 1;
    }

    return { sent, suppressed, failed: false, reminderDays };
  } catch (error) {
    console.error(`[onboarding] reminders failed: ${formatDbError(error)}`);
    return { sent: 0, suppressed: 0, failed: true, reminderDays: null };
  }
}

/**
 * The link paths already reminded about inside the cooldown window.
 *
 * One query for the whole batch. Returns NULL when the read failed, rather than
 * an empty set — an empty set means "nobody has been nagged, send everything",
 * which is the opposite of what a failure should cause. The caller bails out.
 */
async function recentlyReminded({
  organizationId,
}: {
  organizationId: string;
}): Promise<Set<string> | null> {
  const supabase = await createClient();
  const since = new Date(Date.now() - REMINDER_COOLDOWN_HOURS * 3600_000).toISOString();

  const { data, error } = await supabase
    .from("notifications")
    .select("link_path")
    .eq("organization_id", organizationId)
    .eq("type", "onboarding_document_pending")
    .gte("created_at", since);

  if (error) {
    console.error(`[onboarding] reminder dedupe failed; suppressing this run: ${formatDbError(error)}`);
    return null;
  }

  return new Set(((data ?? []) as { link_path: string | null }[]).map((row) => row.link_path ?? ""));
}
