import Link from "next/link";
import { notFound } from "next/navigation";
import { AppShell } from "@/components/AppShell";
import { requireMembershipOrRedirect, hasRole } from "@/lib/tenant";
import { getCandidate } from "@/lib/candidates/queries";
import { getLatestParsedResume } from "@/lib/resumes/queries";
import { buildFieldComparisons, countConflicts } from "@/lib/resumes/review";
import { ReviewForm } from "./ReviewForm";

export const metadata = { title: "Review resume" };
export const dynamic = "force-dynamic";

export default async function ResumeReviewPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const membership = await requireMembershipOrRedirect();

  const candidate = await getCandidate({
    organizationId: membership.organization.id,
    candidateId: id,
  });
  if (!candidate) notFound();

  // Spec section 9: "Review/confirm AI-parsed fields — Viewer: No".
  if (!hasRole(membership.role, ["owner", "admin", "recruiter"])) {
    return (
      <AppShell>
        <div className="card">
          <h1 className="title is-5">You can&apos;t review parsed resumes</h1>
          <p className="has-text-secondary mb-4" style={{ fontSize: 14 }}>
            Your role is Viewer, which has read-only access.
          </p>
          <Link className="button" href={`/candidates/${candidate.id}`}>
            Back to the candidate
          </Link>
        </div>
      </AppShell>
    );
  }

  const latest = await getLatestParsedResume({
    organizationId: membership.organization.id,
    candidateId: id,
  });

  if (!latest) {
    return (
      <AppShell>
        <div className="card">
          <h1 className="title is-5">Nothing to review</h1>
          <p className="has-text-secondary mb-4" style={{ fontSize: 14 }}>
            No resume has been parsed for this candidate yet.
          </p>
          <Link className="button is-primary" href={`/candidates/${candidate.id}/resume`}>
            Upload a resume
          </Link>
        </div>
      </AppShell>
    );
  }

  const comparisons = buildFieldComparisons(candidate, latest.parseResult.raw_json);
  const conflicts = countConflicts(comparisons);
  const confidence = latest.parseResult.confidence;

  return (
    <AppShell>
      <div className="mb-5">
        <p className="has-text-secondary mb-1" style={{ fontSize: 13 }}>
          <Link href="/candidates">Candidates</Link> /{" "}
          <Link href={`/candidates/${candidate.id}`}>{candidate.name}</Link> /{" "}
          <Link href={`/candidates/${candidate.id}/resume`}>Resume</Link> / Review
        </p>
        <h1 className="title is-4 mb-1">Review parsed resume</h1>
        <p className="has-text-secondary" style={{ fontSize: 13 }}>
          From {latest.resume.file_name}
          {conflicts > 0 &&
            ` · ${conflicts} ${conflicts === 1 ? "conflict" : "conflicts"} to resolve`}
        </p>
      </div>

      <div className="ai-panel mb-4">
        <p style={{ fontSize: 13, fontWeight: 600, color: "var(--color-info)" }}>
          AI proposal — not yet saved
        </p>
        <p className="mt-2" style={{ fontSize: 14 }}>
          These values were read from the resume by AI. None of them has been written to the
          candidate&apos;s profile. Choose what to keep, then apply.
        </p>
        {confidence !== null && (
          <p className="has-text-secondary mt-2" style={{ fontSize: 12 }}>
            The model reported {Math.round(confidence * 100)}% confidence in this extraction. Treat
            that as a hint, not a verdict — check anything that matters.
          </p>
        )}
      </div>

      <ReviewForm
        resumeId={latest.resume.id}
        candidateId={candidate.id}
        comparisons={comparisons}
        alreadyReviewed={latest.parseResult.reviewed_at !== null}
      />

      <ParsedExtras parsed={latest.parseResult.raw_json} />
    </AppShell>
  );
}

/**
 * Experience, education and certifications are parsed and stored on the result,
 * but Module 4's candidates table has no columns for them. Shown read-only so
 * the extraction isn't invisible, and flagged as not-yet-stored so nobody
 * assumes it is searchable.
 */
function ParsedExtras({
  parsed,
}: {
  parsed: import("@/lib/ai/parseResume").ParsedResume;
}) {
  const hasExtras =
    parsed.experience.length > 0 ||
    parsed.education.length > 0 ||
    parsed.certifications.length > 0;

  if (!hasExtras) return null;

  return (
    <div className="card mt-4">
      <h2 className="title is-5">Also found in the resume</h2>
      <p className="has-text-secondary mb-4" style={{ fontSize: 13 }}>
        Read from the resume and kept on the parse record. There are no profile fields for these
        yet, so they are not applied or searchable.
      </p>

      {parsed.experience.length > 0 && (
        <div className="mb-4">
          <p style={{ fontSize: 13, fontWeight: 600 }}>Experience</p>
          <ul style={{ fontSize: 14 }}>
            {parsed.experience.map((entry, index) => (
              <li key={`${entry.company}-${index}`} className="py-1">
                {entry.role} at {entry.company}
                {entry.period && (
                  <span className="has-text-secondary"> · {entry.period}</span>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}

      {parsed.education.length > 0 && (
        <div className="mb-4">
          <p style={{ fontSize: 13, fontWeight: 600 }}>Education</p>
          <ul style={{ fontSize: 14 }}>
            {parsed.education.map((entry, index) => (
              <li key={`${entry.institution}-${index}`} className="py-1">
                {entry.qualification ? `${entry.qualification}, ` : ""}
                {entry.institution}
                {entry.year && <span className="has-text-secondary"> · {entry.year}</span>}
              </li>
            ))}
          </ul>
        </div>
      )}

      {parsed.certifications.length > 0 && (
        <div>
          <p style={{ fontSize: 13, fontWeight: 600 }}>Certifications</p>
          <div className="tags mt-2">
            {parsed.certifications.map((certification) => (
              <span key={certification} className="tag is-light">
                {certification}
              </span>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
