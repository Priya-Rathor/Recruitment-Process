// =============================================================================
// Reminder dispatch — the retrofit that makes Modules 11 and 12 real.
//
// Both modules already COMPUTE their overdue queues correctly and were
// explicit that nothing was being sent:
//
//   Module 11: "overdue feedback is COMPUTED on read rather than pushed
//   anywhere ... when Module 15 ships it can read the same computation and
//   actually deliver a reminder."
//   Module 12: "clients past feedback_sla_days" — surfaced, never chased.
//
// So this file deliberately re-uses `overdueFeedback()` and
// `overdueFeedbackRequests()` rather than reimplementing either. The queues were
// already right and already tested; only delivery was missing.
//
// THE THING THAT NEEDED CARE IS NOT SENDING — IT IS NOT SENDING TWICE.
//
// There is no scheduler in this product (see the note at the bottom), so
// dispatch is triggered by a request. Without a guard, two people opening the
// page, or one person clicking twice, would send the same nag repeatedly — and a
// reminder system that cries wolf gets muted, which costs more than it ever
// saved. Every reminder is therefore checked against what was already sent in
// the last window before anything goes out.
// =============================================================================
import { createClient } from "@/lib/supabase/server";
import { notify } from "@/lib/notifications/notify";
import { listInterviewsAwaitingFeedback } from "@/lib/interviews/queries";
import { overdueFeedback, FEEDBACK_DUE_HOURS } from "@/lib/interviews/feedback";
import { overdueFeedbackRequests } from "@/lib/clients/sla";
import { getClientActivity, listClients } from "@/lib/clients/queries";
import { formatDbError } from "@/lib/supabase/errors";

/**
 * How long a reminder suppresses its own repeat.
 *
 * A day. Long enough that a page refresh or a second click sends nothing;
 * short enough that genuinely stale work is raised again tomorrow.
 */
export const REMINDER_COOLDOWN_HOURS = 24;

export type ReminderSummary = {
  sent: number;
  suppressed: number;
  /** Present when the queue could not be read — never reported as "0 sent". */
  failed: boolean;
};

/**
 * Which of these link paths already had a reminder of this type recently.
 *
 * One query for the whole batch rather than one per candidate: a team with 200
 * outstanding interviews would otherwise make 200 round trips before sending
 * anything.
 */
async function recentlyRemindedPaths({
  organizationId,
  type,
  linkPaths,
}: {
  organizationId: string;
  type: string;
  linkPaths: string[];
}): Promise<Set<string>> {
  if (linkPaths.length === 0) return new Set();

  const supabase = await createClient();
  const since = new Date(Date.now() - REMINDER_COOLDOWN_HOURS * 3600_000).toISOString();

  const { data, error } = await supabase
    .from("notifications")
    .select("link_path")
    .eq("organization_id", organizationId)
    .eq("type", type)
    .gte("created_at", since)
    .in("link_path", linkPaths);

  if (error) {
    // Fail towards SILENCE, not towards sending. If we cannot tell whether
    // someone was already nagged, nagging them again is the worse mistake — a
    // missed reminder is recoverable, a reputation for spam is not.
    console.error(`[reminders] dedupe read failed; suppressing this run: ${formatDbError(error)}`);
    return new Set(linkPaths);
  }

  return new Set(((data ?? []) as { link_path: string | null }[]).map((row) => row.link_path ?? ""));
}

/**
 * MODULE 11 RETROFIT — interview feedback reminders.
 *
 * Goes to the assigned INTERVIEWER, who is the only person who can clear it.
 * An interview with no interviewer assigned is skipped rather than broadcast:
 * "somebody owes feedback" sent to everyone is how a team learns to ignore
 * notifications.
 */
export async function sendFeedbackReminders(
  organizationId: string
): Promise<ReminderSummary> {
  try {
    const interviews = await listInterviewsAwaitingFeedback(organizationId);

    const overdue = overdueFeedback({
      interviews: interviews.map((interview) => ({
        id: interview.id,
        scheduledAt: interview.scheduled_at,
        durationMinutes: interview.duration_minutes,
        status: interview.status,
        hasFeedback: interview.has_feedback,
      })),
      dueHours: FEEDBACK_DUE_HOURS,
    });

    const actionable = overdue
      .map((entry) => ({
        entry,
        interview: interviews.find((row) => row.id === entry.interview.id),
      }))
      .filter(
        (item): item is { entry: (typeof overdue)[number]; interview: (typeof interviews)[number] } =>
          Boolean(item.interview?.interviewer_id)
      );

    const alreadySent = await recentlyRemindedPaths({
      organizationId,
      type: "feedback_overdue",
      linkPaths: actionable.map((item) => `/interviews/${item.interview.id}`),
    });

    let sent = 0;
    let suppressed = 0;

    for (const item of actionable) {
      const linkPath = `/interviews/${item.interview.id}`;

      if (alreadySent.has(linkPath)) {
        suppressed += 1;
        continue;
      }

      const result = await notify({
        organizationId,
        userId: item.interview.interviewer_id as string,
        type: "feedback_overdue",
        values: {
          candidate_name: item.interview.candidate_name,
          hours_overdue: item.entry.hoursOverdue,
        },
        linkPath,
      });

      if (result.inAppCreated || result.emailStatus === "sent") sent += 1;
      else suppressed += 1;
    }

    return { sent, suppressed, failed: false };
  } catch (error) {
    console.error(`[reminders] feedback reminders failed: ${formatDbError(error)}`);
    return { sent: 0, suppressed: 0, failed: true };
  }
}

/**
 * MODULE 12 RETROFIT — client feedback chases.
 *
 * Goes to the client's ACCOUNT MANAGER. Note what this does NOT do: it does not
 * email the client. Chasing a customer is a relationship decision a person
 * should make, and an automated nag sent in an account manager's name without
 * their knowledge is the kind of thing that loses an account. So the reminder is
 * internal — "this needs chasing" — and the chase itself stays human.
 */
export async function sendClientFeedbackReminders(
  organizationId: string
): Promise<ReminderSummary> {
  try {
    const { clients, failed } = await listClients({ organizationId });
    if (failed) return { sent: 0, suppressed: 0, failed: true };

    let sent = 0;
    let suppressed = 0;

    for (const client of clients) {
      if (!client.account_manager_id) continue;

      const activity = await getClientActivity({ organizationId, clientId: client.id });

      const overdue = overdueFeedbackRequests({
        events: activity.events,
        slaDays: client.feedback_sla_days,
      });

      if (overdue.length === 0) continue;

      // One reminder per CLIENT, not per overdue submission — so one path.
      const linkPath = `/clients/${client.id}`;
      const alreadySent = await recentlyRemindedPaths({
        organizationId,
        type: "client_feedback_overdue",
        linkPaths: [linkPath],
      });

      if (alreadySent.has(linkPath)) {
        suppressed += 1;
        continue;
      }

      // The single most overdue submission, not one notification per event. Ten
      // separate nags about the same client is noise; "the oldest has waited 14
      // days" is the fact the account manager acts on.
      //
      // overdueFeedbackRequests() narrows to the bare FeedbackEvent, so the
      // candidate's name is recovered by id rather than re-queried.
      const worst = overdue[0];
      const worstEvent = activity.events.find((event) => event.id === worst.event.id);

      const result = await notify({
        organizationId,
        userId: client.account_manager_id,
        type: "client_feedback_overdue",
        values: {
          client_name: client.name,
          candidate_name: worstEvent?.candidate_name ?? "a submitted candidate",
          days_waiting: worst.overdueDays + client.feedback_sla_days,
        },
        linkPath,
      });

      if (result.inAppCreated || result.emailStatus === "sent") sent += 1;
      else suppressed += 1;
    }

    return { sent, suppressed, failed: false };
  } catch (error) {
    console.error(`[reminders] client feedback reminders failed: ${formatDbError(error)}`);
    return { sent: 0, suppressed: 0, failed: true };
  }
}

// =============================================================================
// NO SCHEDULER EXISTS.
//
// Both functions above are correct and deduped, but nothing calls them on a
// timer — this product has no cron, queue, or background worker, and inventing
// one here would be a larger piece of infrastructure than the module it serves.
//
// They are therefore triggered by an explicit request (POST
// /api/notifications/reminders, and a button on /interviews). That is honest and
// it works, but it means a reminder goes out when somebody opens the app rather
// than at 9am — which is a real limitation, recorded in
// docs/modules/15-notifications-notes.md rather than papered over.
// =============================================================================

// =============================================================================
// MODULE 15 (candidate communication) — the interview reminder.
//
// ADDED TO THIS FILE ON PURPOSE, rather than as a second reminder system. The
// spec asked to "reuse Module 11's existing reminder timing config, add channel
// choice to it rather than creating a second reminder system"; Module 11 never
// built a timing config, so the nearest honest reading is one dispatcher, one
// config (organization_settings.communication_settings), one trigger point.
//
// THE ONE THING THAT IS DIFFERENT FROM EVERY OTHER REMINDER HERE.
//
// The three above go to COLLEAGUES, through notify(). This one goes to a
// CANDIDATE, so it goes through lib/communications/send.ts instead — which is
// what enforces the opt-out, appends the unsubscribe footer, and records the
// message in message_log. Routing a candidate-facing message through notify()
// would bypass all three.
//
// THE DEDUPE IS DIFFERENT TOO, AND HAS TO BE.
//
// Every other event in this module sends once per application, ever: "you were
// rejected" is said one time. A reminder is not like that — an interview can be
// rescheduled, and the new time deserves its own reminder. So this is the single
// caller that passes `dedupeSinceIso`, bounded by the reminder window itself: one
// reminder per interview per window, and a rescheduled interview that leaves and
// re-enters the window gets a fresh one.
// =============================================================================
import { getOrganizationSettings } from "@/lib/settings/queries";
import { listInterviewsStartingWithin } from "@/lib/interviews/queries";
import { findActiveTemplate, sendForEvent } from "@/lib/communications/triggers";
import { channelsFor } from "@/lib/communications/templates";

export type InterviewReminderSummary = ReminderSummary & {
  /** True when the reminder is switched off, or has no active template. */
  skipped: boolean;
  /** Why it was skipped, for the dispatcher's response. */
  reason: string | null;
};

const OFF = (reason: string): InterviewReminderSummary => ({
  sent: 0,
  suppressed: 0,
  failed: false,
  skipped: true,
  reason,
});

/**
 * Reminds candidates about interviews starting inside the configured window.
 *
 * THREE SEPARATE SWITCHES, each reported distinctly rather than as a plain zero:
 * the hours setting, the channel list, and whether an interview_reminder template
 * is active. "We did not run this" and "we ran it and there was nothing to send"
 * are different answers, and a settings screen that showed the second when the
 * first was true would send an admin looking for a bug that is not there.
 */
export async function sendInterviewReminders({
  organizationId,
  origin,
  now = new Date(),
}: {
  organizationId: string;
  /** For the unsubscribe link. See lib/communications/optout.ts. */
  origin?: string | null;
  now?: Date;
}): Promise<InterviewReminderSummary> {
  try {
    const { settings } = await getOrganizationSettings(organizationId);
    const { interviewReminderHours, interviewReminderChannels } = settings.communication_settings;

    if (interviewReminderHours <= 0) {
      return OFF("Interview reminders are switched off in Settings → Recruitment.");
    }
    if (interviewReminderChannels.length === 0) {
      return OFF("No reminder channel is selected in Settings → Recruitment.");
    }

    const supabase = await createClient();

    const template = await findActiveTemplate({
      client: supabase,
      organizationId,
      eventKey: "interview_reminder",
    });

    if (!template) {
      return OFF("No interview reminder template is switched on.");
    }

    /**
     * THE ADMIN'S CHANNEL CHOICE AND THE TEMPLATE'S MUST AGREE.
     *
     * The template says which channels it has wording for; the setting says which
     * channels this organization wants reminders on. Only the intersection can
     * send. An email-only template with WhatsApp selected has nothing to send on
     * WhatsApp, and saying so is better than a log full of "not sent" rows.
     */
    const usable = channelsFor(template.channel).filter((channel) =>
      interviewReminderChannels.includes(channel)
    );

    if (usable.length === 0) {
      return OFF(
        `"${template.name}" doesn't cover the channel you chose for reminders. ` +
          "Change the template's channel, or the reminder channel in Settings → Recruitment."
      );
    }

    const interviews = await listInterviewsStartingWithin({
      organizationId,
      hours: interviewReminderHours,
      now,
    });

    let sent = 0;
    let suppressed = 0;

    // One window back, so a rescheduled interview gets a new reminder while a
    // second press of the button within the window sends nothing.
    const dedupeSinceIso = new Date(
      now.getTime() - interviewReminderHours * 3_600_000
    ).toISOString();

    for (const interview of interviews) {
      const result = await sendForEvent({
        organizationId,
        applicationId: interview.application_id,
        eventKey: "interview_reminder",
        interview: {
          scheduled_at: interview.scheduled_at,
          mode: interview.mode,
          location: interview.location,
          meeting_url: interview.meeting_url,
        },
        origin,
        client: supabase,
        // The one caller that bounds the dedupe rather than checking forever —
        // see the header. A rescheduled interview earns a second reminder.
        dedupeSinceIso,
      });

      if (result.status === "sent") sent += 1;
      else suppressed += 1;
    }

    return { sent, suppressed, failed: false, skipped: false, reason: null };
  } catch (error) {
    console.error(`[reminders] interview reminders failed: ${formatDbError(error)}`);
    return { sent: 0, suppressed: 0, failed: true, skipped: false, reason: null };
  }
}
