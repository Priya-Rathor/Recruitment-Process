// =============================================================================
// Resume scoring — its own card, deliberately not a row inside "Hiring stages".
//
// It was in that list and did not belong there. The four hiring stages are steps
// a candidate moves through and each can be switched off; resume scoring happens
// to every application whether anything is switched on or not. Sitting in the
// same list, under the heading "What candidates for this role go through", it
// read as a fifth step — and its switch read as "score resumes: no", which would
// be false.
//
// Here the switch means what it actually means: whose rules are used. Read-only,
// like the screening summary beside it; editing happens on the edit page.
// =============================================================================
import Link from "next/link";
import { Gauge, Settings2 } from "lucide-react";
import type { ResumeScoreConfig } from "@/lib/hiring-stages/config";
import { COMPONENT_WEIGHTS } from "@/lib/matching/deterministic";
import { SEMANTIC_WEIGHT } from "@/lib/matching/score";

export function ResumeScoringCard({
  jobId,
  enabled,
  config,
  canEdit,
}: {
  jobId: string;
  /** On = this job's own prompt and numbers. Off = the platform default. */
  enabled: boolean;
  config: ResumeScoreConfig;
  canEdit: boolean;
}) {
  const aiShare =
    enabled && config.semanticWeightPercent !== null
      ? config.semanticWeightPercent
      : Math.round(SEMANTIC_WEIGHT * 100);

  const weights = (enabled && config.weights) || COMPONENT_WEIGHTS;
  const weightTotal = Object.values(weights).reduce((sum, value) => sum + value, 0);

  return (
    <section className="card">
      <div className="job-card__head">
        <div>
          <h2 className="job-card__title">
            <Gauge size={16} aria-hidden="true" />
            Resume scoring
          </h2>
          <p className="job-card__subtitle">
            Every application to this job is scored on its resume — this is not a stage candidates
            move through, and it cannot be switched off.
          </p>
        </div>

        <Link className="text-link" href={`/jobs/${jobId}/edit`}>
          <Settings2 size={14} aria-hidden="true" />
          {canEdit ? "Configure" : "View"}
        </Link>
      </div>

      <div className="job-stats">
        <div className="job-stats__item">
          <p className="job-stats__label">Scored with</p>
          <p className="job-stats__value">{enabled ? "This job's own rules" : "Platform default"}</p>
        </div>
        <div className="job-stats__item">
          <p className="job-stats__label">Pass mark</p>
          <p className="job-stats__value">
            {/* Blank is meaningful: no gate reads as Needs Review rather than
                failing everyone below a number nobody set. */}
            {enabled && config.passingScore !== null ? `${config.passingScore}%` : "No gate set"}
          </p>
        </div>
        <div className="job-stats__item">
          <p className="job-stats__label">AI share</p>
          <p className="job-stats__value">{aiShare}%</p>
        </div>
      </div>

      <div className="job-weights">
        {(
          [
            ["Skills", weights.skills],
            ["Experience", weights.experience],
            ["Salary", weights.salary],
            ["Location", weights.location],
            ["Notice", weights.notice],
          ] as const
        ).map(([label, weight]) => (
          <span key={label} className="tag is-light">
            {label} {Math.round((weight / weightTotal) * 100)}%
          </span>
        ))}
      </div>
    </section>
  );
}
