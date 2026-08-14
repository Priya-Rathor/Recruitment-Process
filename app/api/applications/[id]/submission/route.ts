import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { handleRouteError, jsonError } from "@/lib/api";
import { requireCurrentUser, requireMembership, requireRole } from "@/lib/tenant";
import { getApplicationDetail } from "@/lib/applications/queries";
import { getMatch } from "@/lib/matching/queries";
import { getReportForApplication } from "@/lib/screening/reportQueries";
import { getSubmissionForApplication } from "@/lib/clients/queries";
import { generateClientSubmission } from "@/lib/ai/generateClientSubmission";

export const maxDuration = 60;

/** GET — the existing submission for this application, if any. */
export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const membership = await requireMembership();

    const submission = await getSubmissionForApplication({
      organizationId: membership.organization.id,
      applicationId: id,
    });

    return NextResponse.json({ data: submission, caller_role: membership.role });
  } catch (error) {
    return handleRouteError(error);
  }
}

/**
 * POST — DRAFT a submission summary.
 *
 * This endpoint only ever returns text. It writes nothing and sends nothing:
 * the spec's test is "sending a submission requires an explicit recruiter
 * action, never automatic", so drafting and sending are deliberately separate
 * endpoints. There is no code path from generating a draft to a client seeing it.
 *
 * Facts are gathered server-side, so the draft cannot be steered by the caller.
 */
export async function POST(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const membership = await requireRole(["owner", "admin", "recruiter"]);

    const application = await getApplicationDetail({
      organizationId: membership.organization.id,
      applicationId: id,
    });
    if (!application) return jsonError("Application not found.", 404);

    const supabase = await createClient();

    const [candidateRow, jobRow, match, report] = await Promise.all([
      supabase
        .from("candidates")
        .select("current_role, current_company, total_experience_years, skills, location, expected_salary, notice_period_days")
        .eq("id", application.candidate_id)
        .eq("organization_id", membership.organization.id)
        .maybeSingle(),
      supabase
        .from("jobs")
        .select("work_mode, client_id, client:clients(name)")
        .eq("id", application.job_id)
        .eq("organization_id", membership.organization.id)
        .maybeSingle(),
      getMatch({ organizationId: membership.organization.id, applicationId: id }),
      getReportForApplication({ organizationId: membership.organization.id, applicationId: id }),
    ]);

    const candidate = candidateRow.data as unknown as {
      current_role: string | null;
      current_company: string | null;
      total_experience_years: number | null;
      skills: string[] | null;
      location: string | null;
      expected_salary: number | null;
      notice_period_days: number | null;
    } | null;

    const job = jobRow.data as unknown as {
      work_mode: string | null;
      client_id: string | null;
      client: { name: string } | null;
    } | null;

    if (!job?.client_id) {
      return NextResponse.json(
        {
          error:
            "This job has no client attached, so there's nobody to submit to. Set a client on the job first.",
          code: "no_client",
        },
        { status: 409 }
      );
    }

    // Only a REVIEWED report is authoritative enough to quote to a client.
    const reviewed = report?.reviewed_at ? report : null;

    const result = await generateClientSubmission({
      candidateName: application.candidate_name,
      jobTitle: application.job_title,
      clientName: job.client?.name ?? "the client",
      currentRole: candidate?.current_role ?? null,
      currentCompany: candidate?.current_company ?? null,
      totalExperienceYears: candidate?.total_experience_years ?? null,
      skills: candidate?.skills ?? [],
      location: candidate?.location ?? null,
      workMode: job.work_mode,
      // Prefer the reviewed screening figures over the profile's, since a human
      // confirmed them against what the candidate actually said.
      expectedSalary: reviewed?.expected_ctc ?? candidate?.expected_salary ?? null,
      noticePeriodDays: reviewed?.notice_period_days ?? candidate?.notice_period_days ?? null,
      screeningSummary: reviewed?.summary_text ?? null,
      strengths: (match?.strong_matches ?? []).map((finding) => finding.detail),
    });

    if (!result.ok) {
      const status = result.code === "invalid_output" ? 422 : 503;
      return NextResponse.json({ error: result.message, code: result.code }, { status });
    }

    // TODO(Module 14): log this AI call at summary level to activity_events.
    return NextResponse.json({
      data: result.data,
      clientId: job.client_id,
      clientName: job.client?.name ?? null,
      // Explicit: a draft. Nothing was written and nobody was contacted.
      saved: false,
      sent: false,
    });
  } catch (error) {
    return handleRouteError(error);
  }
}

/**
 * PUT — SEND the submission. The explicit human action.
 *
 * Records what was actually sent, verbatim, and opens the feedback clock. The
 * text comes from the request body precisely BECAUSE the recruiter may have
 * edited the draft — what gets recorded must be what they approved, not what
 * the model would generate today.
 *
 * Actual delivery (email) is Module 15. Until then this records the submission
 * and starts the SLA, which is what the turnaround tracking measures.
 */
export async function PUT(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const [membership, user] = await Promise.all([
      requireRole(["owner", "admin", "recruiter"]),
      requireCurrentUser(),
    ]);

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return jsonError("Invalid JSON body.", 400);
    }

    const raw = (body ?? {}) as Record<string, unknown>;
    const submissionText = typeof raw.submission_text === "string" ? raw.submission_text.trim() : "";

    if (submissionText.length === 0) {
      return jsonError("There's nothing to send — write or generate a summary first.", 400);
    }

    const supabase = await createClient();

    const { data: jobRow } = await supabase
      .from("applications")
      .select("job_id, job:jobs(client_id)")
      .eq("id", id)
      .eq("organization_id", membership.organization.id)
      .maybeSingle();

    const clientId = (jobRow as unknown as { job: { client_id: string | null } | null } | null)
      ?.job?.client_id;

    if (!clientId) {
      return jsonError("This job has no client attached, so there's nobody to submit to.", 409);
    }

    const { data, error } = await supabase
      .from("client_feedback_events")
      .insert({
        organization_id: membership.organization.id,
        client_id: clientId,
        application_id: id,
        requested_at: new Date().toISOString(),
        submission_text: submissionText.slice(0, 5000),
        submitted_by: user.id,
      })
      .select("id, requested_at")
      .single();

    if (error) {
      console.error("[api] submission send failed:", error);
      return jsonError("Could not record that submission.", 400);
    }

    // TODO(Module 15): actually deliver the message.
    // TODO(Module 14): log the submission to activity_events.
    return NextResponse.json({ data, sent: true }, { status: 201 });
  } catch (error) {
    return handleRouteError(error);
  }
}
