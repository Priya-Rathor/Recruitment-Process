"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { FormError } from "@/components/states";

/**
 * Review & Activate.
 *
 * The spec's phrase, and the point in the product where a rule stops being a
 * description and starts acting on people. So activation shows what the rule
 * will do, in words, and takes a second click when it can telephone someone.
 *
 * The API refuses activation independently — a disconnected integration, an
 * unwired trigger, or the wrong role — so this panel is the explanation, not the
 * enforcement.
 */
export function ActivationPanel({
  automationId,
  status,
  summary,
  contactsCandidates,
  draftedByAi,
}: {
  automationId: string;
  status: "draft" | "active" | "paused";
  summary: string;
  contactsCandidates: boolean;
  draftedByAi: boolean;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);

  async function setStatus(next: "active" | "paused" | "draft") {
    setBusy(true);
    setError(null);

    try {
      const response = await fetch(`/api/automations/${automationId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: next }),
      });
      const payload = await response.json();

      if (!response.ok) {
        setError(payload.error ?? "Couldn't change the status.");
        return;
      }

      setConfirming(false);
      router.refresh();
    } catch {
      setError("Couldn't change the status. Check your connection and try again.");
    } finally {
      setBusy(false);
    }
  }

  if (status === "active") {
    return (
      <div className="card mb-4" style={{ borderColor: "var(--color-success)" }}>
        <h2 className="title is-5 mb-2">This automation is live</h2>
        <p className="mb-3" style={{ fontSize: 14 }}>
          {summary}
        </p>
        <button
          type="button"
          className={`button ${busy ? "is-loading" : ""}`}
          onClick={() => setStatus("paused")}
          disabled={busy}
        >
          Pause
        </button>
        <FormError message={error} />
      </div>
    );
  }

  return (
    <div className="card mb-4">
      <h2 className="title is-5 mb-2">Review &amp; activate</h2>

      <p className="mb-3" style={{ fontSize: 14 }}>
        {summary}
      </p>

      {draftedByAi && (
        <p className="has-text-secondary mb-3" style={{ fontSize: 13 }}>
          This rule was drafted by AI. Read it once more before turning it on — nothing has run yet.
        </p>
      )}

      {contactsCandidates && (
        <p className="mb-3" style={{ fontSize: 13, color: "var(--status-attention-text, var(--status-attention-text))" }}>
          Once active, this rule will telephone candidates without anyone approving each call. It
          runs at most once per application per stage-entry, and every attempt is recorded.
        </p>
      )}

      <FormError message={error} />

      {confirming ? (
        <div className="is-flex" style={{ gap: "0.5rem" }}>
          <button
            type="button"
            className={`button is-primary ${busy ? "is-loading" : ""}`}
            onClick={() => setStatus("active")}
            disabled={busy}
          >
            Yes, activate it
          </button>
          <button type="button" className="button" onClick={() => setConfirming(false)}>
            Cancel
          </button>
        </div>
      ) : (
        <button
          type="button"
          className={`button is-primary ${busy && !contactsCandidates ? "is-loading" : ""}`}
          onClick={() => (contactsCandidates ? setConfirming(true) : setStatus("active"))}
          disabled={busy}
        >
          Activate
        </button>
      )}
    </div>
  );
}
