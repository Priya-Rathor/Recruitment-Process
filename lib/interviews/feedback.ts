// =============================================================================
// Interview feedback rules and the missing-feedback queue.
//
// FORWARD STUB (spec, Module 11): "Missing-feedback reminders are normally
// delivered by Module 15 (Notifications), which also doesn't exist yet — for
// now, log the reminder as an Activity & Audit (Module 14) event or an internal
// TODO queue instead of sending anything externally."
//
// Module 14 doesn't exist either, so this is the internal queue: overdue
// feedback is COMPUTED on read rather than pushed anywhere. Nothing is sent
// externally, and when Module 15 ships it can read the same computation and
// actually deliver a reminder.
//
// RETROFIT (spec): "When Module 15 ships, connect the missing-feedback reminder
// to its real send pipeline."
// =============================================================================

export const RECOMMENDATIONS = ["strong_yes", "yes", "no", "strong_no"] as const;
export type Recommendation = (typeof RECOMMENDATIONS)[number];

export const RECOMMENDATION_LABELS: Record<Recommendation, string> = {
  strong_yes: "Strong yes",
  yes: "Yes",
  no: "No",
  strong_no: "Strong no",
};

export const INTERVIEW_MODES = ["video", "phone", "onsite"] as const;
export type InterviewMode = (typeof INTERVIEW_MODES)[number];

export const MODE_LABELS: Record<InterviewMode, string> = {
  video: "Video",
  phone: "Phone",
  onsite: "On-site",
};

export const INTERVIEW_STATUSES = ["scheduled", "completed", "cancelled", "no_show"] as const;
export type InterviewStatus = (typeof INTERVIEW_STATUSES)[number];

export const STATUS_LABELS: Record<InterviewStatus, string> = {
  scheduled: "Scheduled",
  completed: "Completed",
  cancelled: "Cancelled",
  no_show: "No-show",
};

/**
 * How long after an interview ends before missing feedback is chased.
 *
 * Short on purpose: recollection decays fast, and feedback written three days
 * later is measurably worse than feedback written the same afternoon.
 * Module 17 should make this configurable.
 */
export const FEEDBACK_DUE_HOURS = 24;

export type FeedbackInput = {
  rating: number;
  recommendation: Recommendation;
  notes: string | null;
};

export type ParseFeedbackResult =
  | { ok: true; data: FeedbackInput }
  | { ok: false; error: string };

/**
 * Validates a feedback submission.
 *
 * Both a rating and a recommendation are required. An interview that produced
 * neither is not feedback — it is a note, and there is a notes field for that.
 */
export function parseFeedback(value: unknown): ParseFeedbackResult {
  if (typeof value !== "object" || value === null) {
    return { ok: false, error: "Invalid request body." };
  }
  const raw = value as Record<string, unknown>;

  const rating = Number(raw.rating);
  if (!Number.isInteger(rating) || rating < 1 || rating > 5) {
    return { ok: false, error: "Give a rating from 1 to 5." };
  }

  if (!(RECOMMENDATIONS as readonly string[]).includes(raw.recommendation as string)) {
    return { ok: false, error: "Choose a recommendation." };
  }

  const notes =
    typeof raw.notes === "string" && raw.notes.trim().length > 0
      ? raw.notes.trim().slice(0, 5000)
      : null;

  return {
    ok: true,
    data: { rating, recommendation: raw.recommendation as Recommendation, notes },
  };
}

export type InterviewForReminder = {
  id: string;
  scheduledAt: string;
  durationMinutes: number;
  status: InterviewStatus;
  hasFeedback: boolean;
};

export type ReminderState =
  | { due: false; reason: "not_finished" | "cancelled" | "feedback_submitted" | "too_soon" }
  | { due: true; hoursOverdue: number };

/**
 * Whether feedback is overdue for one interview.
 *
 * The spec's test: "Feedback reminder fires at the configured delay only when
 * feedback is missing." So this returns `due: false` for every other case, each
 * with a distinct reason — chasing someone for feedback on a cancelled
 * interview would be worse than not chasing at all.
 */
export function feedbackReminderState({
  interview,
  now = new Date(),
  dueHours = FEEDBACK_DUE_HOURS,
}: {
  interview: InterviewForReminder;
  now?: Date;
  dueHours?: number;
}): ReminderState {
  if (interview.hasFeedback) return { due: false, reason: "feedback_submitted" };
  if (interview.status === "cancelled") return { due: false, reason: "cancelled" };
  // A no-show has nothing to give feedback on.
  if (interview.status === "no_show") return { due: false, reason: "cancelled" };

  const scheduled = new Date(interview.scheduledAt);
  if (Number.isNaN(scheduled.getTime())) return { due: false, reason: "not_finished" };

  const endsAt = scheduled.getTime() + interview.durationMinutes * 60_000;

  // Not finished yet — the interview may not even have happened.
  if (now.getTime() < endsAt) return { due: false, reason: "not_finished" };

  const hoursSinceEnd = (now.getTime() - endsAt) / 3_600_000;
  if (hoursSinceEnd < dueHours) return { due: false, reason: "too_soon" };

  return { due: true, hoursOverdue: Math.floor(hoursSinceEnd - dueHours) };
}

/** The interviews currently awaiting feedback, most overdue first. */
export function overdueFeedback({
  interviews,
  now = new Date(),
  dueHours = FEEDBACK_DUE_HOURS,
}: {
  interviews: InterviewForReminder[];
  now?: Date;
  dueHours?: number;
}): { interview: InterviewForReminder; hoursOverdue: number }[] {
  return interviews
    .map((interview) => ({
      interview,
      state: feedbackReminderState({ interview, now, dueHours }),
    }))
    .filter(
      (entry): entry is { interview: InterviewForReminder; state: { due: true; hoursOverdue: number } } =>
        entry.state.due
    )
    .map((entry) => ({ interview: entry.interview, hoursOverdue: entry.state.hoursOverdue }))
    .sort((a, b) => b.hoursOverdue - a.hoursOverdue);
}

/** Validates a scheduling payload. */
export function parseSchedulePayload(
  value: unknown
): { ok: true; data: { scheduledAt: string; durationMinutes: number; mode: InterviewMode; interviewerId: string | null; location: string | null; notes: string | null } } | { ok: false; error: string } {
  if (typeof value !== "object" || value === null) {
    return { ok: false, error: "Invalid request body." };
  }
  const raw = value as Record<string, unknown>;

  if (typeof raw.scheduled_at !== "string") {
    return { ok: false, error: "Choose a date and time." };
  }
  const scheduled = new Date(raw.scheduled_at);
  if (Number.isNaN(scheduled.getTime())) {
    return { ok: false, error: "That date and time isn't valid." };
  }

  const duration = raw.duration_minutes === undefined ? 60 : Number(raw.duration_minutes);
  if (!Number.isFinite(duration) || duration <= 0 || duration > 480) {
    return { ok: false, error: "Duration must be between 1 and 480 minutes." };
  }

  const mode = raw.mode ?? "video";
  if (!(INTERVIEW_MODES as readonly string[]).includes(mode as string)) {
    return { ok: false, error: "Choose a valid interview mode." };
  }

  const interviewerId =
    typeof raw.interviewer_id === "string" && raw.interviewer_id.length > 0
      ? raw.interviewer_id
      : null;

  const text = (input: unknown, max: number) =>
    typeof input === "string" && input.trim().length > 0 ? input.trim().slice(0, max) : null;

  return {
    ok: true,
    data: {
      scheduledAt: scheduled.toISOString(),
      durationMinutes: Math.floor(duration),
      mode: mode as InterviewMode,
      interviewerId,
      location: text(raw.location, 300),
      notes: text(raw.notes, 2000),
    },
  };
}
