"use client";

// Client wrapper so natural-language results can replace the server-rendered
// list in place. The server list is the default; a search overlays it and
// "Clear" restores it without a round trip.
import { useState } from "react";
import Link from "next/link";
import { SearchX, UserRoundPlus } from "lucide-react";
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

  // "Nobody has been added" vs "nothing matched" — same zero rows, different
  // message and different call to action.
  const noCandidatesAtAll = !search && !hasFilters;

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

      {/*
        `is-state-host` drops the card's own 24px top/bottom padding while it
        holds an empty state, because the state brings its own 48px. Stacked,
        the two made 72px of dead space above and below three short elements —
        the "much taller than its content needs" box in the brief.
      */}
      <div className={`card${rows.length === 0 ? " is-state-host" : ""}`}>
        {rows.length === 0 ? (
          /*
            Three different empty states, not one.

            "Nothing here yet" and "your search found nothing" are different
            facts and want different pictures: a person icon in a brand tint is
            an invitation to add someone; a struck-through magnifier for a
            fruitless search, in neutral grey, because nothing is wrong.

            The no-results cases are `compact` — there is no action to frame, so
            the tall version left an icon adrift in white space.
          */
          noCandidatesAtAll ? (
            <EmptyState
              icon={UserRoundPlus}
              accent="primary"
              compact
              /*
                The copy is yours, word for word — only the sentence break moved.
                "No candidates yet." is the headline it already was; the rest is
                the helper line. Repeating "No candidates yet" in both slots was
                the alternative, and it read as a stutter.
              */
              headline="No candidates yet"
              message="Add one manually, or paste their details and let AI structure them."
              action={
                canCreate ? (
                  /* Identical copy, casing and style to the header button —
                     one action, shown twice, not two similar ones. */
                  <Link className="button is-primary" href="/candidates/new">
                    Add candidate
                  </Link>
                ) : undefined
              }
            />
          ) : (
            <EmptyState
              icon={SearchX}
              compact
              headline={search ? "No matches" : "No candidates match these filters"}
              message={
                search
                  ? "No candidates match that search. Try describing it differently, or use the filters."
                  : "Nothing matches this combination. Clear a filter to widen the results."
              }
            />
          )
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
