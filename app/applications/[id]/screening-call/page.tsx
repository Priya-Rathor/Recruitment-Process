import Link from "next/link";
import { notFound } from "next/navigation";
import { AppShell } from "@/components/AppShell";
import { EmptyState } from "@/components/states";
import { requireMembershipOrRedirect, hasRole } from "@/lib/tenant";
import { createClient } from "@/lib/supabase/server";
import { getApplicationDetail } from "@/lib/applications/queries";
import { listCallsForApplication } from "@/lib/screening/queries";
import { getStatus } from "@/lib/integrations/bolna";
import { buildConsentDisclosure } from "@/lib/screening/script";
import { CallStatusBadge, ConsentBadge } from "@/app/screening-calls/CallStatusBadge";
import { StartCallPanel } from "./StartCallPanel";

export const metadata = { title: "Screening call · Recruitment OS" };
export const dynamic = "force-dynamic";

export default async function ScreeningCallPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const membership = await requireMembershipOrRedirect();

  const application = await getApplicationDetail({
    organizationId: membership.organization.id,
    applicationId: id,
  });
  if (!application) notFound();

  const canStart = hasRole(membership.role, ["owner", "admin", "recruiter"]);

  const supabase = await createClient();
  const [{ data: candidateRow }, calls, bolna, { data: questionRows }] = await Promise.all([
    supabase
      .from("candidates")
      .select("name, phone")
      .eq("id", application.candidate_id)
      .eq("organization_id", membership.organization.id)
      .maybeSingle(),
    listCallsForApplication({
      organizationId: membership.organization.id,
      applicationId: id,
    }),
    getStatus(membership.organization.id),
    supabase
      .from("job_screening_questions")
      .select("question, display_order")
      .eq("job_id", application.job_id)
      .order("display_order", { ascending: true }),
  ]);

  const candidate = candidateRow as { name: string; phone: string | null } | null;
  const questions = ((questionRows ?? []) as { question: string }[]).map((row) => row.question);

  const notConnected = bolna.status !== "connected";
  const noQuestions = questions.length === 0;

  const blockedReason = notConnected
    ? bolna.encryptionUnavailable
      ? "Screening calls aren't available: credential encryption isn't configured on this server."
      : "Bolna isn't connected. An Owner or Admin needs to connect it first."
    : noQuestions
      ? "This job has no screening questions configured, so there's nothing to ask."
      : null;

  return (
    <AppShell>
      <div className="mb-5">
        <p className="has-text-secondary mb-1" style={{ fontSize: 13 }}>
          <Link href="/applications">Applications</Link> /{" "}
          <Link href={`/applications/${application.id}`}>{application.candidate_name}</Link> /
          Screening call
        </p>
        <h1 className="title is-4 mb-1">AI screening call</h1>
        <p className="has-text-secondary" style={{ fontSize: 13 }}>
          {application.candidate_name} for {application.job_title}
        </p>
      </div>

      {/* Integration state is stated plainly rather than shown as a broken
          button, so the fix is obvious. */}
      {notConnected && (
        <div className="card mb-4" style={{ borderColor: "var(--color-warning)" }}>
          <h2 className="title is-5" style={{ color: "var(--status-attention-text)" }}>
            Bolna isn&apos;t connected
          </h2>
          <p style={{ fontSize: 14 }}>{blockedReason}</p>
          <p className="has-text-secondary mt-2" style={{ fontSize: 12 }}>
            Full connection management arrives with Settings (Module 17).
          </p>
        </div>
      )}

      {noQuestions && !notConnected && (
        <div className="card mb-4" style={{ borderColor: "var(--color-warning)" }}>
          <h2 className="title is-5" style={{ color: "var(--status-attention-text)" }}>
            No screening questions
          </h2>
          <p style={{ fontSize: 14 }}>
            This job has none configured, so there is nothing to ask.{" "}
            <Link href={`/jobs/${application.job_id}/edit`}>Add some on the job</Link>.
          </p>
        </div>
      )}

      <div className="card mb-4">
        <h2 className="title is-5">Start a call</h2>
        <StartCallPanel
          applicationId={application.id}
          candidateName={candidate?.name ?? application.candidate_name}
          candidatePhone={candidate?.phone ?? null}
          canStart={canStart && !notConnected && !noQuestions}
          blockedReason={
            blockedReason ?? (canStart ? null : "Your role can view screening calls but not start them.")
          }
        />
      </div>

      {/* The disclosure is shown verbatim: a recruiter is accountable for what
          the product says on their behalf, so they should be able to read it. */}
      <div className="card mb-4">
        <h2 className="title is-5">What the candidate hears first</h2>
        <p
          style={{
            fontSize: 14,
            fontStyle: "italic",
            background: "var(--color-background)",
            padding: "1rem",
            borderRadius: "8px",
          }}
        >
          {buildConsentDisclosure({
            candidateName: candidate?.name ?? application.candidate_name,
            organizationName: membership.organization.name,
            jobTitle: application.job_title,
          })}
        </p>
        <p className="has-text-secondary mt-2" style={{ fontSize: 12 }}>
          This opening is required on every call and cannot be edited or skipped. Recording someone
          without telling them is unlawful in many places.
        </p>

        {questions.length > 0 && (
          <div className="mt-4">
            <p style={{ fontSize: 13, fontWeight: 600 }}>Then it asks</p>
            <ol style={{ fontSize: 14, listStyle: "decimal", paddingLeft: "1.25rem" }}>
              {questions.map((question) => (
                <li key={question} className="py-1">
                  {question}
                </li>
              ))}
            </ol>
          </div>
        )}
      </div>

      <div className="card">
        <h2 className="title is-5">Attempts</h2>
        <p className="has-text-secondary mb-3" style={{ fontSize: 13 }}>
          Up to {bolna.retryPolicy.maxAttempts} attempts, at least{" "}
          {bolna.retryPolicy.delayMinutes} minutes apart.
        </p>

        {calls.length === 0 ? (
          <EmptyState message="No screening calls have been attempted for this application." />
        ) : (
          <ul>
            {calls.map((call) => (
              <li
                key={call.id}
                className="py-3"
                style={{ borderTop: "1px solid var(--color-border)" }}
              >
                <div className="is-flex is-justify-content-space-between is-align-items-center">
                  <div>
                    <p style={{ fontSize: 14, fontWeight: 600 }}>
                      Attempt {call.attempt_number}
                    </p>
                    <p className="has-text-secondary" style={{ fontSize: 12 }}>
                      {new Date(call.created_at).toLocaleString("en-GB", {
                        day: "numeric",
                        month: "short",
                        hour: "2-digit",
                        minute: "2-digit",
                      })}
                      {call.duration_seconds !== null && ` · ${call.duration_seconds}s`}
                    </p>
                  </div>
                  <div className="is-flex is-align-items-center" style={{ gap: "0.5rem" }}>
                    <ConsentBadge confirmed={call.consent_confirmed} />
                    <CallStatusBadge status={call.status} />
                  </div>
                </div>

                {call.failure_reason && (
                  <p className="mt-2" style={{ fontSize: 13, color: "var(--color-error)" }}>
                    {call.failure_reason}
                  </p>
                )}

                {call.transcript && (
                  <details className="mt-2">
                    <summary style={{ fontSize: 13, cursor: "pointer" }}>Transcript</summary>
                    <p
                      className="mt-2"
                      style={{ fontSize: 13, whiteSpace: "pre-wrap" }}
                    >
                      {call.transcript}
                    </p>
                    {!call.consent_confirmed && (
                      <p className="mt-2" style={{ fontSize: 12, color: "var(--color-error)" }}>
                        No consent was recorded on this call, so this transcript must not be used
                        for screening decisions.
                      </p>
                    )}
                  </details>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
    </AppShell>
  );
}
