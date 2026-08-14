"use client";

// AI Daily Operations Brief. Rendered above the tiles per spec section 7, and
// always visually marked as AI-generated (Info token) so a manager can tell
// narrative from measured figures.
//
// Generation is opt-in: the spec calls the brief "optional", and the cost model
// chapter warns against AI calls a user can trigger repeatedly, so it is not
// fetched automatically on page load.
import { useState } from "react";
import type { DailyBrief as DailyBriefData } from "@/lib/ai/generateDailyBrief";

export function DailyBrief({ hasAnyData }: { hasAnyData: boolean }) {
  const [brief, setBrief] = useState<DailyBriefData | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function generate() {
    setBusy(true);
    setError(null);

    try {
      const response = await fetch("/api/dashboard/ai-action", { method: "POST" });
      const payload = await response.json().catch(() => null);

      if (!response.ok) {
        // A failed brief must never break the dashboard around it — the tiles
        // and attention queue below stay fully usable.
        setError(payload?.error ?? "Couldn't generate the brief. The figures below are unaffected.");
        return;
      }
      setBrief(payload.data as DailyBriefData);
    } catch {
      setError("Couldn't reach the AI service. The figures below are unaffected.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="ai-panel mb-5">
      <div className="is-flex is-justify-content-space-between is-align-items-center">
        <p style={{ fontSize: 13, fontWeight: 600, color: "var(--color-info)" }}>
          AI daily brief
        </p>
        <button
          type="button"
          className={`button is-small ${busy ? "is-loading" : ""}`}
          onClick={generate}
          disabled={busy}
        >
          {brief ? "Regenerate" : "Generate"}
        </button>
      </div>

      {!brief && !error && (
        <p className="has-text-secondary mt-2" style={{ fontSize: 14 }}>
          {hasAnyData
            ? "Summarise today's figures as a short narrative."
            : "There's no activity to summarise yet today."}
        </p>
      )}

      {error && (
        <p className="mt-2" style={{ fontSize: 14, color: "var(--color-error)" }} role="alert">
          {error}
        </p>
      )}

      {brief && (
        <div className="mt-2">
          <p style={{ fontSize: 15 }}>{brief.summary}</p>
          {brief.focus.length > 0 && (
            <ul className="mt-3" style={{ fontSize: 14, listStyle: "disc", paddingLeft: "1.25rem" }}>
              {brief.focus.map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
          )}
          <p className="has-text-secondary mt-3" style={{ fontSize: 11 }}>
            Generated from the figures shown below. Every number is checked against them before
            display.
          </p>
        </div>
      )}
    </div>
  );
}
