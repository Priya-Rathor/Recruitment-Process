"use client";

// "Ask Pipeline AI: what should I work on first?"
//
// The answer is a list of LINKS. AI advises; the recruiter clicks. Nothing here
// can move a card, and the panel says so explicitly — a supervisor that quietly
// reorganised the board would be a very different product from the one the spec
// describes.
import { useState } from "react";
import Link from "next/link";
import type { PipelinePriorities } from "@/lib/ai/prioritizePipeline";

export function AskPipelineAI({ jobId }: { jobId?: string | null }) {
  const [result, setResult] = useState<PipelinePriorities | null>(null);
  const [considered, setConsidered] = useState<number>(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function ask() {
    setBusy(true);
    setError(null);

    try {
      const response = await fetch("/api/pipeline/ai-action", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(jobId ? { job_id: jobId } : {}),
      });
      const payload = await response.json().catch(() => null);

      if (!response.ok) {
        // A failed answer must never obscure the board itself.
        setError(
          payload?.error ?? "Couldn't work out priorities. The board below is unaffected."
        );
        return;
      }

      setResult(payload.data as PipelinePriorities);
      setConsidered(payload.itemsConsidered as number);
    } catch {
      setError("Couldn't reach the AI service. The board below is unaffected.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="ai-panel mb-4">
      <div className="is-flex is-justify-content-space-between is-align-items-center">
        <p style={{ fontSize: 13, fontWeight: 600, color: "var(--color-info)" }}>
          Ask Pipeline AI
        </p>
        <button
          type="button"
          className={`button is-small ${busy ? "is-loading" : ""}`}
          onClick={ask}
          disabled={busy}
        >
          {result ? "Ask again" : "What should I work on first?"}
        </button>
      </div>

      {!result && !error && (
        <p className="has-text-secondary mt-2" style={{ fontSize: 14 }}>
          Get a short read on where work is piling up, and which applications to open first.
        </p>
      )}

      {error && (
        <p className="mt-2" style={{ fontSize: 14, color: "var(--color-error)" }} role="alert">
          {error}
        </p>
      )}

      {result && (
        <div className="mt-3">
          <p style={{ fontSize: 15 }}>{result.attentionSummary}</p>

          {result.priorities.length > 0 && (
            <ol className="mt-3" style={{ fontSize: 14, listStyle: "decimal", paddingLeft: "1.25rem" }}>
              {result.priorities.map((item) => (
                <li key={item.applicationId} className="py-1">
                  <Link href={`/applications/${item.applicationId}`}>Open application</Link>
                  <span className="has-text-secondary"> — {item.reason}</span>
                </li>
              ))}
            </ol>
          )}

          <p className="has-text-secondary mt-3" style={{ fontSize: 11 }}>
            Suggestions only — nothing has been moved. Based on the {considered} application
            {considered === 1 ? "" : "s"} you can see.
          </p>
        </div>
      )}
    </div>
  );
}
