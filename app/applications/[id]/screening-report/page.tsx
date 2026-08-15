import Link from "next/link";
import { notFound } from "next/navigation";
import { AppShell } from "@/components/AppShell";
import { requireMembershipOrRedirect, hasRole } from "@/lib/tenant";
import { getApplicationDetail } from "@/lib/applications/queries";
import { listCallsForApplication } from "@/lib/screening/queries";
import { getReportForApplication } from "@/lib/screening/reportQueries";
import { checkReportEligibility, isPendingReview } from "@/lib/screening/report";
import { GenerateReportButton, ReportEditor } from "./ReportEditor";

export const metadata = { title: "Screening report" };
export const dynamic = "force-dynamic";

export default async function ScreeningReportPage({
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

  const canReview = hasRole(membership.role, ["owner", "admin", "recruiter"]);

  const [report, calls] = await Promise.all([
    getReportForApplication({
      organizationId: membership.organization.id,
      applicationId: id,
    }),
    listCallsForApplication({
      organizationId: membership.organization.id,
      applicationId: id,
    }),
  ]);

  const latestCall = calls[0];
  const eligibility = latestCall
    ? checkReportEligibility({
        status: latestCall.status,
        transcript: latestCall.transcript,
        consentConfirmed: latestCall.consent_confirmed,
      })
    : null;

  return (
    <AppShell>
      <div className="mb-5">
        <p className="has-text-secondary mb-1" style={{ fontSize: 13 }}>
          <Link href="/applications">Applications</Link> /{" "}
          <Link href={`/applications/${application.id}`}>{application.candidate_name}</Link> /
          Screening report
        </p>
        <div className="is-flex is-align-items-center" style={{ gap: "0.75rem" }}>
          <h1 className="title is-4 mb-0">Screening report</h1>
          {report && isPendingReview(report) && (
            <span
              className="tag"
              style={{
                background: "var(--status-attention-bg)",
                color: "var(--status-attention-text)",
                fontSize: 12,
                fontWeight: 600,
              }}
            >
              Pending review
            </span>
          )}
          {report && !isPendingReview(report) && (
            <span
              className="tag"
              style={{
                background: "var(--status-connected-bg)",
                color: "var(--status-connected-text)",
                fontSize: 12,
                fontWeight: 600,
              }}
            >
              Reviewed
            </span>
          )}
        </div>
        <p className="has-text-secondary mt-1" style={{ fontSize: 13 }}>
          {application.candidate_name} for {application.job_title}
        </p>
      </div>

      {!report && (
        <div className="card mb-4">
          <h2 className="title is-5">No report yet</h2>

          {!latestCall && (
            <>
              <p style={{ fontSize: 14 }}>
                No screening call has been made for this application yet.
              </p>
              <Link
                className="button is-primary mt-3"
                href={`/applications/${application.id}/screening-call`}
              >
                Go to screening calls
              </Link>
            </>
          )}

          {latestCall && eligibility && !eligibility.eligible && (
            <>
              {/* The consent case is stated plainly rather than as a generic
                  failure — it is the reason that matters, and it is not a bug. */}
              <p
                style={{
                  fontSize: 14,
                  color:
                    eligibility.code === "no_consent"
                      ? "var(--color-error)"
                      : "var(--status-attention-text)",
                }}
              >
                {eligibility.reason}
              </p>
              <Link
                className="button mt-3"
                href={`/applications/${application.id}/screening-call`}
              >
                View call attempts
              </Link>
            </>
          )}

          {latestCall && eligibility?.eligible && (
            <>
              <p className="mb-3" style={{ fontSize: 14 }}>
                The last call completed with a transcript. Generate the report to turn it into a
                summary and structured answers.
              </p>
              {canReview ? (
                <GenerateReportButton
                  applicationId={application.id}
                  label="Generate report"
                />
              ) : (
                <p className="has-text-secondary" style={{ fontSize: 13 }}>
                  Ask a recruiter to generate it.
                </p>
              )}
            </>
          )}
        </div>
      )}

      {report && (
        <>
          <div className="ai-panel mb-4">
            <p style={{ fontSize: 13, fontWeight: 600, color: "var(--color-info)" }}>
              AI extracted, human verifies
            </p>
            <p className="mt-2" style={{ fontSize: 14 }}>
              {isPendingReview(report)
                ? "These answers were read from the call transcript by AI and have not been checked yet. Correct anything wrong, then mark it reviewed — the pipeline and analytics use the reviewed version."
                : `Reviewed${report.reviewer_name ? ` by ${report.reviewer_name}` : ""}. Corrections are kept alongside what AI originally said.`}
            </p>
            {report.uncertain_fields.length > 0 && (
              <p className="mt-2" style={{ fontSize: 13, color: "var(--status-attention-text)" }}>
                The AI flagged {report.uncertain_fields.length} field
                {report.uncertain_fields.length === 1 ? "" : "s"} it wasn&apos;t sure about — check
                those first.
              </p>
            )}
          </div>

          <ReportEditor report={report} canReview={canReview} />

          {latestCall?.transcript && (
            <div className="card mt-4">
              <h2 className="title is-5">Call transcript</h2>
              <p className="has-text-secondary mb-3" style={{ fontSize: 12 }}>
                The source for everything above. Check anything that matters against it.
              </p>
              <p style={{ fontSize: 13, whiteSpace: "pre-wrap" }}>{latestCall.transcript}</p>
            </div>
          )}

          {canReview && (
            <div className="card mt-4">
              <h2 className="title is-5">Regenerate</h2>
              <p className="has-text-secondary mb-3" style={{ fontSize: 13 }}>
                Runs the extraction again from the same transcript. This replaces the current
                report, including any corrections.
              </p>
              <GenerateReportButton
                applicationId={application.id}
                label="Regenerate from transcript"
              />
            </div>
          )}
        </>
      )}
    </AppShell>
  );
}
