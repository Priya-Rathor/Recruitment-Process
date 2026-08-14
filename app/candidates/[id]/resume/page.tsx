import Link from "next/link";
import { notFound } from "next/navigation";
import { AppShell } from "@/components/AppShell";
import { EmptyState } from "@/components/states";
import { requireMembershipOrRedirect, hasRole } from "@/lib/tenant";
import { getCandidate } from "@/lib/candidates/queries";
import { listResumes, type Resume, type ResumeParseStatus } from "@/lib/resumes/queries";
import { ReparseButton, ResumeUploader } from "./ResumeUploader";

export const metadata = { title: "Resume · Recruitment OS" };
export const dynamic = "force-dynamic";

const STATUS_STYLE: Record<ResumeParseStatus, { background: string; color: string; label: string }> =
  {
    pending: {
      background: "var(--status-disconnected-bg)",
      color: "var(--status-disconnected-text)",
      label: "Not read yet",
    },
    extracting: {
      background: "var(--status-attention-bg)",
      color: "var(--status-attention-text)",
      label: "Reading…",
    },
    parsing: {
      background: "var(--status-attention-bg)",
      color: "var(--status-attention-text)",
      label: "Parsing…",
    },
    parsed: {
      background: "#eff6ff",
      color: "var(--color-info)",
      label: "Awaiting review",
    },
    reviewed: {
      background: "var(--status-connected-bg)",
      color: "var(--status-connected-text)",
      label: "Reviewed",
    },
    failed: {
      background: "var(--status-error-bg)",
      color: "var(--status-error-text)",
      label: "Couldn't read",
    },
  };

function ResumeRow({
  resume,
  candidateId,
  canManage,
}: {
  resume: Resume;
  candidateId: string;
  canManage: boolean;
}) {
  const style = STATUS_STYLE[resume.parse_status];

  return (
    <li className="py-3" style={{ borderTop: "1px solid var(--color-border)" }}>
      <div className="is-flex is-justify-content-space-between is-align-items-flex-start">
        <div style={{ minWidth: 0 }}>
          <p style={{ fontWeight: 600, fontSize: 14, wordBreak: "break-all" }}>
            {resume.file_name}
          </p>
          <p className="has-text-secondary" style={{ fontSize: 12 }}>
            {new Date(resume.uploaded_at).toLocaleString("en-GB", {
              day: "numeric",
              month: "short",
              year: "numeric",
              hour: "2-digit",
              minute: "2-digit",
            })}
            {resume.uploaded_by_name && ` · ${resume.uploaded_by_name}`}
            {resume.extracted_characters !== null &&
              resume.extracted_characters > 0 &&
              ` · ${resume.extracted_characters.toLocaleString("en-IN")} characters read`}
          </p>

          {/* A failure explains itself and names the way forward. */}
          {resume.parse_error && (
            <p className="mt-2" style={{ fontSize: 13, color: "var(--color-error)" }}>
              {resume.parse_error}
            </p>
          )}
        </div>

        <div className="is-flex is-align-items-center" style={{ gap: "0.5rem", flexShrink: 0 }}>
          <span className="tag" style={{ ...style, fontSize: 12, fontWeight: 600 }}>
            {style.label}
          </span>
        </div>
      </div>

      {canManage && (
        <div className="buttons mt-2">
          {resume.parse_status === "parsed" && (
            <Link
              className="button is-small is-primary"
              href={`/candidates/${candidateId}/resume/review`}
            >
              Review parsed fields
            </Link>
          )}
          {(resume.parse_status === "failed" ||
            resume.parse_status === "pending" ||
            resume.parse_status === "reviewed") && (
            <ReparseButton resumeId={resume.id} candidateId={candidateId} />
          )}
        </div>
      )}
    </li>
  );
}

export default async function CandidateResumePage({
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

  const canManage = hasRole(membership.role, ["owner", "admin", "recruiter"]);
  const resumes = await listResumes({
    organizationId: membership.organization.id,
    candidateId: id,
  });

  return (
    <AppShell>
      <div className="mb-5">
        <p className="has-text-secondary mb-1" style={{ fontSize: 13 }}>
          <Link href="/candidates">Candidates</Link> /{" "}
          <Link href={`/candidates/${candidate.id}`}>{candidate.name}</Link> / Resume
        </p>
        <h1 className="title is-4 mb-1">Resume</h1>
        <p className="has-text-secondary" style={{ fontSize: 13 }}>
          AI reads the resume and proposes profile updates. Nothing is saved to the profile until
          you review it.
        </p>
      </div>

      {canManage && (
        <div className="card mb-4">
          <h2 className="title is-5">Upload a resume</h2>
          <ResumeUploader candidateId={candidate.id} />
        </div>
      )}

      <div className="card">
        <h2 className="title is-5">Uploaded resumes</h2>
        {resumes.length === 0 ? (
          <EmptyState
            message={
              canManage
                ? "No resumes uploaded yet."
                : "No resumes uploaded yet. Your role has read-only access."
            }
          />
        ) : (
          <ul>
            {resumes.map((resume) => (
              <ResumeRow
                key={resume.id}
                resume={resume}
                candidateId={candidate.id}
                canManage={canManage}
              />
            ))}
          </ul>
        )}
      </div>
    </AppShell>
  );
}
