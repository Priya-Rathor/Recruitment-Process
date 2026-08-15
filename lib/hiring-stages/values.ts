// =============================================================================
// Turning real rows into placeholder values.
//
// The one mapping from database columns to {{tokens}}. Every stage that ever
// renders a script goes through here, so "what does {{job.salary_range}} mean?"
// has exactly one answer — and adding a token to the catalogue without a value
// here shows up as a missing value rather than as two stages disagreeing.
//
// Pure: takes plain objects, returns a plain record. The callers do the reading.
// =============================================================================
import { formatExperience, formatSalary } from "@/lib/jobs/format";
import { WORK_MODE_LABELS, type WorkMode } from "@/lib/types";
import { STAGE_LABELS } from "@/lib/applications/stages";
import type { PlaceholderValues } from "@/lib/hiring-stages/placeholders";

export type JobValueSource = {
  title: string | null;
  location: string | null;
  work_mode: WorkMode | null;
  experience_min: number | null;
  experience_max: number | null;
  salary_min: number | null;
  salary_max: number | null;
  required_skills: string[] | null;
  preferred_skills: string[] | null;
  client_name?: string | null;
};

export type CandidateValueSource = {
  name: string | null;
  email: string | null;
  current_company: string | null;
  current_role: string | null;
  total_experience_years: number | null;
  expected_salary: number | null;
  notice_period_days: number | null;
};

export type ApplicationValueSource = {
  stage: string | null;
  match_score: number | null;
};

function list(values: string[] | null | undefined): string | null {
  if (!values || values.length === 0) return null;
  return values.join(", ");
}

function years(value: number | null): string | null {
  if (value === null) return null;
  return `${value} year${value === 1 ? "" : "s"}`;
}

function days(value: number | null): string | null {
  if (value === null) return null;
  if (value === 0) return "immediate";
  return `${value} days`;
}

/**
 * Builds the substitution map.
 *
 * Missing values are NULL rather than a placeholder string like "N/A". The
 * renderer drops them, so "with {{candidate.notice_period}} notice" becomes
 * "with  notice" rather than "with N/A notice" — awkward, but an agent reading
 * "N/A" aloud to a candidate is worse, and the preview shows the recruiter
 * which fields are risky before it ever runs.
 */
export function buildPlaceholderValues({
  job,
  candidate,
  application,
}: {
  job?: JobValueSource | null;
  candidate?: CandidateValueSource | null;
  application?: ApplicationValueSource | null;
}): PlaceholderValues {
  const values: PlaceholderValues = {};

  if (job) {
    values["job.title"] = job.title;
    values["job.client_name"] = job.client_name ?? null;
    values["job.location"] = job.location;
    values["job.work_mode"] = job.work_mode ? WORK_MODE_LABELS[job.work_mode] : null;
    // Reuses the job list's own formatters, so a script says the same thing the
    // job page says rather than inventing a second way to phrase a range.
    values["job.experience_range"] = blankToNull(
      formatExperience(job.experience_min, job.experience_max)
    );
    values["job.salary_range"] = blankToNull(formatSalary(job.salary_min, job.salary_max));
    values["job.required_skills"] = list(job.required_skills);
    values["job.preferred_skills"] = list(job.preferred_skills);
  }

  if (candidate) {
    values["candidate.name"] = candidate.name;
    values["candidate.email"] = candidate.email;
    values["candidate.current_company"] = candidate.current_company;
    values["candidate.current_role"] = candidate.current_role;
    values["candidate.total_experience"] = years(candidate.total_experience_years);
    values["candidate.expected_salary"] =
      candidate.expected_salary === null ? null : String(candidate.expected_salary);
    values["candidate.notice_period"] = days(candidate.notice_period_days);
  }

  if (application) {
    values["application.stage"] =
      application.stage && application.stage in STAGE_LABELS
        ? STAGE_LABELS[application.stage as keyof typeof STAGE_LABELS]
        : application.stage;
    values["application.match_score"] =
      application.match_score === null ? null : `${application.match_score}%`;
  }

  return values;
}

/** The job formatters return an em dash for "not set"; that is not a value. */
function blankToNull(text: string): string | null {
  const trimmed = text.trim();
  return trimmed.length === 0 || trimmed === "—" ? null : trimmed;
}
