// Interview persistence and scheduling orchestration.
import { createClient } from "@/lib/supabase/server";
import { createEvent } from "@/lib/integrations/calendar";
import type { InterviewMode, InterviewStatus, Recommendation } from "@/lib/interviews/feedback";
import { formatDbError } from "@/lib/supabase/errors";

export type Interview = {
  id: string;
  organization_id: string;
  application_id: string;
  scheduled_at: string;
  duration_minutes: number;
  interviewer_id: string | null;
  mode: InterviewMode;
  status: InterviewStatus;
  calendar_event_id: string | null;
  calendar_sync_status: "not_attempted" | "synced" | "failed";
  calendar_error: string | null;
  meeting_url: string | null;
  location: string | null;
  notes: string | null;
  created_at: string;
};

export type InterviewWithContext = Interview & {
  candidate_name: string;
  job_title: string;
  interviewer_name: string | null;
  has_feedback: boolean;
};

export type Feedback = {
  id: string;
  interview_id: string;
  rating: number;
  recommendation: Recommendation;
  notes: string | null;
  submitted_by: string | null;
  submitted_at: string;
  submitter_name?: string | null;
};

const INTERVIEW_COLUMNS =
  "id, organization_id, application_id, scheduled_at, duration_minutes, interviewer_id, " +
  "mode, status, calendar_event_id, calendar_sync_status, calendar_error, meeting_url, " +
  "location, notes, created_at";

const WITH_CONTEXT =
  `${INTERVIEW_COLUMNS}, ` +
  "application:applications(id, candidate:candidates(name), job:jobs(title)), " +
  "interviewer:users!interviews_interviewer_id_fkey(name, email), " +
  "feedback:interview_feedback(id)";

type EmbeddedRow = Interview & {
  application: {
    candidate: { name: string } | null;
    job: { title: string } | null;
  } | null;
  interviewer: { name: string | null; email: string } | null;
  feedback: { id: string }[] | null;
};

function flatten(row: EmbeddedRow): InterviewWithContext {
  return {
    ...row,
    candidate_name: row.application?.candidate?.name ?? "Unknown candidate",
    job_title: row.application?.job?.title ?? "Unknown job",
    interviewer_name: row.interviewer ? row.interviewer.name ?? row.interviewer.email : null,
    has_feedback: (row.feedback?.length ?? 0) > 0,
  };
}

export async function listInterviews({
  organizationId,
  status,
  applicationId,
  limit = 100,
}: {
  organizationId: string;
  status?: InterviewStatus | null;
  applicationId?: string | null;
  limit?: number;
}): Promise<{ interviews: InterviewWithContext[]; failed: boolean }> {
  const supabase = await createClient();

  let query = supabase
    .from("interviews")
    .select(WITH_CONTEXT)
    .eq("organization_id", organizationId)
    .order("scheduled_at", { ascending: false })
    .limit(limit);

  if (status) query = query.eq("status", status);
  if (applicationId) query = query.eq("application_id", applicationId);

  const { data, error } = await query;
  if (error) {
    console.error(`[interviews] list failed: ${formatDbError(error)}`);
    return { interviews: [], failed: true };
  }

  return {
    interviews: ((data ?? []) as unknown as EmbeddedRow[]).map(flatten),
    failed: false,
  };
}

export async function getInterview({
  organizationId,
  interviewId,
}: {
  organizationId: string;
  interviewId: string;
}): Promise<{ interview: InterviewWithContext; feedback: Feedback[] } | null> {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from("interviews")
    .select(WITH_CONTEXT)
    .eq("id", interviewId)
    .eq("organization_id", organizationId)
    .maybeSingle();

  if (error || !data) return null;

  const { data: feedbackRows } = await supabase
    .from("interview_feedback")
    .select(
      "id, interview_id, rating, recommendation, notes, submitted_by, submitted_at, " +
        "submitter:users!interview_feedback_submitted_by_fkey(name, email)"
    )
    .eq("interview_id", interviewId)
    .eq("organization_id", organizationId)
    .order("submitted_at", { ascending: false });

  const feedback = ((feedbackRows ?? []) as unknown as (Feedback & {
    submitter: { name: string | null; email: string } | null;
  })[]).map((row) => ({
    ...row,
    submitter_name: row.submitter ? row.submitter.name ?? row.submitter.email : null,
  }));

  return { interview: flatten(data as unknown as EmbeddedRow), feedback };
}

export type ScheduleResult =
  | { ok: true; interviewId: string; calendarMessage: string | null }
  | { ok: false; error: string };

/**
 * Schedules an interview.
 *
 * ORDER IS THE POINT. The interview row is written FIRST and the calendar is
 * attempted afterwards — the spec's test is "calendar integration failure does
 * not block internal interview scheduling". A calendar problem downgrades to a
 * message, never to a lost interview.
 */
export async function scheduleInterview({
  organizationId,
  applicationId,
  createdBy,
  scheduledAt,
  durationMinutes,
  mode,
  interviewerId,
  location,
  notes,
}: {
  organizationId: string;
  applicationId: string;
  createdBy: string;
  scheduledAt: string;
  durationMinutes: number;
  mode: InterviewMode;
  interviewerId: string | null;
  location: string | null;
  notes: string | null;
}): Promise<ScheduleResult> {
  const supabase = await createClient();

  const { data: application } = await supabase
    .from("applications")
    .select("id, candidate:candidates(name), job:jobs(title)")
    .eq("id", applicationId)
    .eq("organization_id", organizationId)
    .maybeSingle();

  if (!application) return { ok: false, error: "Application not found." };

  const context = application as unknown as {
    candidate: { name: string } | null;
    job: { title: string } | null;
  };

  if (interviewerId) {
    const { data: member } = await supabase
      .from("organization_members")
      .select("user_id")
      .eq("organization_id", organizationId)
      .eq("user_id", interviewerId)
      .eq("status", "active")
      .maybeSingle();
    if (!member) return { ok: false, error: "That interviewer is not a member of this team." };
  }

  // 1. Persist. This must succeed on its own.
  const { data: created, error } = await supabase
    .from("interviews")
    .insert({
      organization_id: organizationId,
      application_id: applicationId,
      scheduled_at: scheduledAt,
      duration_minutes: durationMinutes,
      interviewer_id: interviewerId,
      mode,
      location,
      notes,
      created_by: createdBy,
      calendar_sync_status: "not_attempted",
    })
    .select("id")
    .single();

  if (error || !created) {
    console.error(`[interviews] scheduling failed: ${formatDbError(error)}`);
    return { ok: false, error: "Could not schedule that interview." };
  }

  const interviewId = (created as { id: string }).id;

  // 2. Try the calendar. Anything that goes wrong here is reported, not fatal.
  const candidateName = context.candidate?.name ?? "Candidate";
  const jobTitle = context.job?.title ?? "the role";

  const attendeeEmails: string[] = [];
  if (interviewerId) {
    const { data: interviewer } = await supabase
      .from("users")
      .select("email")
      .eq("id", interviewerId)
      .maybeSingle();
    const email = (interviewer as { email: string } | null)?.email;
    if (email) attendeeEmails.push(email);
  }

  const event = await createEvent({
    organizationId,
    title: `Interview: ${candidateName} — ${jobTitle}`,
    description: notes ?? `Interview for ${jobTitle}.`,
    startsAt: new Date(scheduledAt),
    durationMinutes,
    attendeeEmails,
    requestConferencing: mode === "video",
  });

  if (event.ok) {
    await supabase
      .from("interviews")
      .update({
        calendar_event_id: event.eventId,
        meeting_url: event.meetingUrl,
        calendar_sync_status: "synced",
        calendar_error: null,
      })
      .eq("id", interviewId)
      .eq("organization_id", organizationId);

    return { ok: true, interviewId, calendarMessage: null };
  }

  // `not_connected` is the expected state until Module 17 — recorded as
  // not_attempted rather than failed, so it never reads as a malfunction.
  await supabase
    .from("interviews")
    .update({
      calendar_sync_status: event.reason === "not_connected" ? "not_attempted" : "failed",
      calendar_error: event.message,
    })
    .eq("id", interviewId)
    .eq("organization_id", organizationId);

  return { ok: true, interviewId, calendarMessage: event.message };
}

/** Interviews awaiting feedback, for the internal reminder queue. */
export async function listInterviewsAwaitingFeedback(organizationId: string) {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from("interviews")
    .select(`${WITH_CONTEXT}`)
    .eq("organization_id", organizationId)
    .in("status", ["scheduled", "completed"])
    .order("scheduled_at", { ascending: true })
    .limit(200);

  if (error) return [];

  return ((data ?? []) as unknown as EmbeddedRow[]).map(flatten).filter((row) => !row.has_feedback);
}

/**
 * Scheduled interviews starting inside a window, for the candidate reminder.
 *
 * BOUNDED AT BOTH ENDS, and both bounds matter:
 *
 *   - the LOWER bound is now. An interview that has already started does not need
 *     a reminder, and sending one is worse than sending nothing — it tells somebody
 *     they are late.
 *   - the UPPER bound is the organization's configured lead time. Without it the
 *     dispatcher would remind every candidate about every interview in the diary
 *     the first time anybody pressed the button.
 *
 * `status = scheduled` only: a cancelled or completed interview must never produce
 * a reminder, and Module 11 already keeps that column truthful.
 */
export async function listInterviewsStartingWithin({
  organizationId,
  hours,
  now = new Date(),
}: {
  organizationId: string;
  hours: number;
  /** Injected so the reminder logic is testable without freezing the clock. */
  now?: Date;
}): Promise<InterviewWithContext[]> {
  const supabase = await createClient();

  const until = new Date(now.getTime() + hours * 3_600_000).toISOString();

  const { data, error } = await supabase
    .from("interviews")
    .select(WITH_CONTEXT)
    .eq("organization_id", organizationId)
    .eq("status", "scheduled")
    .gte("scheduled_at", now.toISOString())
    .lte("scheduled_at", until)
    .order("scheduled_at", { ascending: true })
    .limit(200);

  if (error) {
    console.error(`[interviews] reminder window read failed: ${formatDbError(error)}`);
    return [];
  }

  return ((data ?? []) as unknown as EmbeddedRow[]).map(flatten);
}
