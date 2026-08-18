"use client";

// Filters by client, recruiter, status and title — the full set the spec asks
// for. Client filtering landed with Module 12's retrofit.
//
// State lives in the URL so a filtered list is shareable and survives reload,
// and so the server component re-runs the query rather than filtering in the
// browser.
import { useRouter, useSearchParams } from "next/navigation";
import { useState } from "react";
import { JOB_STATUSES, JOB_STATUS_LABELS } from "@/lib/types";

export function JobFilters({
  members,
  clients,
  agencyMode,
}: {
  members: { id: string; name: string; role: string }[];
  clients: { id: string; name: string }[];
  /** False for an in-house organization — there is nothing to filter by. */
  agencyMode: boolean;
}) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [search, setSearch] = useState(searchParams.get("q") ?? "");

  function apply(changes: Record<string, string | null>) {
    const next = new URLSearchParams(searchParams.toString());
    for (const [key, value] of Object.entries(changes)) {
      if (value === null || value === "") next.delete(key);
      else next.set(key, value);
    }
    router.push(`/jobs?${next.toString()}`);
  }

  const activeStatus = searchParams.get("status") ?? "";
  const activeRecruiter = searchParams.get("recruiter_id") ?? "";
  const activeClient = searchParams.get("client_id") ?? "";
  const showArchived = searchParams.get("archived") === "true";
  const hasFilters = Boolean(
    activeStatus || activeRecruiter || activeClient || searchParams.get("q") || showArchived
  );

  return (
    <div className="card mb-4">
      <div className="columns is-multiline is-variable is-2">
        <div className="column is-one-third">
          <label className="label" style={{ fontSize: 13 }} htmlFor="job-search">
            Search title
          </label>
          <form
            onSubmit={(event) => {
              event.preventDefault();
              apply({ q: search.trim() || null });
            }}
          >
            <input
              id="job-search"
              className="input"
              type="search"
              placeholder="e.g. Java Developer"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
            />
          </form>
        </div>

        <div className="column is-one-quarter">
          <label className="label" style={{ fontSize: 13 }} htmlFor="job-status">
            Status
          </label>
          <div className="select is-fullwidth">
            <select
              id="job-status"
              value={activeStatus}
              onChange={(event) => apply({ status: event.target.value || null })}
            >
              <option value="">All statuses</option>
              {JOB_STATUSES.map((status) => (
                <option key={status} value={status}>
                  {JOB_STATUS_LABELS[status]}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div className="column is-one-quarter">
          <label className="label" style={{ fontSize: 13 }} htmlFor="job-recruiter">
            Recruiter
          </label>
          <div className="select is-fullwidth">
            <select
              id="job-recruiter"
              value={activeRecruiter}
              onChange={(event) => apply({ recruiter_id: event.target.value || null })}
            >
              <option value="">All recruiters</option>
              {members.map((member) => (
                <option key={member.id} value={member.id}>
                  {member.name}
                </option>
              ))}
            </select>
          </div>
        </div>

        {agencyMode && (
          <div className="column is-one-quarter">
            <label className="label" style={{ fontSize: 13 }} htmlFor="job-client">
              Client
            </label>
            <div className="select is-fullwidth">
              <select
                id="job-client"
                value={activeClient}
                onChange={(event) => apply({ client_id: event.target.value || null })}
              >
                <option value="">All clients</option>
                {clients.map((client) => (
                  <option key={client.id} value={client.id}>
                    {client.name}
                  </option>
                ))}
              </select>
            </div>
          </div>
        )}

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
      </div>

      <div className="is-flex is-justify-content-flex-end is-align-items-center">
        {hasFilters && (
          <button
            type="button"
            className="button is-small"
            onClick={() => {
              setSearch("");
              router.push("/jobs");
            }}
          >
            Clear filters
          </button>
        )}
      </div>
    </div>
  );
}
