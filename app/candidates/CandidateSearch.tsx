"use client";

// Natural-language search plus the equivalent manual filters, deliberately side
// by side.
//
// The AI path returns the FILTERS it inferred, which are displayed back to the
// recruiter — so a misreading is visible and correctable rather than silently
// trusted. Both paths hit the same query, so results are identical for
// equivalent filters.
import { useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { ChevronUp, Sparkles, SlidersHorizontal, X } from "lucide-react";
import { CANDIDATE_SOURCES, CANDIDATE_SOURCE_LABELS, type Candidate } from "@/lib/types";
import type { CandidateFilters } from "@/lib/candidates/filters";

export type SearchResult = {
  candidates: Candidate[];
  interpretation: string[];
  total: number;
};

export function CandidateSearch({
  onResults,
}: {
  onResults: (result: SearchResult | null) => void;
}) {
  const router = useRouter();
  const searchParams = useSearchParams();

  const [query, setQuery] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showFilters, setShowFilters] = useState(false);

  async function runSearch(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);

    try {
      const response = await fetch("/api/candidates/search", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query }),
      });
      const payload = await response.json().catch(() => null);

      if (!response.ok) {
        // Degrade to the manual filters rather than showing wrong results.
        setError(
          payload?.error ??
            "Couldn't run that search. Use the filters below instead."
        );
        setShowFilters(true);
        onResults(null);
        return;
      }

      onResults({
        candidates: payload.data as Candidate[],
        interpretation: payload.interpretation as string[],
        total: payload.total as number,
      });
    } catch {
      setError("Couldn't reach the AI service. Use the filters below instead.");
      setShowFilters(true);
      onResults(null);
    } finally {
      setBusy(false);
    }
  }

  function applyManualFilters(changes: Record<string, string | null>) {
    const next = new URLSearchParams(searchParams.toString());
    for (const [key, value] of Object.entries(changes)) {
      if (value === null || value === "") next.delete(key);
      else next.set(key, value);
    }
    onResults(null);
    setQuery("");
    router.push(`/candidates?${next.toString()}`);
  }

  const hasManualFilters = Array.from(searchParams.keys()).length > 0;

  // The submit guard is unchanged — under three characters there is nothing to
  // infer from. What changed is that the button now LOOKS disabled only in that
  // case, instead of looking permanently half-off.
  const canSearch = query.trim().length >= 3;

  return (
    <div className="card nl-search">
      <form onSubmit={runSearch}>
        <label className="label" htmlFor="nl-search">
          Search in plain language
        </label>

        <div className="nl-search__row">
          {/*
            The sparkle sits INSIDE the field, before the caret. A badge beside
            the label would say "this feature is AI"; an icon in the field says
            "type a sentence here", which is the thing people get wrong — they
            type "Java" and get literal-keyword expectations.
          */}
          <div className="nl-search__field">
            <Sparkles
              size={16}
              strokeWidth={2}
              aria-hidden="true"
              className="nl-search__spark"
            />
            <input
              id="nl-search"
              className="input nl-search__input"
              type="search"
              placeholder="e.g. Java candidates in Gurgaon with 4-7 years and less than 45 days notice"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
            />
          </div>

          <button
            type="submit"
            className={`button is-primary nl-search__submit ${busy ? "is-loading" : ""}`}
            disabled={busy || !canSearch}
            // Says why it is dimmed, rather than leaving the user to guess that
            // search is broken.
            title={canSearch ? undefined : "Describe who you're looking for to search"}
          >
            Search
          </button>
        </div>
      </form>

      {error && (
        <p className="nl-search__error" role="alert">
          {error}
        </p>
      )}

      {/*
        Secondary route to the same results, so it reads as one: a text link
        under the field, not a filled block competing with Search.
      */}
      <div className="nl-search__actions">
        <button
          type="button"
          className="text-link"
          onClick={() => setShowFilters((current) => !current)}
          aria-expanded={showFilters}
          aria-controls="candidate-filters"
        >
          {showFilters ? (
            <ChevronUp size={14} aria-hidden="true" />
          ) : (
            <SlidersHorizontal size={14} aria-hidden="true" />
          )}
          {showFilters ? "Hide filters" : "Use filters instead"}
        </button>

        {hasManualFilters && (
          <Link className="text-link" href="/candidates">
            <X size={14} aria-hidden="true" />
            Clear filters
          </Link>
        )}
      </div>

      {showFilters && (
        <div id="candidate-filters" className="columns is-multiline is-variable is-2 mt-3">
          <div className="column is-one-third">
            <label className="label" style={{ fontSize: 13 }} htmlFor="f-skills">
              Skills (comma separated)
            </label>
            <input
              id="f-skills"
              className="input"
              type="text"
              defaultValue={searchParams.get("skills") ?? ""}
              onBlur={(event) => applyManualFilters({ skills: event.target.value || null })}
            />
          </div>
          <div className="column is-one-quarter">
            <label className="label" style={{ fontSize: 13 }} htmlFor="f-location">
              Location
            </label>
            <input
              id="f-location"
              className="input"
              type="text"
              defaultValue={searchParams.get("location") ?? ""}
              onBlur={(event) => applyManualFilters({ location: event.target.value || null })}
            />
          </div>
          <div className="column is-one-fifth">
            <label className="label" style={{ fontSize: 13 }} htmlFor="f-exp-min">
              Experience from
            </label>
            <input
              id="f-exp-min"
              className="input"
              type="number"
              min={0}
              defaultValue={searchParams.get("exp_min") ?? ""}
              onBlur={(event) => applyManualFilters({ exp_min: event.target.value || null })}
            />
          </div>
          <div className="column is-one-fifth">
            <label className="label" style={{ fontSize: 13 }} htmlFor="f-exp-max">
              Experience to
            </label>
            <input
              id="f-exp-max"
              className="input"
              type="number"
              min={0}
              defaultValue={searchParams.get("exp_max") ?? ""}
              onBlur={(event) => applyManualFilters({ exp_max: event.target.value || null })}
            />
          </div>
          <div className="column is-one-quarter">
            <label className="label" style={{ fontSize: 13 }} htmlFor="f-notice">
              Notice up to (days)
            </label>
            <input
              id="f-notice"
              className="input"
              type="number"
              min={0}
              defaultValue={searchParams.get("notice_max") ?? ""}
              onBlur={(event) => applyManualFilters({ notice_max: event.target.value || null })}
            />
          </div>
          <div className="column is-one-quarter">
            <label className="label" style={{ fontSize: 13 }} htmlFor="f-source">
              Source
            </label>
            <div className="select is-fullwidth">
              <select
                id="f-source"
                defaultValue={searchParams.get("source") ?? ""}
                onChange={(event) => applyManualFilters({ source: event.target.value || null })}
              >
                <option value="">Any source</option>
                {CANDIDATE_SOURCES.map((source) => (
                  <option key={source} value={source}>
                    {CANDIDATE_SOURCE_LABELS[source]}
                  </option>
                ))}
              </select>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/** Shows how a natural-language query was interpreted, so it can be corrected. */
export function SearchInterpretation({
  interpretation,
  total,
  onClear,
}: {
  interpretation: string[];
  total: number;
  onClear: () => void;
}) {
  return (
    <div className="ai-panel mb-4">
      <div className="is-flex is-justify-content-space-between is-align-items-center">
        <div>
          <p style={{ fontSize: 13, fontWeight: 600, color: "var(--color-info)" }}>
            Searched for candidates
          </p>
          <p style={{ fontSize: 14 }}>
            {interpretation.length > 0 ? interpretation.join(", ") : "no constraints"} — {total}{" "}
            {total === 1 ? "match" : "matches"}
          </p>
        </div>
        <button type="button" className="button is-small" onClick={onClear}>
          Clear
        </button>
      </div>
      <p className="has-text-secondary mt-2" style={{ fontSize: 12 }}>
        AI turned your sentence into these filters and the normal search ran. If that reading is
        wrong, rephrase or use the filters.
      </p>
    </div>
  );
}

export type { CandidateFilters };
