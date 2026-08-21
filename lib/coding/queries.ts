// =============================================================================
// The INTERVIEWER side of live coding.
//
// Session-bound Supabase client throughout, so RLS applies exactly as it does
// everywhere else in the product. The candidate's own reads and writes live in
// lib/coding/candidate.ts and use a different client for a different reason —
// see that file's header.
// =============================================================================
import { createClient } from "@/lib/supabase/server";
import { isMissingRelation } from "@/lib/dashboard/metrics";
import { listJobStages } from "@/lib/hiring-stages/queries";
import type { WrittenAssessmentConfig } from "@/lib/hiring-stages/config";
import { normalizeLanguages, type CodingLanguage } from "@/lib/coding/languages";
import {
  defaultExpiry,
  isReusable,
  MAX_INSTRUCTIONS,
  MAX_QUESTION_TITLE,
  type CodingSessionStatus,
} from "@/lib/coding/session";
import { formatDbError, SCHEMA_OUT_OF_DATE_MESSAGE } from "@/lib/supabase/errors";

export type CodingSession = {
  id: string;
  organization_id: string;
  interview_id: string;
  application_id: string;
  created_by: string | null;
  question_title: string;
  question_description: string;
  instructions: string | null;
  status: CodingSessionStatus;
  languages: CodingLanguage[];
  time_limit_minutes: number | null;
  expires_at: string;
  opened_at: string | null;
  submitted_at: string | null;
  cancelled_reason: string | null;
  created_at: string;
  updated_at: string;
};

export type CodingSubmission = {
  id: string;
  coding_session_id: string;
  programming_language: CodingLanguage;
  code: string;
  last_saved_at: string;
  submitted_at: string | null;
  save_count: number;
};

export type CodingSessionWithSubmission = CodingSession & {
  submission: CodingSubmission | null;
};

/** Everything the monitor and the submission view need, in one shape. */
export type CodingSessionDetail = CodingSessionWithSubmission & {
  candidate_name: string;
  job_title: string;
  interviewer_name: string | null;
  scheduled_at: string;
};

const SESSION_COLUMNS =
  "id, organization_id, interview_id, application_id, created_by, question_title, " +
  "question_description, instructions, status, languages, time_limit_minutes, expires_at, " +
  "opened_at, submitted_at, cancelled_reason, created_at, updated_at";

const SUBMISSION_COLUMNS =
  "id, coding_session_id, programming_language, code, last_saved_at, submitted_at, save_count";

/**
 * Rows are cast at the boundary. There are no generated Supabase types in this
 * project (that needs a live database to introspect), so a select string cannot
 * infer a row shape — the same note JOB_SELECT carries.
 */
type SessionRow = Omit<CodingSession, "languages"> & { languages: string[] | null };

function hydrate(row: SessionRow): CodingSession {
  return { ...row, languages: normalizeLanguages(row.languages) };
}

// -----------------------------------------------------------------------------
// Reads
// -----------------------------------------------------------------------------

/**
 * Every coding session for one interview, newest first.
 *
 * Plural on purpose: a round genuinely gets re-run when a connection drops or
 * the wrong question was set, and hiding the earlier attempts would make the
 * recovery path look like the only path.
 */
export async function listSessionsForInterview({
  organizationId,
  interviewId,
}: {
  organizationId: string;
  interviewId: string;
}): Promise<{ sessions: CodingSessionWithSubmission[]; failed: boolean; schemaOutOfDate: boolean }> {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from("coding_sessions")
    .select(`${SESSION_COLUMNS}, submission:coding_submissions(${SUBMISSION_COLUMNS})`)
    .eq("organization_id", organizationId)
    .eq("interview_id", interviewId)
    .order("created_at", { ascending: false });

  if (error) {
    // Migration 0031 not applied yet is a build state, not a failure — the same
    // distinction lib/hiring-stages/queries.ts draws, and the same reason.
    if (isMissingRelation(error)) {
      console.info("[coding] coding_sessions not created yet — run migration 0031.");
      return { sessions: [], failed: true, schemaOutOfDate: true };
    }
    console.error(`[coding] list sessions failed: ${formatDbError(error)}`);
    return { sessions: [], failed: true, schemaOutOfDate: false };
  }

  const sessions = ((data ?? []) as unknown as (SessionRow & {
    submission: CodingSubmission[] | CodingSubmission | null;
  })[]).map((row) => ({
    ...hydrate(row),
    // PostgREST returns a one-to-one embed as an array when it cannot prove the
    // relationship is unique. Both shapes are handled rather than assumed.
    submission: Array.isArray(row.submission) ? row.submission[0] ?? null : row.submission,
  }));

  return { sessions, failed: false, schemaOutOfDate: false };
}

/** One session with everything needed to render it. Null when not this tenant's. */
export async function getSessionDetail({
  organizationId,
  sessionId,
}: {
  organizationId: string;
  sessionId: string;
}): Promise<CodingSessionDetail | null> {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from("coding_sessions")
    .select(
      `${SESSION_COLUMNS}, submission:coding_submissions(${SUBMISSION_COLUMNS}), ` +
        "interview:interviews(scheduled_at, interviewer:users!interviews_interviewer_id_fkey(name, email)), " +
        "application:applications(candidate:candidates(name), job:jobs(title))"
    )
    .eq("id", sessionId)
    .eq("organization_id", organizationId)
    .maybeSingle();

  if (error) {
    if (!isMissingRelation(error)) {
      console.error(`[coding] session detail failed: ${formatDbError(error)}`);
    }
    return null;
  }
  if (!data) return null;

  const row = data as unknown as SessionRow & {
    submission: CodingSubmission[] | CodingSubmission | null;
    interview: {
      scheduled_at: string;
      interviewer: { name: string | null; email: string } | null;
    } | null;
    application: {
      candidate: { name: string } | null;
      job: { title: string } | null;
    } | null;
  };

  return {
    ...hydrate(row),
    submission: Array.isArray(row.submission) ? row.submission[0] ?? null : row.submission,
    candidate_name: row.application?.candidate?.name ?? "Unknown candidate",
    job_title: row.application?.job?.title ?? "Unknown job",
    interviewer_name: row.interview?.interviewer
      ? row.interview.interviewer.name ?? row.interview.interviewer.email
      : null,
    scheduled_at: row.interview?.scheduled_at ?? row.created_at,
  };
}

/** Every coding session across one application, for the evaluation rollup. */
export async function listSessionsForApplication({
  organizationId,
  applicationId,
}: {
  organizationId: string;
  applicationId: string;
}): Promise<CodingSessionWithSubmission[]> {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from("coding_sessions")
    .select(`${SESSION_COLUMNS}, submission:coding_submissions(${SUBMISSION_COLUMNS})`)
    .eq("organization_id", organizationId)
    .eq("application_id", applicationId)
    .order("created_at", { ascending: false });

  if (error) {
    if (!isMissingRelation(error)) {
      console.error(`[coding] list by application failed: ${formatDbError(error)}`);
    }
    return [];
  }

  return ((data ?? []) as unknown as (SessionRow & {
    submission: CodingSubmission[] | CodingSubmission | null;
  })[]).map((row) => ({
    ...hydrate(row),
    submission: Array.isArray(row.submission) ? row.submission[0] ?? null : row.submission,
  }));
}

// -----------------------------------------------------------------------------
// The question
// -----------------------------------------------------------------------------

export type QuestionSeed = {
  title: string;
  description: string;
  instructions: string | null;
  timeLimitMinutes: number | null;
  /** True when it came from the job's own Written Assessment configuration. */
  fromJobConfig: boolean;
};

/**
 * The question a new session should start from.
 *
 * REUSES the job's Written Assessment configuration rather than introducing a
 * second question store. That stage already holds `questions[]`, a passing score
 * and a time limit, it is already editable on the job page, and a parallel
 * "coding questions" screen would mean two places to update one thing — which
 * is how the two end up disagreeing.
 *
 * Falls back to an empty seed the interviewer types over. Deliberately NOT a
 * generic sample question: a placeholder problem that reached a real candidate
 * would be worse than an empty field the interviewer has to fill.
 */
export async function suggestQuestion({
  organizationId,
  jobId,
}: {
  organizationId: string;
  jobId: string;
}): Promise<QuestionSeed> {
  const stages = await listJobStages({ organizationId, jobId });
  const written = stages.find((stage) => stage.stage_key === "written_assessment");
  const config = (written?.config ?? {}) as Partial<WrittenAssessmentConfig>;

  const questions = Array.isArray(config.questions) ? config.questions : [];
  const first = questions.find((entry) => typeof entry === "string" && entry.trim().length > 0);

  if (!first) {
    return {
      title: "",
      description: "",
      instructions: null,
      timeLimitMinutes: config.timeLimitMinutes ?? null,
      fromJobConfig: false,
    };
  }

  const trimmed = first.trim();
  // The stage stores each question as one block of text. The first line is a
  // usable title and the whole thing is the description — splitting on the
  // newline keeps the recruiter's own wording intact either way.
  const newline = trimmed.indexOf("\n");
  const title = (newline === -1 ? trimmed : trimmed.slice(0, newline)).slice(0, MAX_QUESTION_TITLE);

  return {
    title,
    description: trimmed,
    instructions:
      questions.length > 1
        ? `Further questions configured for this job:\n\n${questions
            .slice(1)
            .join("\n\n")}`.slice(0, MAX_INSTRUCTIONS)
        : null,
    timeLimitMinutes: config.timeLimitMinutes ?? null,
    fromJobConfig: true,
  };
}

/**
 * The suggested question for an INTERVIEW, resolved in one round trip.
 *
 * A convenience over suggestQuestion(), and worth having: the interview page
 * knows an interview id and not a job id, and the obvious way to bridge that —
 * getApplicationDetail() — also loads the stage history and every note on the
 * application, three queries to read one column.
 */
export async function suggestQuestionForInterview({
  organizationId,
  interviewId,
}: {
  organizationId: string;
  interviewId: string;
}): Promise<QuestionSeed | null> {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from("interviews")
    .select("application:applications(job_id)")
    .eq("id", interviewId)
    .eq("organization_id", organizationId)
    .maybeSingle();

  if (error || !data) {
    if (error) console.error(`[coding] question suggestion failed: ${formatDbError(error)}`);
    return null;
  }

  const jobId = (data as unknown as { application: { job_id: string } | null }).application?.job_id;
  if (!jobId) return null;

  return suggestQuestion({ organizationId, jobId });
}

// -----------------------------------------------------------------------------
// Writes
// -----------------------------------------------------------------------------

export type CreateSessionInput = {
  organizationId: string;
  interviewId: string;
  applicationId: string;
  createdBy: string;
  questionTitle: string;
  questionDescription: string;
  instructions: string | null;
  languages: CodingLanguage[];
  timeLimitMinutes: number | null;
};

export type CreateSessionResult =
  | { ok: true; session: CodingSession; reused: boolean }
  | { ok: false; error: string; status: 400 | 409 | 500 };

/**
 * Creates a coding session, or hands back the one already open.
 *
 * REUSE RATHER THAN A SECOND SESSION. Clicking "Start Coding Round" twice is
 * almost always "where did that modal go?", and answering it with a fresh
 * session would silently invalidate the QR code already on screen in Google Meet
 * — the candidate would scan a dead link while the interviewer watched a monitor
 * that never updated. Reusing is the behaviour that matches the intent.
 */
export async function createSession(input: CreateSessionInput): Promise<CreateSessionResult> {
  const supabase = await createClient();

  const existing = await listSessionsForInterview({
    organizationId: input.organizationId,
    interviewId: input.interviewId,
  });

  if (existing.schemaOutOfDate) {
    return { ok: false, error: SCHEMA_OUT_OF_DATE_MESSAGE, status: 500 };
  }

  const open = existing.sessions.find((session) =>
    isReusable({ status: session.status, expiresAt: session.expires_at })
  );
  if (open) return { ok: true, session: open, reused: true };

  const { data, error } = await supabase
    .from("coding_sessions")
    .insert({
      organization_id: input.organizationId,
      interview_id: input.interviewId,
      application_id: input.applicationId,
      created_by: input.createdBy,
      question_title: input.questionTitle,
      question_description: input.questionDescription,
      instructions: input.instructions,
      languages: input.languages,
      time_limit_minutes: input.timeLimitMinutes,
      expires_at: defaultExpiry().toISOString(),
      status: "created",
    })
    .select(SESSION_COLUMNS)
    .single();

  if (error) {
    console.error(`[coding] create session failed: ${formatDbError(error)}`);
    return { ok: false, error: "Could not start the coding round.", status: 400 };
  }

  return { ok: true, session: hydrate(data as unknown as SessionRow), reused: false };
}

/**
 * Cancels a session, which is also how its link is revoked.
 *
 * The token is stateless (see lib/coding/token.ts), so THIS is the revocation
 * mechanism: the candidate page reads the session's status on every load and
 * every save, so a cancellation takes effect on the candidate's next keystroke
 * rather than at some expiry in the future.
 */
export async function cancelSession({
  organizationId,
  sessionId,
  reason,
}: {
  organizationId: string;
  sessionId: string;
  reason: string;
}): Promise<{ ok: true } | { ok: false; error: string; status: 400 | 404 | 409 }> {
  const supabase = await createClient();

  const { data: current } = await supabase
    .from("coding_sessions")
    .select("id, status")
    .eq("id", sessionId)
    .eq("organization_id", organizationId)
    .maybeSingle();

  if (!current) return { ok: false, error: "Coding session not found.", status: 404 };

  const status = (current as { status: CodingSessionStatus }).status;
  if (status === "submitted") {
    return {
      ok: false,
      error: "This round has already been submitted, so there's nothing to cancel.",
      status: 409,
    };
  }
  if (status === "cancelled") {
    return { ok: false, error: "This coding round is already cancelled.", status: 409 };
  }

  const { error } = await supabase
    .from("coding_sessions")
    .update({ status: "cancelled", cancelled_reason: reason })
    .eq("id", sessionId)
    .eq("organization_id", organizationId);

  if (error) {
    console.error(`[coding] cancel failed: ${formatDbError(error)}`);
    return { ok: false, error: "Could not cancel that coding round.", status: 400 };
  }

  return { ok: true };
}
