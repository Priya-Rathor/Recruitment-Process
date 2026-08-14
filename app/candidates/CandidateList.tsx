"use client";

// Client wrapper so natural-language results can replace the server-rendered
// list in place. The server list is the default; a search overlays it and
// "Clear" restores it without a round trip.
import { useState } from "react";
import Link from "next/link";
import { EmptyState } from "@/components/states";
import { CANDIDATE_SOURCE_LABELS, type Candidate } from "@/lib/types";
import { CandidateSearch, SearchInterpretation, type SearchResult } from "./CandidateSearch";

function formatExperience(years: number | null): string {
  if (years === null) return "—";
  return `${years} yr${years === 1 ? "" : "s"}`;
}

function formatNotice(days: number | null): string {
  if (days === null) return "—";
  if (days === 0) return "Immediate";
  return `${days} days`;
}

export function CandidateList({
  candidates,
  total,
  canCreate,
  hasFilters,
}: {
  candidates: Candidate[];
  total: number;
  canCreate: boolean;
  hasFilters: boolean;
}) {
  const [search, setSearch] = useState<SearchResult | null>(null);

  const rows = search ? search.candidates : candidates;
  const shownTotal = search ? search.total : total;

  return (
    <>
      <CandidateSearch onResults={setSearch} />

      {search && (
        <SearchInterpretation
          interpretation={search.interpretation}
          total={search.total}
          onClear={() => setSearch(null)}
        />
      )}

      <div className="card">
        {rows.length === 0 ? (
          <EmptyState
            message={
              search
                ? "No candidates match that search."
                : hasFilters
                  ? "No candidates match these filters."
                  : "No candidates yet. Add one manually, or paste their details and let AI structure them."
            }
            action={
              !search && !hasFilters && canCreate ? (
                <Link className="button is-primary" href="/candidates/new">
                  Add a candidate
                </Link>
              ) : undefined
            }
          />
        ) : (
          <>
            <p className="has-text-secondary mb-3" style={{ fontSize: 13 }}>
              {rows.length === shownTotal
                ? `${shownTotal} ${shownTotal === 1 ? "candidate" : "candidates"}`
                : `Showing ${rows.length} of ${shownTotal} candidates`}
            </p>

            <div className="table-container">
              <table className="table is-fullwidth is-hoverable">
                <thead>
                  <tr>
                    <th>Name</th>
                    <th>Current role</th>
                    <th>Experience</th>
                    <th>Location</th>
                    <th>Notice</th>
                    <th>Source</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((candidate) => (
                    <tr key={candidate.id}>
                      <td>
                        <Link href={`/candidates/${candidate.id}`} style={{ fontWeight: 600 }}>
                          {candidate.name}
                        </Link>
                        {candidate.archived_at && (
                          <span className="tag is-light ml-2" style={{ fontSize: 11 }}>
                            Archived
                          </span>
                        )}
                        {candidate.skills.length > 0 && (
                          <p className="has-text-secondary" style={{ fontSize: 12 }}>
                            {candidate.skills.slice(0, 4).join(" · ")}
                            {candidate.skills.length > 4 && " …"}
                          </p>
                        )}
                      </td>
                      <td className="has-text-secondary" style={{ fontSize: 13 }}>
                        {candidate.current_role ?? "—"}
                        {candidate.current_company && (
                          <p style={{ fontSize: 12 }}>{candidate.current_company}</p>
                        )}
                      </td>
                      <td className="has-text-secondary" style={{ fontSize: 13 }}>
                        {formatExperience(candidate.total_experience_years)}
                      </td>
                      <td className="has-text-secondary" style={{ fontSize: 13 }}>
                        {candidate.location ?? "—"}
                      </td>
                      <td className="has-text-secondary" style={{ fontSize: 13 }}>
                        {formatNotice(candidate.notice_period_days)}
                      </td>
                      <td className="has-text-secondary" style={{ fontSize: 13 }}>
                        {CANDIDATE_SOURCE_LABELS[candidate.source]}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </div>
    </>
  );
}
