"use client";

// =============================================================================
// Inline candidate picker — "which person is this?"
//
// Used by the intake modal's manual reconnection. Searches by name, email or
// phone through /api/candidates/lookup, which matches identity rather than the
// semantic "find me people like this" search Module 4's filters back.
//
// Debounced at 250ms. Every keystroke firing a query would put ten requests in
// flight for a ten-character name and let an early one land after a later one,
// showing results for a prefix the box no longer contains. The request id check
// below is what makes a late response harmless rather than wrong.
// =============================================================================

import { useEffect, useRef, useState } from "react";
import { Loader2, Search, UserRoundCheck } from "lucide-react";

export type PickerCandidate = {
  id: string;
  name: string;
  email: string | null;
  phone: string | null;
  current_role: string | null;
  current_company: string | null;
  archived_at: string | null;
};

const DEBOUNCE_MS = 250;
const MIN_LENGTH = 2;

function describe(candidate: PickerCandidate): string {
  const role = [candidate.current_role, candidate.current_company].filter(Boolean).join(" · ");
  const contact = [candidate.email, candidate.phone].filter(Boolean).join(" · ");
  return [role, contact].filter(Boolean).join(" — ") || "No other details on file";
}

export function CandidatePicker({
  onPick,
  onCancel,
  busy = false,
  /** Hidden from results — reconnecting to the current candidate is a no-op. */
  excludeId,
  autoFocus = true,
}: {
  onPick: (candidate: PickerCandidate) => void;
  onCancel?: () => void;
  busy?: boolean;
  excludeId?: string | null;
  autoFocus?: boolean;
}) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<PickerCandidate[]>([]);
  const [searching, setSearching] = useState(false);
  const [searched, setSearched] = useState(false);

  // Monotonic request id. A response whose id is not the latest is discarded,
  // so a slow early query cannot overwrite a fast later one.
  const requestId = useRef(0);

  const tooShort = query.trim().length < MIN_LENGTH;

  useEffect(() => {
    const text = query.trim();

    // Nothing is set synchronously in this effect body — a too-short query is
    // handled by NOT rendering results (see `visible` below) rather than by
    // clearing state, which would be a cascading render on every keystroke.
    if (text.length < MIN_LENGTH) return;

    const id = ++requestId.current;

    const timer = setTimeout(async () => {
      setSearching(true);
      try {
        const response = await fetch(`/api/candidates/lookup?q=${encodeURIComponent(text)}`);
        const payload = await response.json().catch(() => null);
        if (id !== requestId.current) return;

        setResults(response.ok ? ((payload?.data as PickerCandidate[]) ?? []) : []);
        setSearched(true);
      } catch {
        if (id !== requestId.current) return;
        setResults([]);
        setSearched(true);
      } finally {
        if (id === requestId.current) setSearching(false);
      }
    }, DEBOUNCE_MS);

    return () => clearTimeout(timer);
  }, [query]);

  // Derived, not stored. Deleting back down to one character hides the previous
  // results without a state update, and re-typing shows them again instantly.
  const visible = tooShort ? [] : results.filter((candidate) => candidate.id !== excludeId);

  return (
    <div className="picker">
      <div className="picker__field">
        <Search size={14} aria-hidden="true" className="picker__icon" />
        <input
          className="input picker__input"
          type="search"
          // Opened by an explicit click on "Connect to existing candidate";
          // the box IS the dialog, so landing outside it would cost a second
          // click before the recruiter could type anything.
          autoFocus={autoFocus}
          placeholder="Search by name, email or phone"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          disabled={busy}
        />
        {searching && <Loader2 size={14} aria-hidden="true" className="intake-spin picker__busy" />}
      </div>

      {visible.length > 0 && (
        <ul className="picker__results">
          {visible.map((candidate) => (
            <li key={candidate.id}>
              <button
                type="button"
                className="picker__result"
                onClick={() => onPick(candidate)}
                disabled={busy}
              >
                <UserRoundCheck size={14} aria-hidden="true" className="picker__result-icon" />
                <span className="picker__result-text">
                  <span className="picker__name">
                    {candidate.name}
                    {/* Archived candidates ARE offered — connecting a resume to
                        someone archived last month is a legitimate correction —
                        but never without saying so. */}
                    {candidate.archived_at && <span className="picker__tag">Archived</span>}
                  </span>
                  <span className="picker__detail">{describe(candidate)}</span>
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}

      {searched && !searching && !tooShort && visible.length === 0 && (
        <p className="picker__empty">
          No candidate matches that. Try their email address or phone number.
        </p>
      )}

      {query.trim().length > 0 && query.trim().length < MIN_LENGTH && (
        <p className="picker__empty">Keep typing — at least two characters.</p>
      )}

      {onCancel && (
        <button type="button" className="text-link picker__cancel" onClick={onCancel} disabled={busy}>
          Cancel
        </button>
      )}
    </div>
  );
}
