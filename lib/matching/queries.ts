// Match calculation and persistence. The one place the two halves are run and
// stored together.
import { createClient } from "@/lib/supabase/server";
import {
  scoreDeterministic,
  type ComponentKey,
  type MatchFinding,
} from "@/lib/matching/deterministic";
import { combineMatch, type CombinedMatch } from "@/lib/matching/score";
import { matchCandidateToJob } from "@/lib/ai/matchCandidateToJob";
import { SEMANTIC_WEIGHT } from "@/lib/matching/score";
import { listJobStages } from "@/lib/hiring-stages/queries";
import { buildPlaceholderValues } from "@/lib/hiring-stages/values";
import { renderTemplate, type PlaceholderValues } from "@/lib/hiring-stages/placeholders";
import type { ResumeScoreConfig } from "@/lib/hiring-stages/config";
import { formatDbError } from "@/lib/supabase/errors";

export type StoredMatch = {
  id: string;
  application_id: string;
  overall_score: number;
  deterministic_score: number;
  semantic_score: number | null;
  strong_matches: MatchFinding[];
  gaps: MatchFinding[];
  needs_verification: MatchFinding[];
  ai_used: boolean;
  ai_error: string | null;
  is_stale: boolean;
  stale_reason: string | null;
  calculated_at: string;
};

const MATCH_COLUMNS =
  "id, application_id, overall_score, deterministic_score, semantic_score, " +
  "strong_matches, gaps, needs_verification, ai_used, ai_error, is_stale, " +
  "stale_reason, calculated_at";

/** The stored match for an application, if one has been calculated. */
export async function getMatch({
  organizationId,
  applicationId,
}: {
  organizationId: string;
  applicationId: string;
}): Promise<StoredMatch | null> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("application_matches")
    .select(MATCH_COLUMNS)
    .eq("organization_id", organizationId)
    .eq("application_id", applicationId)
    .maybeSingle();

  if (error || !data) return null;
  return data as unknown as StoredMatch;
}

/** The job + candidate facts the two scoring halves need. */
async function loadMatchInputs({
  organizationId,
  applicationId,
}: {
  organizationId: string;
  applicationId: string;
}) {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from("applications")
    .select(
      "id, candidate_id, job_id, stage, match_score, " +
        "candidate:candidates(name, email, skills, total_experience_years, expected_salary, " +
        "notice_period_days, location, current_role, current_company), " +
        "job:jobs(title, required_skills, preferred_skills, experience_min, experience_max, " +
        "salary_min, salary_max, location, work_mode)"
    )
    .eq("id", applicationId)
    .eq("organization_id", organizationId)
    .maybeSingle();

  if (error || !data) return null;

  const row = data as unknown as {
    job_id: string;
    stage: string | null;
    match_score: number | null;
    candidate: {
      name: string | null;
      email: string | null;
      current_company: string | null;
      skills: string[] | null;
      total_experience_years: number | null;
      expected_salary: number | null;
      notice_period_days: number | null;
      location: string | null;
      current_role: string | null;
    } | null;
    job: {
      title: string;
      required_skills: string[] | null;
      preferred_skills: string[] | null;
      experience_min: number | null;
      experience_max: number | null;
      salary_min: number | null;
      salary_max: number | null;
      location: string | null;
      work_mode: "onsite" | "hybrid" | "remote" | null;
    } | null;
  };

  if (!row.candidate || !row.job) return null;

  return {
    jobId: row.job_id,
    // Only for rendering {{tokens}} in a custom scoring prompt. Neither half of
    // the score reads these.
    placeholders: buildPlaceholderValues({
      job: {
        title: row.job.title,
        location: row.job.location,
        work_mode: row.job.work_mode,
        experience_min: row.job.experience_min,
        experience_max: row.job.experience_max,
        salary_min: row.job.salary_min,
        salary_max: row.job.salary_max,
        required_skills: row.job.required_skills,
        preferred_skills: row.job.preferred_skills,
      },
      candidate: {
        name: row.candidate.name,
        email: row.candidate.email,
        current_company: row.candidate.current_company,
        current_role: row.candidate.current_role,
        total_experience_years: row.candidate.total_experience_years,
        expected_salary: row.candidate.expected_salary,
        notice_period_days: row.candidate.notice_period_days,
      },
      application: { stage: row.stage, match_score: row.match_score },
    }),
    job: {
      title: row.job.title,
      requiredSkills: row.job.required_skills ?? [],
      preferredSkills: row.job.preferred_skills ?? [],
      experienceMin: row.job.experience_min,
      experienceMax: row.job.experience_max,
      salaryMin: row.job.salary_min,
      salaryMax: row.job.salary_max,
      location: row.job.location,
      workMode: row.job.work_mode,
    },
    candidate: {
      skills: row.candidate.skills ?? [],
      totalExperienceYears: row.candidate.total_experience_years,
      expectedSalary: row.candidate.expected_salary,
      noticePeriodDays: row.candidate.notice_period_days,
      location: row.candidate.location,
      currentRole: row.candidate.current_role,
    },
  };
}

/**
 * The job's Resume Score row, reduced to the three things scoring needs.
 *
 * A row that is present but switched OFF is treated exactly as no row at all —
 * that is what "off means the platform default" has to mean, or a threshold
 * someone stopped using would keep applying. Undefined weights/percentages fall
 * back individually, so a job can customise the prompt without also having to
 * take ownership of the weights.
 */
async function loadScoringConfig({
  organizationId,
  jobId,
  placeholders,
}: {
  organizationId: string;
  jobId: string;
  /** This candidate's values, for {{tokens}} in a custom prompt. */
  placeholders: PlaceholderValues;
}): Promise<{
  guidance: string | null;
  weights: Record<ComponentKey, number> | undefined;
  semanticWeight: number;
}> {
  const stages = await listJobStages({ organizationId, jobId });
  const row = stages.find((stage) => stage.stage_key === "resume_score");

  if (!row?.enabled) {
    return { guidance: null, weights: undefined, semanticWeight: SEMANTIC_WEIGHT };
  }

  const config = row.config as ResumeScoreConfig;

  return {
    // Rendered with THIS candidate's values, at run time, exactly as the
    // screening script is — a prompt stored with a name already baked in would
    // be wrong for everyone else it ever scored.
    guidance: row.prompt_template
      ? renderTemplate(row.prompt_template, placeholders)
      : null,
    weights: config.weights ?? undefined,
    semanticWeight:
      config.semanticWeightPercent === null
        ? SEMANTIC_WEIGHT
        : config.semanticWeightPercent / 100,
  };
}

export type CalculateResult =
  | { ok: true; match: CombinedMatch; aiError: string | null }
  | { ok: false; error: string };

/**
 * Calculates and stores a match.
 *
 * Order matters: the deterministic pass runs FIRST and always succeeds, so an AI
 * failure degrades the result rather than losing it. A match that says
 * "deterministic only" is far more useful than no match at all — and the spec
 * requires the workflow to survive AI being down.
 */
export async function calculateAndStoreMatch({
  organizationId,
  applicationId,
}: {
  organizationId: string;
  applicationId: string;
}): Promise<CalculateResult> {
  const inputs = await loadMatchInputs({ organizationId, applicationId });
  if (!inputs) return { ok: false, error: "Application not found." };

  // This job's own scoring configuration, if it has one switched on. Everything
  // below falls back to the platform defaults, so a job that never touched the
  // Resume Score row scores exactly as it did before that row existed.
  const scoring = await loadScoringConfig({
    organizationId,
    jobId: inputs.jobId,
    placeholders: inputs.placeholders,
  });

  // Facts first. No AI involved, cannot fail.
  const deterministic = scoreDeterministic(inputs, scoring.weights);

  // Semantics second, and optional.
  let semantic = null;
  let aiError: string | null = null;

  const semanticResult = await matchCandidateToJob({
    jobTitle: inputs.job.title,
    unmatchedRequiredSkills: deterministic.unmatchedRequiredSkills,
    candidateSkills: inputs.candidate.skills,
    candidateCurrentRole: inputs.candidate.currentRole,
    guidance: scoring.guidance,
  });

  if (semanticResult.ok) {
    semantic = semanticResult.data;
  } else {
    aiError = semanticResult.message;
  }

  const match = combineMatch({ deterministic, semantic, semanticWeight: scoring.semanticWeight });

  const supabase = await createClient();
  const { error } = await supabase.from("application_matches").upsert(
    {
      organization_id: organizationId,
      application_id: applicationId,
      overall_score: match.overallScore,
      deterministic_score: match.deterministicScore,
      semantic_score: match.semanticScore,
      strong_matches: match.strongMatches,
      gaps: match.gaps,
      needs_verification: match.needsVerification,
      ai_used: match.aiUsed,
      ai_error: aiError,
      is_stale: false,
      stale_reason: null,
      calculated_at: new Date().toISOString(),
    },
    { onConflict: "application_id" }
  );

  if (error) {
    console.error(`[matching] storing match failed: ${formatDbError(error)}`);
    return { ok: false, error: "Could not save the match result." };
  }

  // A database trigger copies overall_score onto applications.match_score, so
  // lists and the pipeline board stay in step without a join.
  return { ok: true, match, aiError };
}

/**
 * Returns the current match, calculating it if absent or stale.
 *
 * The cost model chapter forbids recalculating on every page view. Staleness is
 * set by a database trigger only when the underlying candidate or job data
 * actually changes, so this recalculates once per real change — not once per
 * visit.
 */
export async function getOrCalculateMatch({
  organizationId,
  applicationId,
  allowCalculate,
}: {
  organizationId: string;
  applicationId: string;
  /** False for a Viewer, who may see a match but not trigger a paid call. */
  allowCalculate: boolean;
}): Promise<{ match: StoredMatch | null; calculated: boolean }> {
  const existing = await getMatch({ organizationId, applicationId });

  if (existing && !existing.is_stale) return { match: existing, calculated: false };
  if (!allowCalculate) return { match: existing, calculated: false };

  const result = await calculateAndStoreMatch({ organizationId, applicationId });
  if (!result.ok) return { match: existing, calculated: false };

  return {
    match: await getMatch({ organizationId, applicationId }),
    calculated: true,
  };
}
