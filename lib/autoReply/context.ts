// =============================================================================
// What the agent is allowed to know.
//
// SERVER-ONLY. This is the boundary between "everything in the database" and
// "the facts one reply may be grounded in", and it is the most security-relevant
// file in this feature after the escalation guard.
//
// THE RULE IS LEAST PRIVILEGE, APPLIED TO A MODEL RATHER THAN A ROLE. The AI
// Service Layer contract is that functions "take structured input only — never a
// database handle", and this is where that contract is honoured: everything
// generateAutoReply() can say is assembled here, explicitly, field by field. A
// field nobody added is a field the agent cannot mention.
//
// THREE THINGS DELIBERATELY WITHHELD, and each is a decision rather than an
// omission:
//
//   - SALARY. jobs.salary_min/max exist and are never read here. Pay is the
//     first topic lib/autoReply/escalation.ts escalates, and the cleanest way to
//     guarantee the agent never discusses a figure is for it never to have one.
//   - THE INTERVIEW JOINING LINK. Only whether one exists. A joining link is a
//     credential; a model handed a URL will paste it, and the candidate already
//     has theirs from the calendar invite.
//   - RAW RATINGS AND INTERNAL NOTES. Interview feedback contributes its
//     RECOMMENDATION ("Proceed"), never its 1-5 rating or the interviewer's
//     notes. Those are written for colleagues, with a candour nobody intends the
//     candidate to read.
//
// Every query filters organization_id explicitly. The webhook path holds a
// service-role client, so there is no RLS behind these reads — AGENTS.md rule 8:
// "there is no safety net behind you."
// =============================================================================
import type { CommsClient } from "@/lib/communications/send";
import { STAGE_LABELS, isApplicationStage } from "@/lib/applications/stages";
import { formatDateTimeInZone } from "@/lib/time";
import type {
  AutoReplyApplicationFacts,
  AutoReplyHistoryItem,
  AutoReplyInput,
} from "@/lib/ai/generateAutoReply";
import { formatDbError } from "@/lib/supabase/errors";

/**
 * How much history the agent sees.
 *
 * Enough to follow a short exchange, and not so much that a month-old thread
 * pushes the actual question out of the model's attention. The newest messages
 * are the ones kept.
 */
const HISTORY_LIMIT = 12;

export type AutoReplyContext = {
  input: AutoReplyInput;
  /**
   * The application the reply is "about", for the resolution of which job's
   * config applies. Null when the candidate holds none — the agent then has no
   * job scope and only the organization default can apply.
   */
  primaryJobId: string | null;
  /** True when the candidate holds more than one live application. */
  multipleApplications: boolean;
};

/**
 * Assembles everything one reply may be grounded in.
 *
 * Returns null when there is not enough to answer with — no candidate on the
 * thread, or the reads failed. The caller escalates to a human rather than
 * calling the model with a thin context, because a model given almost no facts
 * still writes a confident-sounding sentence.
 */
export async function loadAutoReplyContext({
  client,
  organizationId,
  organizationName,
  timeZone,
  candidateId,
  inboundMessage,
  conversationId,
  toneInstructions,
  contextInstructions,
}: {
  client: CommsClient;
  organizationId: string;
  organizationName: string;
  /** The ORGANIZATION's timezone. Every time the agent states is formatted in it. */
  timeZone: string;
  candidateId: string;
  inboundMessage: string;
  conversationId: string;
  toneInstructions: string | null;
  contextInstructions: string | null;
}): Promise<AutoReplyContext | null> {
  try {
    const [candidate, applications, history] = await Promise.all([
      loadCandidate({ client, organizationId, candidateId }),
      loadApplications({ client, organizationId, candidateId, timeZone }),
      loadHistory({ client, organizationId, conversationId, timeZone }),
    ]);

    if (!candidate) return null;

    return {
      input: {
        inboundMessage,
        history,
        candidateName: candidate.name,
        candidateCurrentRole: candidate.currentRole,
        candidateCurrentCompany: candidate.currentCompany,
        candidateSkills: candidate.skills,
        applications: applications.map((application) => application.facts),
        organizationName,
        toneInstructions,
        contextInstructions,
      },
      /*
        WHICH JOB'S CONFIG APPLIES when a candidate holds several.

        The most recently updated live application. Not a guess dressed as a
        fact: it decides only which CONFIGURATION is used (tone, timing, the
        admin's context rules), never what the agent says — the reply is
        grounded in every application, and the prompt requires it to acknowledge
        all of them rather than pick one. Choosing the most recent matches what
        the inbox already does for its application chip.
      */
      primaryJobId: applications[0]?.jobId ?? null,
      multipleApplications: applications.length > 1,
    };
  } catch (error) {
    console.error(`[autoReply] context load failed: ${formatDbError(error)}`);
    return null;
  }
}

type CandidateFacts = {
  name: string;
  currentRole: string | null;
  currentCompany: string | null;
  skills: string[];
};

async function loadCandidate({
  client,
  organizationId,
  candidateId,
}: {
  client: CommsClient;
  organizationId: string;
  candidateId: string;
}): Promise<CandidateFacts | null> {
  const { data, error } = await client
    .from("candidates")
    // `current_role` is quoted in the schema because it is a SQL reserved word;
    // PostgREST takes the column name unquoted here.
    .select("name, current_role, current_company, skills")
    .eq("organization_id", organizationId)
    .eq("id", candidateId)
    .maybeSingle();

  if (error || !data) {
    if (error) console.error(`[autoReply] candidate read failed: ${formatDbError(error)}`);
    return null;
  }

  const row = data as {
    name: string;
    current_role: string | null;
    current_company: string | null;
    skills: string[] | null;
  };

  return {
    name: row.name,
    currentRole: row.current_role,
    currentCompany: row.current_company,
    skills: (row.skills ?? []).slice(0, 25),
  };
}

type LoadedApplication = { jobId: string; facts: AutoReplyApplicationFacts };

async function loadApplications({
  client,
  organizationId,
  candidateId,
  timeZone,
}: {
  client: CommsClient;
  organizationId: string;
  candidateId: string;
  timeZone: string;
}): Promise<LoadedApplication[]> {
  const { data, error } = await client
    .from("applications")
    .select(
      "id, job_id, stage, match_score, " +
        // NOT salary_min/salary_max, and NOT the free-text description — see
        // describeRequirements() below for why the description is excluded.
        "job:jobs(title, required_skills, experience_min, experience_max)"
    )
    .eq("organization_id", organizationId)
    .eq("candidate_id", candidateId)
    // An archived application is not something to give a candidate a status on.
    .is("archived_at", null)
    .order("updated_at", { ascending: false })
    // A candidate with more than three live applications is an agency edge case;
    // the agent acknowledges multiplicity rather than enumerating everything.
    .limit(3);

  if (error) {
    console.error(`[autoReply] application read failed: ${formatDbError(error)}`);
    return [];
  }

  const rows = (data ?? []) as unknown as {
    id: string;
    job_id: string;
    stage: string;
    match_score: number | null;
    job: {
      title: string;
      required_skills: string[] | null;
      experience_min: number | null;
      experience_max: number | null;
    } | null;
  }[];

  if (rows.length === 0) return [];

  const [interviews, screenings, feedback] = await Promise.all([
    loadNextInterviews({
      client,
      organizationId,
      applicationIds: rows.map((row) => row.id),
      timeZone,
    }),
    loadScreeningOutcomes({
      client,
      organizationId,
      applicationIds: rows.map((row) => row.id),
    }),
    loadFeedbackRecommendations({
      client,
      organizationId,
      applicationIds: rows.map((row) => row.id),
    }),
  ]);

  return rows.map((row) => {
    const interview = interviews.get(row.id) ?? null;

    return {
      jobId: row.job_id,
      facts: {
        jobTitle: row.job?.title ?? "a role",
        stageLabel: isApplicationStage(row.stage) ? STAGE_LABELS[row.stage] : row.stage,
        matchScore: row.match_score,
        nextInterviewAt: interview?.at ?? null,
        nextInterviewMode: interview?.mode ?? null,
        nextInterviewLocation: interview?.location ?? null,
        hasInterviewLink: interview?.hasLink ?? false,
        screeningOutcome: screenings.get(row.id) ?? null,
        interviewRecommendation: feedback.get(row.id) ?? null,
        jobRequirements: describeRequirements(row.job),
      },
    };
  });
}

/**
 * The job's ask, as one readable sentence.
 *
 * Assembled from the STRUCTURED fields rather than passing the free-text
 * description: a description is written for a job board and routinely contains a
 * salary range, an application deadline and a "we'll get back to you within a
 * week" — all of which the agent would then be free to repeat as fact. The
 * structured fields say the same thing with nothing in them we have not chosen.
 */
function describeRequirements(
  job: {
    required_skills: string[] | null;
    experience_min: number | null;
    experience_max: number | null;
  } | null
): string | null {
  if (!job) return null;

  const parts: string[] = [];

  const skills = (job.required_skills ?? []).filter((skill) => skill.trim().length > 0);
  if (skills.length > 0) parts.push(`Required skills: ${skills.slice(0, 15).join(", ")}.`);

  if (job.experience_min !== null && job.experience_max !== null) {
    parts.push(`Experience: ${job.experience_min}-${job.experience_max} years.`);
  } else if (job.experience_min !== null) {
    parts.push(`Experience: ${job.experience_min}+ years.`);
  }

  return parts.length > 0 ? parts.join(" ") : null;
}

type NextInterview = {
  at: string;
  mode: string | null;
  location: string | null;
  hasLink: boolean;
};

async function loadNextInterviews({
  client,
  organizationId,
  applicationIds,
  timeZone,
}: {
  client: CommsClient;
  organizationId: string;
  applicationIds: string[];
  timeZone: string;
}): Promise<Map<string, NextInterview>> {
  const result = new Map<string, NextInterview>();
  if (applicationIds.length === 0) return result;

  const { data, error } = await client
    .from("interviews")
    .select("application_id, scheduled_at, mode, location, meeting_url, status")
    .eq("organization_id", organizationId)
    .in("application_id", applicationIds)
    .eq("status", "scheduled")
    // Only what is still ahead: "when is my interview" is never answered with
    // one that already happened.
    .gte("scheduled_at", new Date().toISOString())
    .order("scheduled_at", { ascending: true });

  if (error) {
    console.error(`[autoReply] interview read failed: ${formatDbError(error)}`);
    return result;
  }

  for (const raw of (data ?? []) as {
    application_id: string;
    scheduled_at: string;
    mode: string | null;
    location: string | null;
    meeting_url: string | null;
  }[]) {
    // Ordered ascending, so the first per application is the next one.
    if (result.has(raw.application_id)) continue;

    result.set(raw.application_id, {
      // Formatted in the ORGANIZATION's timezone, never the server's — the same
      // rule every "today" in this product follows, and it matters more here:
      // the model would otherwise be handed a UTC instant and asked to be
      // helpful about it.
      at: formatDateTimeInZone(raw.scheduled_at, timeZone),
      mode: raw.mode,
      location: raw.location,
      hasLink: Boolean(raw.meeting_url),
    });
  }

  return result;
}

async function loadScreeningOutcomes({
  client,
  organizationId,
  applicationIds,
}: {
  client: CommsClient;
  organizationId: string;
  applicationIds: string[];
}): Promise<Map<string, string>> {
  const result = new Map<string, string>();
  if (applicationIds.length === 0) return result;

  const { data, error } = await client
    .from("screening_calls")
    // NOT the transcript. A transcript is the candidate's own unguarded words
    // plus whatever the agent said; quoting it back at them is both alarming and
    // a way for a prompt injection in a phone call to reach this model.
    .select("application_id, status, created_at")
    .eq("organization_id", organizationId)
    .in("application_id", applicationIds)
    .order("created_at", { ascending: false });

  if (error) {
    console.error(`[autoReply] screening read failed: ${formatDbError(error)}`);
    return result;
  }

  for (const raw of (data ?? []) as { application_id: string; status: string }[]) {
    if (result.has(raw.application_id)) continue;
    // Only a finished call is a fact worth stating. "In progress" or "failed" is
    // our operational business, not a status update for the candidate.
    if (raw.status === "completed") result.set(raw.application_id, "completed");
  }

  return result;
}

/**
 * The RECOMMENDATION from the most recent submitted feedback. Never the rating,
 * never the notes.
 *
 * The distinction is the whole point: "Proceed" is a decision the candidate is
 * about to be told anyway, while a 2/5 and an interviewer's frank notes are
 * written for colleagues. A model handed both will summarise both.
 */
async function loadFeedbackRecommendations({
  client,
  organizationId,
  applicationIds,
}: {
  client: CommsClient;
  organizationId: string;
  applicationIds: string[];
}): Promise<Map<string, string>> {
  const result = new Map<string, string>();
  if (applicationIds.length === 0) return result;

  const { data, error } = await client
    .from("interviews")
    .select("application_id, feedback:interview_feedback(recommendation, submitted_at)")
    .eq("organization_id", organizationId)
    .in("application_id", applicationIds);

  if (error) {
    console.error(`[autoReply] feedback read failed: ${formatDbError(error)}`);
    return result;
  }

  for (const raw of (data ?? []) as unknown as {
    application_id: string;
    feedback: { recommendation: string; submitted_at: string }[] | null;
  }[]) {
    const latest = (raw.feedback ?? [])
      .slice()
      .sort((a, b) => b.submitted_at.localeCompare(a.submitted_at))[0];

    if (latest) result.set(raw.application_id, latest.recommendation);
  }

  return result;
}

async function loadHistory({
  client,
  organizationId,
  conversationId,
  timeZone,
}: {
  client: CommsClient;
  organizationId: string;
  conversationId: string;
  timeZone: string;
}): Promise<AutoReplyHistoryItem[]> {
  const { data, error } = await client
    .from("message_log")
    .select("direction, body_sent, created_at, sent_at, status")
    .eq("organization_id", organizationId)
    .eq("conversation_id", conversationId)
    // Newest first, so the LIMIT keeps the recent end of the thread.
    .order("created_at", { ascending: false })
    .limit(HISTORY_LIMIT);

  if (error) {
    console.error(`[autoReply] history read failed: ${formatDbError(error)}`);
    return [];
  }

  const rows = (data ?? []) as {
    direction: "outbound" | "inbound";
    body_sent: string;
    created_at: string;
    sent_at: string | null;
    status: string;
  }[];

  return (
    rows
      // A message that was never sent is not part of the conversation. Including
      // a 'skipped' row would have the agent reply as though the candidate had
      // been told something they never received.
      .filter((row) => row.direction === "inbound" || row.status !== "skipped")
      // Back to oldest-first, which is how a conversation reads.
      .reverse()
      .map((row) => ({
        from: row.direction === "inbound" ? ("candidate" as const) : ("us" as const),
        text: row.body_sent,
        sentAt: formatDateTimeInZone(row.sent_at ?? row.created_at, timeZone),
      }))
  );
}
