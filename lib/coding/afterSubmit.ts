// =============================================================================
// What happens once a candidate presses Submit.
//
// THIS IS THE FILE THAT CONNECTS THE FEATURE TO THE REST OF THE PRODUCT.
//
// The requirement is that the coding result appears in the Candidate Details
// page's interview history. It would have been possible to build a new history
// section for it. That would have been wrong: `listEvaluationEntries()` already
// merges screening reports, interview feedback and manual entries into ONE list
// that feeds the Application page's Evaluation panel, the Candidate page's
// Application History, the Next Action banner and Module 16's analytics. A
// fourth surface would be a fourth place to keep in step, and the coding round
// would be invisible to the other three.
//
// So a submission writes an application_evaluations row at
// stage_key = 'written_assessment' — the stage this feature makes real — and
// every one of those surfaces picks it up without being edited.
//
// OUTCOME IS 'pending', ALWAYS.
//
// The product does not run the code, so it does not know whether the answer is
// right. Writing 'pass' would be a judgement nobody made; writing 'fail' would
// be worse. Pending is the honest reading and it is what the Evaluation panel
// already renders as "someone still has to decide" — the interviewer edits the
// row to record their verdict, using the editor that already exists for manual
// entries.
//
// NOTHING HERE MAY THROW.
//
// Same contract as logActivity() and the send pipeline: the candidate has
// already submitted, their code is already saved and frozen, and a failure to
// write a rollup row must never surface to them as "submission failed" — that
// would send them back to resubmit code the database has already locked.
// =============================================================================
import { createAdminClient } from "@/lib/supabase/admin";
import { logActivity } from "@/lib/activity/log";
import { notify } from "@/lib/notifications/notify";
import { LANGUAGE_LABELS, type CodingLanguage } from "@/lib/coding/languages";
import { formatDbError } from "@/lib/supabase/errors";

export type AfterSubmitInput = {
  organizationId: string;
  applicationId: string;
  sessionId: string;
  language: CodingLanguage;
  submittedAt: string;
};

/**
 * Records the submission everywhere the product already looks for a result.
 *
 * Best effort throughout, and each step is independent: a failed notification
 * must not stop the evaluation row being written, because the evaluation row is
 * the durable record and the notification is a convenience.
 */
export async function recordCodingSubmission(input: AfterSubmitInput): Promise<void> {
  const admin = createAdminClient();
  if (!admin) {
    console.error(
      `[coding] no service-role client; coding submission ${input.sessionId} was not rolled up ` +
        "into the evaluation history. The submission itself is saved."
    );
    return;
  }

  // Context is read from OUR rows, never supplied by the candidate's request.
  const context = await loadContext(admin, input);

  await writeEvaluationEntry(admin, input);
  await writeActivity(input, context);
  await notifyInterviewer(input, context);
}

type SubmissionContext = {
  interviewId: string | null;
  candidateName: string | null;
  jobTitle: string | null;
  interviewerId: string | null;
};

async function loadContext(
  admin: NonNullable<ReturnType<typeof createAdminClient>>,
  input: AfterSubmitInput
): Promise<SubmissionContext> {
  const empty: SubmissionContext = {
    interviewId: null,
    candidateName: null,
    jobTitle: null,
    interviewerId: null,
  };

  const { data, error } = await admin
    .from("coding_sessions")
    .select(
      "interview_id, created_by, " +
        "interview:interviews(interviewer_id), " +
        "application:applications(candidate:candidates(name), job:jobs(title))"
    )
    .eq("id", input.sessionId)
    .eq("organization_id", input.organizationId)
    .maybeSingle();

  if (error || !data) {
    if (error) console.error(`[coding] submission context failed: ${formatDbError(error)}`);
    return empty;
  }

  const row = data as unknown as {
    interview_id: string;
    created_by: string | null;
    interview: { interviewer_id: string | null } | null;
    application: { candidate: { name: string } | null; job: { title: string } | null } | null;
  };

  return {
    interviewId: row.interview_id,
    candidateName: row.application?.candidate?.name ?? null,
    jobTitle: row.application?.job?.title ?? null,
    // The assigned interviewer is the right recipient; whoever started the round
    // is the fallback, because an unassigned interview would otherwise notify
    // nobody at the moment it matters most.
    interviewerId: row.interview?.interviewer_id ?? row.created_by ?? null,
  };
}

/**
 * The rollup row.
 *
 * `logged_by` is NULL — the candidate wrote this, and a candidate is not a
 * public.users row. Inventing an actor here would put a recruiter's name against
 * work they did not do, which is the same rule lib/activity/log.ts follows for
 * system-driven events.
 */
async function writeEvaluationEntry(
  admin: NonNullable<ReturnType<typeof createAdminClient>>,
  input: AfterSubmitInput
): Promise<void> {
  const languageLabel = LANGUAGE_LABELS[input.language] ?? input.language;

  const { error } = await admin.from("application_evaluations").insert({
    organization_id: input.organizationId,
    application_id: input.applicationId,
    stage_key: "written_assessment",
    occurred_at: input.submittedAt,
    // No score: nothing has judged this yet, and a number here would look like
    // one had. The interviewer edits the row to add theirs.
    score: null,
    outcome: "pending",
    summary:
      `Live coding round submitted in ${languageLabel}. ` +
      "Open the coding submission from the interview to read the code.",
    logged_by: null,
  });

  if (error) {
    console.error(
      `[coding] could not write the evaluation entry for session ${input.sessionId}: ` +
        formatDbError(error)
    );
  }
}

async function writeActivity(
  input: AfterSubmitInput,
  context: SubmissionContext
): Promise<void> {
  await logActivity({
    organizationId: input.organizationId,
    entityType: "interview",
    entityId: context.interviewId,
    eventType: "interview.coding_round_submitted",
    // NULL, deliberately. The candidate did this and they are not a user.
    actorId: null,
    actorLabel: context.candidateName ? `${context.candidateName} (candidate)` : "Candidate",
    metadata: {
      coding_session_id: input.sessionId,
      language: LANGUAGE_LABELS[input.language] ?? input.language,
    },
    // No session exists on this request path.
    useAdminClient: true,
  });
}

async function notifyInterviewer(
  input: AfterSubmitInput,
  context: SubmissionContext
): Promise<void> {
  if (!context.interviewerId) return;

  await notify({
    organizationId: input.organizationId,
    userId: context.interviewerId,
    type: "coding_round_submitted",
    values: {
      candidate_name: context.candidateName,
      job_title: context.jobTitle,
      language: LANGUAGE_LABELS[input.language] ?? input.language,
    },
    linkPath: `/coding-sessions/${input.sessionId}`,
    useAdminClient: true,
  });
}
