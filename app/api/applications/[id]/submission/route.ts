import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { handleRouteError, jsonError } from "@/lib/api";
import { requireCurrentUser, requireMembership, requireRole } from "@/lib/tenant";
import { getApplicationDetail } from "@/lib/applications/queries";
import { getMatch } from "@/lib/matching/queries";
import { getReportForApplication } from "@/lib/screening/reportQueries";
import { getSubmissionForApplication } from "@/lib/clients/queries";
import { generateClientSubmission } from "@/lib/ai/generateClientSubmission";
import { logActivity, logAiCall } from "@/lib/activity/log";
import { notify } from "@/lib/notifications/notify";
import { formatDbError } from "@/lib/supabase/errors";

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
    const [membership, user] = await Promise.all([
      requireRole(["owner", "admin", "recruiter"]),
      requireCurrentUser(),
    ]);

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

    // Module 14 (section 10). Summary level only — the drafted submission text
    // describes a real person to a third party and is stored once, on send.
    await logAiCall({
      organizationId: membership.organization.id,
      actorId: user.id,
      actorLabel: user.name ?? user.email,
      feature: "generateClientSubmission",
      entityId: id,
      ok: true,
    });

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
      // The client NAME is fetched too, so the activity timeline can read
      // "Submitted to ABC Tech" rather than a UUID a human can't act on.
      .select("job_id, candidate:candidates(name), job:jobs(client_id, client:clients(name))")
      .eq("id", id)
      .eq("organization_id", membership.organization.id)
      .maybeSingle();

    const submissionRow = jobRow as unknown as {
      candidate: { name: string } | null;
      job: { client_id: string | null; client: { name: string } | null } | null;
    } | null;
    const jobClient = submissionRow?.job;
    const clientId = jobClient?.client_id;
    const sentToClientName = jobClient?.client?.name ?? null;
    const submittedCandidateName = submissionRow?.candidate?.name ?? null;

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
      console.error(`[api] submission send failed: ${formatDbError(error)}`);
      return jsonError("Could not record that submission.", 400);
    }

    // MODULE 15 RETROFIT.
    //
    // What this does NOT do is email the client the submission. That is a
    // deliberate stop, not an omission: a submission describes a real person to
    // a third party in our customer's name, and Module 12 built two explicit
    // steps precisely so a human approves the wording. Auto-emailing it here
    // would undo that. Sending to the client needs its own approved external
    // template and a confirmation naming the recipient — a Module 17 job, once
    // the email integration has a verified From address per organization.
    //
    // What it does do is confirm to the sender that the clock has started.
    await notify({
      organizationId: membership.organization.id,
      userId: user.id,
      type: "candidate_submitted",
      values: {
        candidate_name: submittedCandidateName,
        client_name: sentToClientName,
      },
      linkPath: `/applications/${id}`,
    });


    // Module 14. Recorded against the APPLICATION, not the client, because this
    // is the candidate's story: "was submitted to ABC Tech" is a line in their
    // narrative. The submission text itself lives in client_feedback_events and
    // is not duplicated here.
    await logActivity({
      organizationId: membership.organization.id,
      entityType: "application",
      entityId: id,
      eventType: "client.submission_sent",
      actorId: user.id,
      actorLabel: user.name ?? user.email,
      metadata: { client_id: clientId, client_name: sentToClientName },
    });

    return NextResponse.json({ data, sent: true }, { status: 201 });
  } catch (error) {
    return handleRouteError(error);
  }
}
