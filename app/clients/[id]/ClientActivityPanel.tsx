"use client";

// AI activity summary for the account manager. Internal, and opt-in so it costs
// a call only when someone actually wants it.
import { useState } from "react";

export function ClientActivityPanel({ clientId }: { clientId: string }) {
  const [summary, setSummary] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function generate() {
    setBusy(true);
    setError(null);

    try {
      const response = await fetch(`/api/clients/${clientId}/ai-action`, { method: "POST" });
      const payload = await response.json().catch(() => null);

      if (!response.ok) {
        // The metrics below are computed, not generated — they stand regardless.
        setError(payload?.error ?? "Couldn't summarise this client. The figures below are unaffected.");
        return;
      }
      setSummary((payload.data as { summary: string }).summary);
    } catch {
      setError("Couldn't reach the AI service. The figures below are unaffected.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="ai-panel mb-4">
      <div className="is-flex is-justify-content-space-between is-align-items-center">
        <p style={{ fontSize: 13, fontWeight: 600, color: "var(--color-info)" }}>
          Account summary
        </p>
        <button
          type="button"
          className={`button is-small ${busy ? "is-loading" : ""}`}
          onClick={generate}
          disabled={busy}
        >
          {summary ? "Refresh" : "Summarise"}
        </button>
      </div>

      {!summary && !error && (
        <p className="has-text-secondary mt-2" style={{ fontSize: 14 }}>
          Where this relationship stands, and what needs chasing.
        </p>
      )}

      {error && (
        <p className="mt-2" style={{ fontSize: 14, color: "var(--color-error)" }} role="alert">
          {error}
        </p>
      )}

      {summary && <p className="mt-2" style={{ fontSize: 15 }}>{summary}</p>}
    </div>
  );
}
