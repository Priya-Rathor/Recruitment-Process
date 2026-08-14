"use client";

// Stage filter, kept in the URL so a filtered view is shareable and the server
// component re-runs the query rather than filtering in the browser.
import { useRouter, useSearchParams } from "next/navigation";
import { APPLICATION_STAGES, STAGE_LABELS } from "@/lib/applications/stages";

export function ApplicationFilters() {
  const router = useRouter();
  const searchParams = useSearchParams();

  function apply(changes: Record<string, string | null>) {
    const next = new URLSearchParams(searchParams.toString());
    for (const [key, value] of Object.entries(changes)) {
      if (value === null || value === "") next.delete(key);
      else next.set(key, value);
    }
    router.push(`/applications?${next.toString()}`);
  }

  const activeStage = searchParams.get("stage") ?? "";
  const showArchived = searchParams.get("archived") === "true";
  const hasFilters = Array.from(searchParams.keys()).length > 0;

  return (
    <div className="card mb-4">
      <div className="columns is-vcentered is-variable is-2">
        <div className="column is-one-third">
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
              {APPLICATION_STAGES.map((stage) => (
                <option key={stage} value={stage}>
                  {STAGE_LABELS[stage]}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div className="column is-flex is-align-items-flex-end">
          <label className="checkbox" style={{ fontSize: 13 }}>
            <input
              type="checkbox"
              checked={showArchived}
              onChange={(event) => apply({ archived: event.target.checked ? "true" : null })}
            />{" "}
            Show archived
          </label>
        </div>

        <div className="column is-narrow">
          {hasFilters && (
            <button
              type="button"
              className="button is-small"
              onClick={() => router.push("/applications")}
            >
              Clear filters
            </button>
          )}
        </div>
      </div>

      {/* Job and candidate filters exist in the API; the UI exposes them via
          deep links from those modules' detail pages rather than duplicating a
          picker here. */}
      <p className="has-text-secondary" style={{ fontSize: 12 }}>
        Filter by job or candidate from that record&apos;s own page.
      </p>
    </div>
  );
}
