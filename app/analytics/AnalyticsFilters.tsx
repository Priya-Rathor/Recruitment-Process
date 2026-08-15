"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  DATE_RANGES,
  RANGE_LABELS,
  filtersToQuery,
  type AnalyticsFilters as Filters,
} from "@/lib/analytics/filters";

/**
 * The filter row.
 *
 * Links rather than a client-side form, so every filter state is a real URL:
 * shareable, bookmarkable, and back-button-correct. It also means the CSV export
 * link carries exactly the filters on screen, which is what makes the spec's
 * "export matches the screen" guarantee visible in the markup rather than
 * asserted in a comment.
 */
export function AnalyticsFilterBar({
  filters,
  jobs,
  clients,
  recruiters,
  canFilterRecruiter,
}: {
  filters: Filters;
  jobs: { id: string; title: string }[];
  clients: { id: string; name: string }[];
  recruiters: { id: string; name: string }[];
  /** A Recruiter is pinned to their own work, so the control is hidden. */
  canFilterRecruiter: boolean;
}) {
  const pathname = usePathname();
  const href = (patch: Partial<Filters>) => `${pathname}${filtersToQuery({ ...filters, ...patch })}`;

  return (
    <div className="card mb-4">
      <div className="buttons mb-3">
        {DATE_RANGES.map((range) => (
          <Link
            key={range}
            className={`button is-small ${filters.range === range ? "is-primary" : ""}`}
            href={href({ range })}
          >
            {RANGE_LABELS[range]}
          </Link>
        ))}
      </div>

      <div className="is-flex" style={{ gap: "0.75rem", flexWrap: "wrap" }}>
        <FilterSelect
          label="Job"
          value={filters.jobId}
          options={jobs.map((job) => ({ value: job.id, label: job.title }))}
          hrefFor={(value) => href({ jobId: value })}
        />

        <FilterSelect
          label="Client"
          value={filters.clientId}
          options={clients.map((client) => ({ value: client.id, label: client.name }))}
          hrefFor={(value) => href({ clientId: value })}
        />

        {canFilterRecruiter && (
          <FilterSelect
            label="Recruiter"
            value={filters.recruiterId}
            options={recruiters.map((recruiter) => ({
              value: recruiter.id,
              label: recruiter.name,
            }))}
            hrefFor={(value) => href({ recruiterId: value })}
          />
        )}

        <div style={{ alignSelf: "flex-end" }}>
          <Link
            className={`button is-small ${filters.compare ? "is-primary" : ""}`}
            href={href({ compare: !filters.compare })}
          >
            {filters.compare ? "Comparing with previous" : "Compare with previous"}
          </Link>
        </div>
      </div>
    </div>
  );
}

/**
 * A select rendered as links.
 *
 * Native <select> would need an onChange handler and client-side navigation;
 * this keeps every state addressable. The list is capped because a team with
 * 500 open jobs would otherwise render 500 links — beyond the cap the filter is
 * still reachable by URL, and a searchable picker is a follow-up.
 */
function FilterSelect({
  label,
  value,
  options,
  hrefFor,
}: {
  label: string;
  value: string | null;
  options: { value: string; label: string }[];
  hrefFor: (value: string | null) => string;
}) {
  if (options.length === 0) return null;

  const selected = options.find((option) => option.value === value);

  return (
    <details style={{ position: "relative" }}>
      <summary
        className="button is-small"
        style={{ listStyle: "none", cursor: "pointer" }}
      >
        {label}: {selected ? selected.label : "All"}
      </summary>

      <div
        className="card"
        style={{
          position: "absolute",
          zIndex: 20,
          marginTop: 4,
          minWidth: 220,
          maxHeight: 320,
          overflowY: "auto",
          padding: 8,
        }}
      >
        <Link
          className="is-block py-1"
          style={{ fontSize: 13, fontWeight: value === null ? 600 : 400 }}
          href={hrefFor(null)}
        >
          All
        </Link>
        {options.slice(0, 100).map((option) => (
          <Link
            key={option.value}
            className="is-block py-1"
            style={{ fontSize: 13, fontWeight: option.value === value ? 600 : 400 }}
            href={hrefFor(option.value)}
          >
            {option.label}
          </Link>
        ))}
        {options.length > 100 && (
          <p className="has-text-secondary py-1" style={{ fontSize: 12 }}>
            Showing the first 100 of {options.length}.
          </p>
        )}
      </div>
    </details>
  );
}
