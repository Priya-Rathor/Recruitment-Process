// =============================================================================
// The candidate's resume history.
//
// Server component — the list is read once with the page rather than fetched
// after it paints, matching how every other section of this profile works.
//
// THE RULE THIS SECTION EXISTS TO MAKE VISIBLE: nothing is ever removed. A
// candidate accumulates resumes, and a new upload adds a row rather than
// replacing one. "Most recent" is a label on the first entry, not a state that
// erases the others — which is exactly what the list has to show, or a
// recruiter has no way to know the older versions are still there.
// =============================================================================
import Link from "next/link";
import { Download, FileText, Upload } from "lucide-react";
import { EmptyState } from "@/components/states";
import { formatDateInZone } from "@/lib/time";
import {
  describeResumeSource,
  formatFileSize,
  type ResumeHistoryEntry,
} from "@/lib/resumes/history";

export function ResumesCard({
  candidateId,
  resumes,
  canUpload,
  timeZone,
}: {
  candidateId: string;
  resumes: ResumeHistoryEntry[];
  /** Owner/Admin/Recruiter. A Viewer still sees and downloads the list. */
  canUpload: boolean;
  /**
   * The ORGANIZATION's timezone, never the server's and never the browser's.
   *
   * An upload at 23:40 in Gurgaon is a UTC timestamp on 21 August. Formatted
   * with the server's zone it reads "21 August"; formatted with the team's, it
   * reads "22 August" — the day they actually did it. formatDateInZone also
   * pins the locale, so the string is identical on server and client and cannot
   * produce a hydration mismatch.
   */
  timeZone: string;
}) {
  return (
    <div className="card mb-4">
      <div className="is-flex is-justify-content-space-between is-align-items-center mb-3">
        <div>
          <h2 className="title is-5 mb-1">Resumes</h2>
          <p className="has-text-secondary" style={{ fontSize: 13 }}>
            {resumes.length === 0
              ? "Every resume uploaded for this candidate appears here."
              : `${resumes.length} on file — older versions are kept, never replaced.`}
          </p>
        </div>

        {canUpload && resumes.length > 0 && (
          <Link className="button is-small" href={`/candidates/${candidateId}/resume`}>
            <Upload size={14} aria-hidden="true" />
            Upload resume
          </Link>
        )}
      </div>

      {resumes.length === 0 ? (
        <EmptyState
          icon={FileText}
          compact
          headline="No resume on file yet"
          message={
            canUpload
              ? "Upload one and AI will propose profile updates for you to review."
              : "Nobody has uploaded a resume for this candidate."
          }
          action={
            canUpload ? (
              <Link className="button is-primary" href={`/candidates/${candidateId}/resume`}>
                <Upload size={16} aria-hidden="true" />
                Upload resume
              </Link>
            ) : undefined
          }
        />
      ) : (
        <ul className="resume-list">
          {resumes.map((resume) => (
            <li key={resume.id} className="resume-row">
              <FileText size={16} aria-hidden="true" className="resume-row__icon" />

              <div className="resume-row__meta">
                <p className="resume-row__name" title={resume.file_name}>
                  {resume.file_name}
                  {/* On the newest entry only. It moves when a newer file
                      arrives; it never removes anything. */}
                  {resume.isMostRecent && <span className="resume-row__tag">Most recent</span>}
                </p>
                <p className="resume-row__detail">
                  {formatDateInZone(resume.uploaded_at, timeZone)} ·{" "}
                  {formatFileSize(resume.file_size_bytes)}
                </p>
                <p className="resume-row__detail">
                  {/* Where it came from. Links to the job when it arrived
                      through that job's bulk upload. */}
                  {resume.viaJobId && resume.viaJobTitle ? (
                    <>
                      Uploaded via <Link href={`/jobs/${resume.viaJobId}`}>{resume.viaJobTitle}</Link>{" "}
                      job
                    </>
                  ) : (
                    describeResumeSource(resume)
                  )}
                  {resume.uploaded_by_name && ` · by ${resume.uploaded_by_name}`}
                </p>
              </div>

              {/*
                A plain link, not a fetch. The route redirects to a short-lived
                signed URL, so the link is resolved at click time and the URL
                never sits in client state where it could be copied out.
                Available to EVERY role, Viewer included.
              */}
              <a
                className="button is-small resume-row__action"
                href={`/api/resumes/${resume.id}/download`}
                target="_blank"
                rel="noreferrer"
              >
                <Download size={13} aria-hidden="true" />
                View
              </a>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
