// Screening report persistence and the generate orchestration.
import { createClient } from "@/lib/supabase/server";
import { generateScreeningSummary } from "@/lib/ai/generateScreeningSummary";
import { checkReportEligibility, extractionToReportValues } from "@/lib/screening/report";
import type { InterestLevel, LocationAcceptance } from "@/lib/ai/generateScreeningSummary";
import { describeDbError } from "@/lib/supabase/errors";

export type ScreeningReport = {
  id: string;
  organization_id: string;
  screening_call_id: string;
  application_id: string;
  summary_text: string;
  interest_level: InterestLevel;
  expected_ctc: number | null;
  notice_period_days: number | null;
  location_accepted: LocationAcceptance;
  availability_notes: string | null;
  ai_summary_text: string;
  ai_interest_level: InterestLevel;
  ai_expected_ctc: number | null;
  ai_notice_period_days: number | null;
  ai_location_accepted: LocationAcceptance;
  ai_availability_notes: string | null;
  uncertain_fields: string[];
  corrected_fields: string[];
  reviewed_by: string | null;
  reviewed_at: string | null;
  created_at: string;
  reviewer_name?: string | null;
};

const REPORT_COLUMNS =
  "id, organization_id, screening_call_id, application_id, summary_text, interest_level, " +
  "expected_ctc, notice_period_days, location_accepted, availability_notes, " +
  "ai_summary_text, ai_interest_level, ai_expected_ctc, ai_notice_period_days, " +
  "ai_location_accepted, ai_availability_notes, uncertain_fields, corrected_fields, " +
  "reviewed_by, reviewed_at, created_at";

/** The report for an application, if one exists. */
export async function getReportForApplication({
  organizationId,
  applicationId,
}: {
  organizationId: string;
  applicationId: string;
}): Promise<ScreeningReport | null> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("screening_reports")
    .select(`${REPORT_COLUMNS}, reviewer:users!screening_reports_reviewed_by_fkey(name, email)`)
    .eq("organization_id", organizationId)
    .eq("application_id", applicationId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error || !data) return null;

  const row = data as unknown as ScreeningReport & {
    reviewer: { name: string | null; email: string } | null;
  };

  return {
    ...row,
    reviewer_name: row.reviewer ? row.reviewer.name ?? row.reviewer.email : null,
  };
}

export async function getReport({
  organizationId,
  reportId,
}: {
  organizationId: string;
  reportId: string;
}): Promise<ScreeningReport | null> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("screening_reports")
    .select(REPORT_COLUMNS)
    .eq("organization_id", organizationId)
    .eq("id", reportId)
    .maybeSingle();

  if (error || !data) return null;
  return data as unknown as ScreeningReport;
}

export type GenerateResult =
  | { ok: true; reportId: string }
  | { ok: false; error: string; code?: string };

/**
 * Generates the report for an application's most recent completed call.
 *
 * Eligibility — consent first — is checked here for a readable message, and
 * again by a database trigger so it holds for any writer.
 */
export async function generateReportForApplication({
  organizationId,
  applicationId,
}: {
  organizationId: string;
  applicationId: string;
}): Promise<GenerateResult> {
  const supabase = await createClient();

  // The most recent call, whatever its outcome — so an ineligible one can
  // explain itself rather than looking like "no calls yet".
  const { data: callRow } = await supabase
    .from("screening_calls")
    .select("id, status, transcript, consent_confirmed")
    .eq("organization_id", organizationId)
    .eq("application_id", applicationId)
    .order("attempt_number", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (!callRow) {
    return { ok: false, code: "no_call", error: "No screening call has been made yet." };
  }

  const call = callRow as unknown as {
    id: string;
    status: string;
    transcript: string | null;
    consent_confirmed: boolean;
  };

  const eligibility = checkReportEligibility({
    status: call.status,
    transcript: call.transcript,
    consentConfirmed: call.consent_confirmed,
  });

  if (!eligibility.eligible) {
    return { ok: false, code: eligibility.code, error: eligibility.reason };
  }

  const { data: applicationRow } = await supabase
    .from("applications")
    .select("candidate:candidates(name), job:jobs(id, title)")
    .eq("id", applicationId)
    .eq("organization_id", organizationId)
    .maybeSingle();

  const context = applicationRow as unknown as {
    candidate: { name: string } | null;
    job: { id: string; title: string } | null;
  } | null;

  const { data: questionRows } = context?.job
    ? await supabase
        .from("job_screening_questions")
        .select("question, display_order")
        .eq("job_id", context.job.id)
        .order("display_order", { ascending: true })
    : { data: [] };

  const result = await generateScreeningSummary({
    transcript: call.transcript!,
    candidateName: context?.candidate?.name ?? "the candidate",
    jobTitle: context?.job?.title ?? "the role",
    questions: ((questionRows ?? []) as { question: string }[]).map((row) => row.question),
  });

  if (!result.ok) {
    return { ok: false, code: result.code, error: result.message };
  }

  const values = extractionToReportValues(result.data);

  // Current values and the AI original are written identically at creation.
  // From here the AI columns never change, so any later divergence is a human's.
  const { data: created, error } = await supabase
    .from("screening_reports")
    .upsert(
      {
        organization_id: organizationId,
        screening_call_id: call.id,
        application_id: applicationId,
        ...values,
        ai_summary_text: values.summary_text,
        ai_interest_level: values.interest_level,
        ai_expected_ctc: values.expected_ctc,
        ai_notice_period_days: values.notice_period_days,
        ai_location_accepted: values.location_accepted,
        ai_availability_notes: values.availability_notes,
        uncertain_fields: result.data.uncertainFields,
        corrected_fields: [],
        reviewed_by: null,
        reviewed_at: null,
      },
      { onConflict: "screening_call_id" }
    )
    .select("id")
    .single();

  if (error || !created) {
    // The trigger's consent message is worth surfacing verbatim.
    if (error?.message?.includes("no recorded consent")) {
      return {
        ok: false,
        code: "no_consent",
        error: "This call has no recorded consent, so its transcript cannot be summarised.",
      };
    }
    console.error("[screening] storing report failed:", describeDbError(error));
    return { ok: false, error: "Could not save the screening report." };
  }

  // Module 14: logged by the CALLER, not here.
  //
  // This function has no actor — it is reached both from the route (a named
  // recruiter) and from a Module 13 automation (no user at all). Logging here
  // would have to invent one or leave it null, and neither is right in both
  // cases. app/api/applications/[id]/screening-report/route.ts records the
  // generation and the AI call with the real actor.
  return { ok: true, reportId: (created as { id: string }).id };
}
