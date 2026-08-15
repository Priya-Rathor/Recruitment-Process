// =============================================================================
// Every application a candidate holds, with its evaluation data rolled up.
//
// A READ-ONLY consolidation. No entry is logged here and no stage is moved
// here — the Application detail page owns all of that, and this section links
// out to it. Two places that can both write the same row is how they drift.
//
// THE STAGE-VISIBILITY RULE IS NOT REIMPLEMENTED. Which of the four
// configurable stages a given application shows depends on that application's
// JOB (job_hiring_stages), and the answer already exists as a pure function:
// effectiveStages() in lib/applications/effectiveStages.ts, built for the
// Application Evaluation panel. This module calls it — the same call, the same
// entry counts, the same "disabled but has history stays visible" rule. So a
// candidate with two applications to two differently configured jobs shows two
// genuinely different sets of sections, and neither can drift from what the
// Application page shows for the same application.
//
// SERVER-ONLY. The types, labels and pure helpers live in
// applicationHistoryView.ts, because the component that renders these cards is
// a client component and this module imports lib/supabase/server.
// =============================================================================
import { listApplications } from "@/lib/applications/queries";
import { listJobStages } from "@/lib/hiring-stages/queries";
import { listEvaluationEntries } from "@/lib/applications/evaluationQueries";
import { countByStage, groupByStage } from "@/lib/applications/evaluations";
import { effectiveStages, flagsFromRows, visibleStages } from "@/lib/applications/effectiveStages";
import { outcomeOf, type ApplicationHistoryCard } from "@/lib/candidates/applicationHistoryView";
import type { OrgRole } from "@/lib/types";

/**
 * Every application for one candidate, newest first, each with its own
 * evaluation rollup.
 *
 * One round trip per application for its stages and entries. Deliberate: a
 * candidate holds a handful of applications, not hundreds, and the alternative
 * — one big join — would have to re-derive the stage-visibility rule in SQL,
 * which is precisely the duplication this module exists to avoid.
 *
 * Archived applications are INCLUDED. This is a history; hiding the ones
 * somebody tidied away would make it an incomplete one.
 */
export async function listCandidateApplicationHistory({
  organizationId,
  candidateId,
  viewerRole,
  viewerId,
}: {
  organizationId: string;
  candidateId: string;
  viewerRole: OrgRole;
  viewerId: string;
}): Promise<ApplicationHistoryCard[]> {
  const { applications } = await listApplications({
    organizationId,
    filters: { candidateId, includeArchived: true, sort: "updated" },
    viewerRole,
    viewerId,
    limit: 50,
  });

  return Promise.all(
    applications.map(async (application) => {
      const [stageRows, entries] = await Promise.all([
        listJobStages({ organizationId, jobId: application.job_id }),
        listEvaluationEntries({ organizationId, applicationId: application.id }),
      ]);

      // THE SHARED CALL. Same function the Application page's Evaluation panel
      // uses, same arguments, same result.
      const availability = effectiveStages({
        flags: flagsFromRows(stageRows),
        entryCounts: countByStage(entries),
        currentStage: application.stage,
      });

      return {
        applicationId: application.id,
        jobId: application.job_id,
        jobTitle: application.job_title,
        stage: application.stage,
        matchScore: application.match_score,
        updatedAt: application.updated_at,
        outcome: outcomeOf(application.stage, application.rejected_at_stage),
        availability,
        visible: visibleStages(availability),
        entriesByStage: groupByStage(entries),
        totalEntries: entries.length,
      };
    })
  );
}

// Re-exported so a server caller needs one import. The definitions live in the
// view module because the client component that renders these cards cannot
// import anything that reaches lib/supabase/server.
export {
  OUTCOME_LABELS,
  OUTCOME_TONE,
  mostRecent,
  outcomeOf,
  type ApplicationHistoryCard,
  type ApplicationOutcome,
} from "@/lib/candidates/applicationHistoryView";
