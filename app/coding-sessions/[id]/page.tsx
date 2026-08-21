// =============================================================================
// The interviewer's view of one coding round.
//
// ONE PAGE, NOT TWO. "Open live monitor" and "View coding submission" are the
// same screen at two moments in its life — the code, the question, and who it
// belongs to. Splitting them would mean two places rendering one thing, and the
// second would drift the first time the shape changed.
//
// It follows the app shell, so an interviewer arriving from a notification lands
// somewhere they recognise with the nav they expect.
// =============================================================================
import Link from "next/link";
import { notFound } from "next/navigation";
import { AppShell } from "@/components/AppShell";
import { hasRole, requireMembershipOrRedirect } from "@/lib/tenant";
import { getSessionDetail } from "@/lib/coding/queries";
import { describeLastSaved } from "@/lib/coding/session";
import { LiveMonitor, type MonitorSnapshot } from "./LiveMonitor";

export const metadata = { title: "Coding round" };
export const dynamic = "force-dynamic";

export default async function CodingSessionPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const membership = await requireMembershipOrRedirect();

  const detail = await getSessionDetail({
    organizationId: membership.organization.id,
    sessionId: id,
  });
  // Another organization's session is indistinguishable from one that does not
  // exist — the same rule every [id] route in this product follows.
  if (!detail) notFound();

  // Cancelling is the same class of act as starting the round, so it takes the
  // same roles. A Viewer reads.
  const canCancel = hasRole(membership.role, ["owner", "admin", "recruiter"]);

  const snapshot: MonitorSnapshot = {
    id: detail.id,
    status: detail.status,
    candidate_name: detail.candidate_name,
    job_title: detail.job_title,
    language: detail.submission?.programming_language ?? null,
    code: detail.submission?.code ?? null,
    last_saved_at: detail.submission?.last_saved_at ?? null,
    last_saved_label: describeLastSaved(detail.submission?.last_saved_at ?? null),
    save_count: detail.submission?.save_count ?? 0,
    submitted_at: detail.submitted_at,
    cancelled_reason: detail.cancelled_reason,
  };

  return (
    <AppShell>
      <div className="mb-5">
        <p className="has-text-secondary mb-1" style={{ fontSize: 13 }}>
          <Link href="/interviews">Interviews</Link> /{" "}
          <Link href={`/interviews/${detail.interview_id}`}>{detail.candidate_name}</Link> / Coding
          round
        </p>
        <h1 className="title is-4 mb-1">{detail.question_title}</h1>
        <p className="has-text-secondary" style={{ fontSize: 13 }}>
          {detail.job_title}
          {detail.interviewer_name ? ` · ${detail.interviewer_name}` : ""}
          {detail.time_limit_minutes ? ` · ${detail.time_limit_minutes} minute limit` : ""}
        </p>
      </div>

      <div className="columns">
        <div className="column is-two-thirds">
          <LiveMonitor initial={snapshot} canCancel={canCancel} />
        </div>

        <div className="column">
          <div className="card mb-4">
            <h2 className="title is-6 mb-2">Question</h2>
            <p className="coding-question__body">{detail.question_description}</p>

            {detail.instructions && (
              <>
                <h3 className="label mt-4" style={{ marginBottom: "var(--space-1)" }}>
                  Instructions
                </h3>
                <p className="coding-question__body">{detail.instructions}</p>
              </>
            )}
          </div>

          <div className="card">
            <h2 className="title is-6 mb-2">Round</h2>
            <dl style={{ fontSize: 14 }}>
              <Detail
                label="Started"
                value={new Date(detail.created_at).toLocaleString("en-GB", {
                  day: "numeric",
                  month: "short",
                  hour: "2-digit",
                  minute: "2-digit",
                })}
              />
              <Detail
                label="Candidate opened"
                value={
                  detail.opened_at
                    ? new Date(detail.opened_at).toLocaleString("en-GB", {
                        day: "numeric",
                        month: "short",
                        hour: "2-digit",
                        minute: "2-digit",
                      })
                    : "Not yet"
                }
              />
              <Detail
                label="Link expires"
                value={new Date(detail.expires_at).toLocaleString("en-GB", {
                  day: "numeric",
                  month: "short",
                  hour: "2-digit",
                  minute: "2-digit",
                })}
              />
            </dl>

            <Link
              className="button is-small is-fullwidth mt-2"
              href={`/applications/${detail.application_id}`}
            >
              Open the application
            </Link>
          </div>
        </div>
      </div>
    </AppShell>
  );
}

function Detail({ label, value }: { label: string; value: string }) {
  return (
    <div className="mb-3">
      <dt className="has-text-secondary" style={{ fontSize: 12 }}>
        {label}
      </dt>
      <dd>{value}</dd>
    </div>
  );
}
