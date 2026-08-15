// Match calculation and persistence. The one place the two halves are run and
// stored together.
import { createClient } from "@/lib/supabase/server";
import { scoreDeterministic, type MatchFinding } from "@/lib/matching/deterministic";
import { combineMatch, type CombinedMatch } from "@/lib/matching/score";
import { matchCandidateToJob } from "@/lib/ai/matchCandidateToJob";
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
      "id, candidate_id, job_id, " +
        "candidate:candidates(skills, total_experience_years, expected_salary, notice_period_days, location, current_role), " +
        "job:jobs(title, required_skills, preferred_skills, experience_min, experience_max, salary_min, salary_max, location, work_mode)"
    )
    .eq("id", applicationId)
    .eq("organization_id", organizationId)
    .maybeSingle();

  if (error || !data) return null;

  const row = data as unknown as {
    candidate: {
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

  // Facts first. No AI involved, cannot fail.
  const deterministic = scoreDeterministic(inputs);

  // Semantics second, and optional.
  let semantic = null;
  let aiError: string | null = null;

  const semanticResult = await matchCandidateToJob({
    jobTitle: inputs.job.title,
    unmatchedRequiredSkills: deterministic.unmatchedRequiredSkills,
    candidateSkills: inputs.candidate.skills,
    candidateCurrentRole: inputs.candidate.currentRole,
  });

  if (semanticResult.ok) {
    semantic = semanticResult.data;
  } else {
    aiError = semanticResult.message;
  }

  const match = combineMatch({ deterministic, semantic });

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
