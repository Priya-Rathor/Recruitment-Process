import { Suspense } from "react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { AppShell } from "@/components/AppShell";
import { SkeletonRows } from "@/components/states";
import { requireMembershipOrRedirect, hasRole } from "@/lib/tenant";
import { getCandidate, getCandidateDuplicates } from "@/lib/candidates/queries";
import { CANDIDATE_SOURCE_LABELS } from "@/lib/types";
import { CandidateForm } from "../CandidateForm";
import { ArchiveCandidateButton } from "./CandidateActions";

export const metadata = { title: "Candidate · Recruitment OS" };
export const dynamic = "force-dynamic";

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div className="column is-one-third">
      <p className="has-text-secondary" style={{ fontSize: 12 }}>
        {label}
      </p>
      <p style={{ fontSize: 15 }}>{value}</p>
    </div>
  );
}

async function CandidateDetailContent({
  candidateId,
  editing,
}: {
  candidateId: string;
  editing: boolean;
}) {
  const membership = await requireMembershipOrRedirect();

  const candidate = await getCandidate({
    organizationId: membership.organization.id,
    candidateId,
  });
  // Another organization's record resolves to null, so a guessed id is
  // indistinguishable from a genuinely missing one.
  if (!candidate) notFound();

  const canEdit = hasRole(membership.role, ["owner", "admin", "recruiter"]);
  const canArchive = hasRole(membership.role, ["owner", "admin"]);
  const duplicates = await getCandidateDuplicates({
    organizationId: membership.organization.id,
    candidateId,
  });

  // Edit mode is a query param rather than a separate route: the spec lists
  // only /candidates/[id], and editing in place keeps the duplicate context
  // visible while the recruiter works.
  if (editing && canEdit) {
    return (
      <>
        <div className="mb-5">
          <p className="has-text-secondary mb-1" style={{ fontSize: 13 }}>
            <Link href="/candidates">Candidates</Link> /{" "}
            <Link href={`/candidates/${candidate.id}`}>{candidate.name}</Link> / Edit
          </p>
          <h1 className="title is-4">Edit candidate</h1>
        </div>
        <CandidateForm mode="edit" candidate={candidate} />
      </>
    );
  }

  return (
    <>
      <div className="is-flex is-justify-content-space-between is-align-items-flex-start mb-5">
        <div>
          <p className="has-text-secondary mb-1" style={{ fontSize: 13 }}>
            <Link href="/candidates">Candidates</Link> / {candidate.name}
          </p>
          <h1 className="title is-4 mb-2">{candidate.name}</h1>
          <div className="is-flex" style={{ gap: "0.5rem" }}>
            <span className="tag is-light" style={{ fontSize: 12 }}>
              {CANDIDATE_SOURCE_LABELS[candidate.source]}
            </span>
            {candidate.archived_at && (
              <span className="tag is-light" style={{ fontSize: 12 }}>
                Archived
              </span>
            )}
          </div>
        </div>

        {canEdit && !candidate.archived_at && (
          <Link className="button is-primary" href={`/candidates/${candidate.id}?edit=1`}>
            Edit
          </Link>
        )}
      </div>

      {duplicates.length > 0 && (
        <div className="card mb-4" style={{ borderColor: "var(--color-warning)" }}>
          <h2 className="title is-5" style={{ color: "var(--status-attention-text)" }}>
            Possible duplicate
          </h2>
          <p className="has-text-secondary mb-2" style={{ fontSize: 13 }}>
            This record shares contact details with{" "}
            {duplicates.length === 1 ? "another candidate" : "other candidates"}. Nothing has been
            merged — merging two people&apos;s histories wrongly is worse than carrying a duplicate.
          </p>
          <ul>
            {duplicates.map((duplicate) => {
              const otherId =
                duplicate.candidate_id === candidate.id
                  ? duplicate.duplicate_of_id
                  : duplicate.candidate_id;
              return (
                <li key={duplicate.id} className="py-1" style={{ fontSize: 14 }}>
                  <Link href={`/candidates/${otherId}`}>View the other record</Link>
                  <span className="has-text-secondary"> — matched on {duplicate.matched_on}</span>
                </li>
              );
            })}
          </ul>
        </div>
      )}

      <div className="card mb-4">
        <h2 className="title is-5">Profile</h2>
        <div className="columns is-multiline">
          <Field label="Email" value={candidate.email ?? "—"} />
          <Field label="Phone" value={candidate.phone ?? "—"} />
          <Field label="Location" value={candidate.location ?? "—"} />
          <Field label="Current company" value={candidate.current_company ?? "—"} />
          <Field label="Current role" value={candidate.current_role ?? "—"} />
          <Field
            label="Total experience"
            value={
              candidate.total_experience_years === null
                ? "—"
                : `${candidate.total_experience_years} yrs`
            }
          />
          <Field
            label="Expected salary"
            value={
              candidate.expected_salary === null
                ? "—"
                : candidate.expected_salary.toLocaleString("en-IN")
            }
          />
          <Field
            label="Notice period"
            value={
              candidate.notice_period_days === null
                ? "—"
                : candidate.notice_period_days === 0
                  ? "Immediate"
                  : `${candidate.notice_period_days} days`
            }
          />
          <Field
            label="Added"
            value={new Date(candidate.created_at).toLocaleDateString("en-GB", {
              day: "numeric",
              month: "long",
              year: "numeric",
            })}
          />
        </div>

        <div className="mt-4">
          <p className="has-text-secondary mb-1" style={{ fontSize: 12 }}>
            Skills
          </p>
          {candidate.skills.length === 0 ? (
            <p style={{ fontSize: 14 }}>—</p>
          ) : (
            <div className="tags">
              {candidate.skills.map((skill) => (
                <span key={skill} className="tag is-light">
                  {skill}
                </span>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* The spec's "full history across jobs/applications" needs Module 5. */}
      <div className="card mb-4">
        <h2 className="title is-5">Applications</h2>
        <p className="has-text-secondary" style={{ fontSize: 14 }}>
          This candidate&apos;s history across jobs appears here once Applications (Module 5) is
          built. Resume parsing arrives with Module 6.
        </p>
      </div>

      {canArchive && !candidate.archived_at && (
        <div className="card" style={{ borderColor: "var(--color-error)" }}>
          <h2 className="title is-5" style={{ color: "var(--color-error)" }}>
            Danger zone
          </h2>
          <ArchiveCandidateButton candidateId={candidate.id} name={candidate.name} />
        </div>
      )}

      {!canEdit && (
        <p className="has-text-secondary" style={{ fontSize: 13 }}>
          Your role has read-only access to candidates.
        </p>
      )}
    </>
  );
}

export default async function CandidateDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ edit?: string }>;
}) {
  const [{ id }, query] = await Promise.all([params, searchParams]);

  return (
    <AppShell>
      <Suspense
        fallback={
          <div className="card">
            <SkeletonRows rows={4} />
          </div>
        }
      >
        <CandidateDetailContent candidateId={id} editing={query.edit === "1"} />
      </Suspense>
    </AppShell>
  );
}
