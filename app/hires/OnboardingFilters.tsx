"use client";

// Filters for the onboarding list. All state lives in the URL, so a filtered
// view is shareable and the server re-runs the query rather than the browser
// hiding rows it already fetched.
import { useRouter, useSearchParams } from "next/navigation";
import { ONBOARDING_STATUSES, ONBOARDING_STATUS_LABELS } from "@/lib/onboarding/documents";

export function OnboardingFilters({
  jobs,
  members,
}: {
  jobs: { id: string; title: string }[];
  members: { id: string; name: string }[];
}) {
  const router = useRouter();
  const searchParams = useSearchParams();

  function setParam(key: string, value: string) {
    const next = new URLSearchParams(searchParams);
    if (value) next.set(key, value);
    else next.delete(key);
    router.push(`/hires${next.toString() ? `?${next}` : ""}`);
  }

  const hasFilters = Array.from(searchParams.keys()).length > 0;

  return (
    <div className="is-flex is-align-items-flex-end mb-4" style={{ gap: "var(--space-3)", flexWrap: "wrap" }}>
      <div className="field mb-0">
        <label className="label" style={{ fontSize: 12 }} htmlFor="onboarding-status">
          Status
        </label>
        <div className="select is-small">
          <select
            id="onboarding-status"
            value={searchParams.get("status") ?? ""}
            onChange={(event) => setParam("status", event.target.value)}
          >
            <option value="">All statuses</option>
            {ONBOARDING_STATUSES.map((status) => (
              <option key={status} value={status}>
                {ONBOARDING_STATUS_LABELS[status]}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div className="field mb-0">
        <label className="label" style={{ fontSize: 12 }} htmlFor="onboarding-assignee">
          Assigned to
        </label>
        <div className="select is-small">
          <select
            id="onboarding-assignee"
            value={searchParams.get("assigned_to") ?? ""}
            onChange={(event) => setParam("assigned_to", event.target.value)}
          >
            <option value="">Anyone</option>
            {/* Its own option, not an absence of one: unassigned records are the
                ones most likely to stall, so they need to be findable. */}
            <option value="unassigned">Unassigned</option>
            {members.map((member) => (
              <option key={member.id} value={member.id}>
                {member.name}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div className="field mb-0">
        <label className="label" style={{ fontSize: 12 }} htmlFor="onboarding-job">
          Job
        </label>
        <div className="select is-small">
          <select
            id="onboarding-job"
            value={searchParams.get("job_id") ?? ""}
            onChange={(event) => setParam("job_id", event.target.value)}
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

      {hasFilters && (
        <button type="button" className="button is-small" onClick={() => router.push("/hires")}>
          Clear filters
        </button>
      )}
    </div>
  );
}
