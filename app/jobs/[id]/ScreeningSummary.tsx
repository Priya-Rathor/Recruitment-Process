// =============================================================================
// The AI screening setup, inline on the job detail page.
//
// Read-only, and shown only when the stage is enabled. The spec's reason is
// worth restating: a recruiter should be able to see what the automated call
// will do WITHOUT opening a configuration screen, because the thing they check
// most often — "is this pointing at the right questions?" — is a glance, not an
// edit.
//
// Server component. Nothing here is interactive except the link out.
// =============================================================================
import Link from "next/link";
import { PhoneCall, Settings2 } from "lucide-react";
import type { AiScreeningConfig } from "@/lib/hiring-stages/config";
import { splitTokens } from "@/lib/hiring-stages/placeholders";

/** Characters of script shown before "View full script". */
const PREVIEW_LENGTH = 220;

export function ScreeningSummary({
  jobId,
  promptTemplate,
  config,
  questionCount,
  organizationMaxAttempts,
  canEdit,
}: {
  jobId: string;
  promptTemplate: string | null;
  config: AiScreeningConfig;
  /** From job_screening_questions — the list the call actually dials with. */
  questionCount: number;
  /** Module 17's default, used when the stage does not override it. */
  organizationMaxAttempts: number;
  canEdit: boolean;
}) {
  const script = promptTemplate?.trim() ?? "";
  const truncated = script.length > PREVIEW_LENGTH;
  const preview = truncated ? `${script.slice(0, PREVIEW_LENGTH).trimEnd()}…` : script;

  const { known } = splitTokens(script);

  return (
    <div className="card mb-4">
      <div className="is-flex is-justify-content-space-between is-align-items-flex-start mb-3">
        <div>
          <h2 className="title is-5 mb-1">
            <PhoneCall size={16} aria-hidden="true" style={{ verticalAlign: -2, marginRight: 8 }} />
            AI screening call
          </h2>
          <p className="has-text-secondary" style={{ fontSize: "var(--text-label)" }}>
            Runs automatically through Bolna when a candidate reaches screening.
          </p>
        </div>

        {/* Edits still go through the configure flow — this card never becomes
            a second place to change the same values. */}
        <Link className="button is-small" href={`/jobs/${jobId}/edit`}>
          <Settings2 size={13} aria-hidden="true" />
          {canEdit ? "Configure" : "View full script"}
        </Link>
      </div>

      <div className="screening-summary__stats">
        <div>
          <p className="screening-summary__label">Questions</p>
          <p className="screening-summary__value">{questionCount}</p>
        </div>
        <div>
          <p className="screening-summary__label">Max attempts</p>
          <p className="screening-summary__value">
            {config.maxAttempts ?? organizationMaxAttempts}
            {config.maxAttempts === null && (
              <span className="screening-summary__hint"> (org default)</span>
            )}
          </p>
        </div>
        <div>
          <p className="screening-summary__label">Language</p>
          <p className="screening-summary__value">
            {config.language ?? "en"}
            {config.language === null && (
              <span className="screening-summary__hint"> (org default)</span>
            )}
          </p>
        </div>
      </div>

      {/*
        A zero-question screen is worth flagging here rather than at dial time:
        the call would consist of a consent disclosure and a goodbye.
      */}
      {questionCount === 0 && (
        <p className="stage-warning mt-3">
          No screening questions yet — the call would open, disclose, and end. Add questions before
          this runs.
        </p>
      )}

      {script.length > 0 ? (
        <div className="screening-summary__script">
          <p className="screening-summary__label">Script</p>
          {/* Tokens are shown UNRESOLVED, deliberately: this is the template, and
              rendering it with one candidate's details would misrepresent what
              every other candidate hears. */}
          <p className="screening-summary__preview">{preview}</p>
          {truncated && (
            <Link href={`/jobs/${jobId}/edit`} style={{ fontSize: "var(--text-label)" }}>
              View full script
            </Link>
          )}
          {known.length > 0 && (
            <div className="stage-chips mt-2">
              <span className="stage-chips__label">Uses:</span>
              {known.map((field) => (
                <span key={field.token} className="stage-chip">
                  {field.label}
                </span>
              ))}
            </div>
          )}
        </div>
      ) : (
        <p className="has-text-secondary mt-3" style={{ fontSize: "var(--text-label)" }}>
          No script written — the call will use the standard disclosure and the questions above.
        </p>
      )}
    </div>
  );
}
