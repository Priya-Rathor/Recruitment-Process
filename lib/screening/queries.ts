// Screening call queries and the orchestration that places one.
import { createClient } from "@/lib/supabase/server";
import { buildCallScript } from "@/lib/screening/script";
import { getEnabledScreeningStage } from "@/lib/hiring-stages/queries";
import { renderTemplate } from "@/lib/hiring-stages/placeholders";
import { buildPlaceholderValues } from "@/lib/hiring-stages/values";
import {
  canPlaceFirstCall,
  decideRetry,
  type CallStatus,
  type RetryPolicy,
} from "@/lib/screening/retry";
import { getStatus, placeCall } from "@/lib/integrations/bolna";
// MODULE 24 — the Voice Agent Console's organization-wide fallbacks. Precedence
// is resolved by the same pure function the console's preview renders, so what an
// admin was shown is what gets dialled.
import { loadJobScreeningOverrides, loadOrgCallDataContext } from "@/lib/voice/queries";
import { resolveEffectiveCallData, resolveEffectiveQuestions } from "@/lib/voice/callData";
import { formatDbError } from "@/lib/supabase/errors";

export type ScreeningCall = {
  id: string;
  organization_id: string;
  application_id: string;
  provider: string;
  status: CallStatus;
  attempt_number: number;
  provider_call_id: string | null;
  started_at: string | null;
  ended_at: string | null;
  duration_seconds: number | null;
  recording_url: string | null;
  transcript: string | null;
  language: string;
  consent_confirmed: boolean;
  consent_confirmed_at: string | null;
  failure_reason: string | null;
  created_at: string;
};

const CALL_COLUMNS =
  "id, organization_id, application_id, provider, status, attempt_number, provider_call_id, " +
  "started_at, ended_at, duration_seconds, recording_url, transcript, language, " +
  "consent_confirmed, consent_confirmed_at, failure_reason, created_at";

/** All attempts for one application, newest first. */
export async function listCallsForApplication({
  organizationId,
  applicationId,
}: {
  organizationId: string;
  applicationId: string;
}): Promise<ScreeningCall[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("screening_calls")
    .select(CALL_COLUMNS)
    .eq("organization_id", organizationId)
    .eq("application_id", applicationId)
    .order("attempt_number", { ascending: false });

  if (error) {
    console.error(`[screening] list for application failed: ${formatDbError(error)}`);
    return [];
  }
  return (data ?? []) as unknown as ScreeningCall[];
}

export type CallListRow = ScreeningCall & {
  candidate_name: string;
  job_title: string;
};

/** Organization-wide call list for /screening-calls. */
export async function listCalls({
  organizationId,
  status,
  limit = 50,
}: {
  organizationId: string;
  status?: CallStatus | null;
  limit?: number;
}): Promise<{ calls: CallListRow[]; failed: boolean }> {
  const supabase = await createClient();

  let query = supabase
    .from("screening_calls")
    .select(
      `${CALL_COLUMNS}, application:applications(id, candidate:candidates(name), job:jobs(title))`
    )
    .eq("organization_id", organizationId)
    .order("created_at", { ascending: false })
    .limit(limit);

  if (status) query = query.eq("status", status);

  const { data, error } = await query;
  if (error) {
    console.error(`[screening] list failed: ${formatDbError(error)}`);
    return { calls: [], failed: true };
  }

  const rows = (data ?? []) as unknown as (ScreeningCall & {
    application: {
      candidate: { name: string } | null;
      job: { title: string } | null;
    } | null;
  })[];

  return {
    calls: rows.map((row) => ({
      ...row,
      candidate_name: row.application?.candidate?.name ?? "Unknown candidate",
      job_title: row.application?.job?.title ?? "Unknown job",
    })),
    failed: false,
  };
}

export type StartCallResult =
  | { ok: true; callId: string }
  | { ok: false; error: string; code?: "not_connected" | "capped" | "too_soon" | "no_questions" };

/**
 * Places a screening call for an application.
 *
 * Gate order matters — each check is cheaper and safer to fail than the next,
 * and NOTHING dials until all of them pass:
 *   1. application exists in this tenant
 *   2. candidate has a phone number
 *   3. job has screening questions (no questions = nothing to ask)
 *   4. retry cap allows another attempt
 *   5. Bolna is connected
 *   6. the script passes its compliance check (inside placeCall)
 */
export async function startScreeningCall({
  organizationId,
  applicationId,
  organizationName,
  triggeredBy,
  webhookUrl,
}: {
  organizationId: string;
  applicationId: string;
  organizationName: string;
  triggeredBy: string;
  webhookUrl: string;
}): Promise<StartCallResult> {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from("applications")
    // Widened for placeholder substitution: a stage script can reference any
    // catalogued job or candidate field, so all of them have to be loaded here
    // or the token silently renders empty.
    .select(
      "id, stage, match_score, " +
        "candidate:candidates(name, phone, email, current_company, current_role, " +
        "total_experience_years, expected_salary, notice_period_days), " +
        "job:jobs(id, title, location, work_mode, experience_min, experience_max, " +
        "salary_min, salary_max, required_skills, preferred_skills, client:clients(name))"
    )
    .eq("id", applicationId)
    .eq("organization_id", organizationId)
    .maybeSingle();

  if (error || !data) return { ok: false, error: "Application not found." };

  const row = data as unknown as {
    stage: string | null;
    match_score: number | null;
    candidate:
      | ({ name: string; phone: string | null } & {
          email: string | null;
          current_company: string | null;
          current_role: string | null;
          total_experience_years: number | null;
          expected_salary: number | null;
          notice_period_days: number | null;
        })
      | null;
    job:
      | ({ id: string; title: string } & {
          location: string | null;
          work_mode: "onsite" | "remote" | "hybrid" | null;
          experience_min: number | null;
          experience_max: number | null;
          salary_min: number | null;
          salary_max: number | null;
          required_skills: string[] | null;
          preferred_skills: string[] | null;
          client: { name: string } | null;
        })
      | null;
  };

  if (!row.candidate?.phone) {
    return { ok: false, error: "This candidate has no phone number on file." };
  }
  if (!row.job) return { ok: false, error: "This application has no job attached." };

  const { data: questionRows } = await supabase
    .from("job_screening_questions")
    .select("question, display_order")
    .eq("job_id", row.job.id)
    .order("display_order", { ascending: true });

  const jobQuestions = ((questionRows ?? []) as { question: string }[]).map((q) => q.question);

  /*
    MODULE 24 — the organization's fallback question list.

    The job's own list ALWAYS wins; the org fallback is reached only by a job that
    has AI screening switched on and has not configured its questions yet. That is
    the precedence rule the Voice Agent Console states in words and
    lib/voice/callData.ts implements once, for both the preview and this call.

    Loaded before the emptiness check, because "this job has no questions" is only
    true if the organization has no fallback either — refusing a call the org
    explicitly configured a fallback for would make that setting a decoration.
  */
  const [orgContext, jobOverrides] = await Promise.all([
    loadOrgCallDataContext({ organizationId, companyName: organizationName }),
    loadJobScreeningOverrides({ organizationId, jobId: row.job.id }),
  ]);

  const resolved = resolveEffectiveQuestions({
    jobQuestions,
    fallbackQuestions: orgContext.callData.fallbackQuestions,
  });
  const questions = resolved.questions;

  if (questions.length === 0) {
    return {
      ok: false,
      code: "no_questions",
      error:
        "This job has no screening questions configured, and there are no organization defaults to fall back on. Add questions on the job, or set defaults in the voice agent console.",
    };
  }

  const bolna = await getStatus(organizationId);
  const policy: RetryPolicy = bolna.retryPolicy;

  const existing = await listCallsForApplication({ organizationId, applicationId });

  const capCheck = canPlaceFirstCall({ existingAttempts: existing.length, policy });
  if (!capCheck.ok) return { ok: false, code: "capped", error: capCheck.reason };

  // If there is a previous attempt, the retry policy governs whether another is
  // due — including refusing to re-dial someone who asked for a callback.
  const last = existing[0];
  if (last) {
    const decision = decideRetry({
      lastAttempt: {
        attemptNumber: last.attempt_number,
        status: last.status,
        endedAt: new Date(last.ended_at ?? last.created_at),
      },
      policy,
    });
    if (!decision.shouldRetry) {
      return { ok: false, code: "too_soon", error: decision.reason };
    }
  }

  if (bolna.status !== "connected") {
    return {
      ok: false,
      code: "not_connected",
      error: bolna.encryptionUnavailable
        ? "Screening calls aren't available: credential encryption isn't configured on this server."
        : "Bolna isn't connected. An Owner or Admin needs to connect it before screening calls can run.",
    };
  }

  const attemptNumber = (last?.attempt_number ?? 0) + 1;

  // Record the attempt BEFORE dialling, so a call that connects but never
  // reports back is still visible rather than invisible.
  const { data: created, error: insertError } = await supabase
    .from("screening_calls")
    .insert({
      organization_id: organizationId,
      application_id: applicationId,
      provider: "bolna",
      status: "queued",
      attempt_number: attemptNumber,
      language: "en",
      triggered_by: triggeredBy,
    })
    .select("id")
    .single();

  if (insertError || !created) {
    console.error(`[screening] creating call record failed: ${formatDbError(insertError)}`);
    return { ok: false, error: "Could not start the call." };
  }

  const callId = (created as { id: string }).id;

  // Module 3's hiring stage, if this job has AI screening switched on. The
  // prompt is rendered HERE, with this candidate's details, and never stored
  // rendered — a stored script with a name baked in would be wrong for every
  // other candidate.
  const screeningStage = await getEnabledScreeningStage({
    organizationId,
    jobId: row.job.id,
  });

  const instructions = screeningStage?.prompt_template
    ? renderTemplate(
        screeningStage.prompt_template,
        buildPlaceholderValues({
          job: { ...row.job, client_name: row.job.client?.name ?? null },
          candidate: row.candidate,
          application: { stage: row.stage, match_score: row.match_score },
        })
      )
    : null;

  const script = buildCallScript({
    candidateName: row.candidate.name,
    jobTitle: row.job.title,
    organizationName,
    questions,
    instructions,
  });

  /*
    The flat key/value context the agent is given — company name, sign-off name,
    and anything else the organization configured — with the job's own settings
    already taking priority. Omitted entirely when the job could not be read, so a
    failure to load overrides can never silently apply an org default in place of
    a job's own value.
  */
  const callContext = jobOverrides
    ? resolveEffectiveCallData({ org: orgContext, job: jobOverrides })
    : undefined;

  const result = await placeCall({
    organizationId,
    screeningCallId: callId,
    phoneNumber: row.candidate.phone,
    script,
    webhookUrl,
    callContext,
  });

  if (!result.ok) {
    // The spec's test: a Bolna failure must not crash the application record.
    // The attempt is marked failed and stays visible.
    await supabase
      .from("screening_calls")
      .update({
        status: "failed",
        failure_reason: result.error,
        ended_at: new Date().toISOString(),
      })
      .eq("id", callId)
      .eq("organization_id", organizationId);

    return { ok: false, error: result.error };
  }

  await supabase
    .from("screening_calls")
    .update({
      status: "dialing",
      provider_call_id: result.data.providerCallId,
      started_at: new Date().toISOString(),
    })
    .eq("id", callId)
    .eq("organization_id", organizationId);

  return { ok: true, callId };
}
