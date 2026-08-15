"use client";

// =============================================================================
// Applications list filters.
//
// All state lives in the URL, so a filtered view is shareable and the server
// component re-runs the query rather than the browser filtering a page of rows
// it already has.
//
// THE STAGE LIST NARROWS WITH THE JOB FILTER. Different jobs now run different
// stages (job_hiring_stages), so a global list is right when looking across
// jobs and wrong once one job is chosen — offering "Written Assessment" for a
// job that never runs one guarantees an empty result and no explanation.
// =============================================================================

import { useEffect, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Search } from "lucide-react";
import { APPLICATION_STAGES, STAGE_LABELS, type ApplicationStage } from "@/lib/applications/stages";
import { flagsFromRows, effectiveStages, visibleStages } from "@/lib/applications/effectiveStages";
import { PHASE_LABELS, PIPELINE_PHASES } from "@/lib/applications/phase";

export function ApplicationFilters({ jobs }: { jobs: { id: string; title: string }[] }) {
  const router = useRouter();
  const searchParams = useSearchParams();

  const activeStage = searchParams.get("stage") ?? "";
  const activeJob = searchParams.get("job_id") ?? "";
  const sort = searchParams.get("sort") === "updated" ? "updated" : "stage";
  const showArchived = searchParams.get("archived") === "true";
  const hasFilters = Array.from(searchParams.keys()).length > 0;

  const activeQuery = searchParams.get("q") ?? "";

  /**
   * The search box is UNCONTROLLED, with the URL value as its default and as
   * its `key`.
   *
   * A controlled input would need an effect to re-seed it when the URL changes
   * (back button, Clear filters), and setting state inside an effect causes the
   * cascading render the lint rule is there to prevent. Remounting on the key
   * achieves the same reset with no state at all.
   */
  const searchRef = useRef<HTMLInputElement>(null);

  /**
   * Which stages the chosen job runs. Null means "not narrowed" — either no job
   * is selected or its flags could not be read.
   *
   * Keyed by job id rather than reset in an effect, so switching jobs cannot
   * briefly show the previous job's stages.
   */
  const [jobStages, setJobStages] = useState<{
    jobId: string;
    stages: ApplicationStage[];
  } | null>(null);

  useEffect(() => {
    if (!activeJob) return;

    let cancelled = false;
    (async () => {
      try {
        const response = await fetch(`/api/jobs/${activeJob}/hiring-stages`);
        if (!response.ok) throw new Error("failed");
        const payload = await response.json();
        if (cancelled) return;

        setJobStages({
          jobId: activeJob,
          stages: visibleStages(effectiveStages({ flags: flagsFromRows(payload.data ?? []) })),
        });
      } catch {
        // Falls through to the full list rather than an empty dropdown: a
        // filter that offers nothing is worse than one that offers too much.
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [activeJob]);

  // Only trust the loaded stages if they belong to the job currently selected.
  const narrowed = jobStages && jobStages.jobId === activeJob ? jobStages.stages : null;

  function apply(changes: Record<string, string | null>) {
    const next = new URLSearchParams(searchParams.toString());
    for (const [key, value] of Object.entries(changes)) {
      if (value === null || value === "") next.delete(key);
      else next.set(key, value);
    }
    router.push(`/applications?${next.toString()}`);
  }

  // Terminal exits stay offered whatever the job runs — an application can be
  // rejected from anywhere, so filtering for them is always meaningful.
  const stageOptions: ApplicationStage[] = narrowed
    ? [...narrowed, "rejected", "withdrawn"]
    : [...APPLICATION_STAGES];

  return (
    <div className="card mb-4">
      <div className="columns is-vcentered is-variable is-2">
        <div className="column is-one-quarter">
          <label className="label" style={{ fontSize: 13 }} htmlFor="job-filter">
            Job
          </label>
          <div className="select is-fullwidth">
            <select
              id="job-filter"
              value={activeJob}
              onChange={(event) => {
                const nextJob = event.target.value || null;
                // Clear a stage the new job does not run, rather than leaving a
                // filter combination that can only return zero rows.
                const keepStage =
                  !nextJob || !activeStage || stageOptions.includes(activeStage as ApplicationStage);
                apply({ job_id: nextJob, stage: keepStage ? activeStage || null : null });
              }}
            >
              <option value="">All jobs</option>
              {jobs.map((job) => (
                <option key={job.id} value={job.id}>
                  {job.title}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div className="column is-narrow">
          <label className="label" style={{ fontSize: 13 }} htmlFor="phase-filter">
            Phase
          </label>
          <div className="select is-fullwidth">
            <select
              id="phase-filter"
              value={searchParams.get("phase") ?? ""}
              onChange={(event) => apply({ phase: event.target.value || null })}
            >
              <option value="">All phases</option>
              {PIPELINE_PHASES.map((phase) => (
                <option key={phase} value={phase}>
                  {PHASE_LABELS[phase]}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div className="column is-one-quarter">
          <label className="label" style={{ fontSize: 13 }} htmlFor="stage-filter">
            Stage
          </label>
          <div className="select is-fullwidth">
            <select
              id="stage-filter"
              value={activeStage}
              onChange={(event) => apply({ stage: event.target.value || null })}
            >
              <option value="">All stages</option>
              {stageOptions.map((stage) => (
                <option key={stage} value={stage}>
                  {STAGE_LABELS[stage]}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div className="column">
          <label className="label" style={{ fontSize: 13 }} htmlFor="candidate-search">
            Candidate
          </label>
          <form
            className="applications-search"
            onSubmit={(event) => {
              event.preventDefault();
              apply({ q: searchRef.current?.value.trim() || null });
            }}
          >
            <Search size={14} aria-hidden="true" className="applications-search__icon" />
            <input
              key={activeQuery}
              ref={searchRef}
              id="candidate-search"
              className="input applications-search__input"
              type="search"
              placeholder="Name or email"
              defaultValue={activeQuery}
              // Searching on blur as well as on Enter: a box that only responds
              // to a key people do not know to press is a box they type into and
              // then wonder about.
              onBlur={(event) => {
                const value = event.target.value.trim();
                if (value !== activeQuery) apply({ q: value || null });
              }}
            />
          </form>
        </div>

        <div className="column is-narrow">
          <label className="label" style={{ fontSize: 13 }} htmlFor="sort-toggle">
            Sort
          </label>
          <div className="select is-fullwidth">
            <select
              id="sort-toggle"
              value={sort}
              onChange={(event) =>
                // "stage" is the default, so it is absent from the URL.
                apply({ sort: event.target.value === "updated" ? "updated" : null })
              }
            >
              <option value="stage">Stage order</option>
              <option value="updated">Last updated</option>
            </select>
          </div>
        </div>
      </div>

      <div className="is-flex is-align-items-center" style={{ gap: "var(--space-4)" }}>
        <label className="checkbox" style={{ fontSize: 13 }}>
          <input
            type="checkbox"
            checked={showArchived}
            onChange={(event) => apply({ archived: event.target.checked ? "true" : null })}
          />{" "}
          Show archived
        </label>

        {hasFilters && (
          <button
            type="button"
            className="text-link"
            onClick={() => router.push("/applications")}
          >
            Clear filters
          </button>
        )}

        {narrowed && (
          <span className="has-text-secondary" style={{ fontSize: "var(--text-caption)" }}>
            Showing this job&apos;s {narrowed.length} stages.
          </span>
        )}
      </div>
    </div>
  );
}
