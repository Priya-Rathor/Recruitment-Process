"use client";

import { useState } from "react";
import { FormError } from "@/components/states";

/**
 * "What's happened with Rahul?"
 *
 * On demand, never on page load: it costs an AI call, and the timeline below is
 * already the answer for anyone who wants to read it.
 *
 * When the grounding check rejects a narrative the API returns 422 and this
 * shows the reason. That is deliberately not silent — a recruiter who learns the
 * summary can be wrong will read the timeline, which is the right instinct.
 */
export function NarrativePanel({
  candidateId,
  candidateName,
  eventCount,
}: {
  candidateId: string;
  candidateName: string;
  eventCount: number;
}) {
  const [narrative, setNarrative] = useState<string | null>(null);
  const [meta, setMeta] = useState<{ eventCount: number } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function summarise() {
    setBusy(true);
    setError(null);
    setNarrative(null);

    try {
      const response = await fetch("/api/activity-events/ai-action", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ candidate_id: candidateId }),
      });
      const payload = await response.json();

      if (!response.ok) {
        setError(payload.error ?? "Couldn't generate a summary.");
        return;
      }

      setNarrative(payload.data.narrative);
      setMeta({ eventCount: payload.data.eventCount });
    } catch {
      setError("Couldn't reach the AI service. The timeline below is unaffected.");
    } finally {
      setBusy(false);
    }
  }

  // Below three events the API refuses anyway; saying so up front is better than
  // offering a button that always fails.
  if (eventCount < 3) {
    return (
      <div className="card mb-4">
        <h2 className="title is-5 mb-2">What&apos;s happened with {candidateName}?</h2>
        <p className="has-text-secondary" style={{ fontSize: 13 }}>
          There isn&apos;t enough history yet for a summary to be worth reading — the timeline below
          is shorter than the summary would be.
        </p>
      </div>
    );
  }

  return (
    <div className="card mb-4">
      <h2 className="title is-5 mb-2">What&apos;s happened with {candidateName}?</h2>

      {narrative ? (
        <>
          <p style={{ fontSize: 15 }}>{narrative}</p>
          <p className="has-text-secondary mt-3" style={{ fontSize: 12 }}>
            Written from the {meta?.eventCount ?? eventCount} recorded events below. It cannot
            mention anything that isn&apos;t there — a summary that did is discarded rather than
            shown.
          </p>
          <button
            type="button"
            className={`button is-small mt-3 ${busy ? "is-loading" : ""}`}
            onClick={summarise}
            disabled={busy}
          >
            Regenerate
          </button>
        </>
      ) : (
        <>
          <p className="has-text-secondary mb-3" style={{ fontSize: 13 }}>
            {eventCount} recorded events. Summarise them into a few sentences.
          </p>
          <button
            type="button"
            className={`button is-primary ${busy ? "is-loading" : ""}`}
            onClick={summarise}
            disabled={busy}
          >
            Summarise
          </button>
        </>
      )}

      <FormError message={error} />
    </div>
  );
}
