"use client";

// The manual "Start Screening Call" trigger the spec's forward-stub requires
// until Module 13's automation exists.
//
// Deliberately a two-step confirm. Every other primary button in this product
// changes a database row; this one telephones a real person and records them.
// That deserves a beat.
import { useState } from "react";
import { useRouter } from "next/navigation";
import { FormError } from "@/components/states";

export function StartCallPanel({
  applicationId,
  candidateName,
  candidatePhone,
  canStart,
  blockedReason,
}: {
  applicationId: string;
  candidateName: string;
  candidatePhone: string | null;
  canStart: boolean;
  blockedReason: string | null;
}) {
  const router = useRouter();
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function start() {
    setBusy(true);
    setError(null);

    const response = await fetch(`/api/applications/${applicationId}/screening-call`, {
      method: "POST",
    });
    setBusy(false);
    setConfirming(false);

    if (!response.ok) {
      const payload = await response.json().catch(() => null);
      setError(payload?.error ?? "Could not start the call.");
      router.refresh();
      return;
    }

    router.refresh();
  }

  if (!canStart) {
    return (
      <p className="has-text-secondary" style={{ fontSize: 14 }}>
        {blockedReason ?? "Your role can view screening calls but not start them."}
      </p>
    );
  }

  if (!candidatePhone) {
    return (
      <p style={{ fontSize: 14, color: "var(--status-attention-text)" }}>
        {candidateName} has no phone number on file, so there is nobody to call. Add one on the
        candidate&apos;s profile first.
      </p>
    );
  }

  return (
    <div>
      <FormError message={error} />

      {!confirming ? (
        <>
          <button
            type="button"
            className="button is-primary"
            onClick={() => setConfirming(true)}
          >
            Start screening call
          </button>
          <p className="has-text-secondary mt-2" style={{ fontSize: 12 }}>
            Calls {candidatePhone}. The opening line tells them the call is automated and may be
            recorded, and offers to end it and have a person contact them instead.
          </p>
        </>
      ) : (
        <div>
          {/* Naming the number and the person makes a misdirected call much
              harder to trigger by accident. */}
          <p className="mb-3" style={{ fontSize: 14 }}>
            Call <strong>{candidateName}</strong> on <strong>{candidatePhone}</strong> now? This
            places a real phone call and records it.
          </p>
          <div className="buttons">
            <button
              type="button"
              className={`button is-primary ${busy ? "is-loading" : ""}`}
              onClick={start}
              disabled={busy}
            >
              Yes, call now
            </button>
            <button
              type="button"
              className="button"
              onClick={() => setConfirming(false)}
              disabled={busy}
            >
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
