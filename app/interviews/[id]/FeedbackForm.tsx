"use client";

// Structured feedback capture.
//
// Rating and recommendation are both required. An interview that produced
// neither is a note, not feedback — and Module 16's interview-to-offer
// conversion depends on the recommendation actually being filled in.
import { useState } from "react";
import { useRouter } from "next/navigation";
import { FormError } from "@/components/states";
import { RECOMMENDATIONS, RECOMMENDATION_LABELS, type Recommendation } from "@/lib/interviews/feedback";

export function FeedbackForm({
  interviewId,
  existing,
  canSubmit,
  blockedReason,
}: {
  interviewId: string;
  existing: { rating: number; recommendation: Recommendation; notes: string | null } | null;
  canSubmit: boolean;
  blockedReason: string | null;
}) {
  const router = useRouter();
  const [rating, setRating] = useState<number>(existing?.rating ?? 0);
  const [recommendation, setRecommendation] = useState<Recommendation | "">(
    existing?.recommendation ?? ""
  );
  const [notes, setNotes] = useState(existing?.notes ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!canSubmit) {
    return (
      <p className="has-text-secondary" style={{ fontSize: 14 }}>
        {blockedReason ?? "Your role can read feedback but not submit it."}
      </p>
    );
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);

    const response = await fetch(`/api/interviews/${interviewId}/feedback`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ rating, recommendation, notes }),
    });

    setBusy(false);

    if (!response.ok) {
      const payload = await response.json().catch(() => null);
      setError(payload?.error ?? "Could not save that feedback.");
      return;
    }

    router.refresh();
  }

  return (
    <form onSubmit={submit}>
      <FormError message={error} />

      <div className="field">
        <label className="label" style={{ fontSize: 13 }}>
          Rating
        </label>
        <div className="buttons has-addons">
          {[1, 2, 3, 4, 5].map((value) => (
            <button
              key={value}
              type="button"
              className={`button is-small ${rating === value ? "is-primary" : ""}`}
              onClick={() => setRating(value)}
              disabled={busy}
              aria-pressed={rating === value}
            >
              {value}
            </button>
          ))}
        </div>
        <p className="help has-text-secondary">1 is weakest, 5 is strongest.</p>
      </div>

      <div className="field">
        <label className="label" style={{ fontSize: 13 }} htmlFor="recommendation">
          Recommendation
        </label>
        <div className="select is-fullwidth">
          <select
            id="recommendation"
            value={recommendation}
            onChange={(event) => setRecommendation(event.target.value as Recommendation)}
            disabled={busy}
          >
            <option value="">Choose…</option>
            {RECOMMENDATIONS.map((option) => (
              <option key={option} value={option}>
                {RECOMMENDATION_LABELS[option]}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div className="field">
        <label className="label" style={{ fontSize: 13 }} htmlFor="notes">
          Notes
        </label>
        <textarea
          id="notes"
          className="textarea"
          rows={5}
          maxLength={5000}
          placeholder="What you covered, what they demonstrated, anything still open."
          value={notes}
          onChange={(event) => setNotes(event.target.value)}
          disabled={busy}
        />
      </div>

      <button
        type="submit"
        className={`button is-primary ${busy ? "is-loading" : ""}`}
        disabled={busy || rating === 0 || recommendation === ""}
      >
        {existing ? "Update feedback" : "Submit feedback"}
      </button>

      {existing && (
        <p className="has-text-secondary mt-2" style={{ fontSize: 12 }}>
          You already submitted feedback. Saving replaces your own; other interviewers&apos; entries
          are untouched.
        </p>
      )}
    </form>
  );
}

/** Cancel an interview, with a required reason. */
export function CancelInterview({ interviewId }: { interviewId: string }) {
  const router = useRouter();
  const [confirming, setConfirming] = useState(false);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function cancel() {
    setBusy(true);
    setError(null);

    const response = await fetch(`/api/interviews/${interviewId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: "cancelled", cancelled_reason: reason }),
    });

    setBusy(false);

    if (!response.ok) {
      const payload = await response.json().catch(() => null);
      setError(payload?.error ?? "Could not cancel that interview.");
      return;
    }

    setConfirming(false);
    router.refresh();
  }

  if (!confirming) {
    return (
      <button
        type="button"
        className="button is-small"
        style={{ color: "var(--color-error)" }}
        onClick={() => setConfirming(true)}
      >
        Cancel interview
      </button>
    );
  }

  return (
    <div>
      <FormError message={error} />
      {/* A cancelled interview is part of the record of how a candidate was
          treated, so "why" is captured alongside "when". */}
      <div className="field">
        <label className="label" style={{ fontSize: 13 }} htmlFor="cancel-reason">
          Why is it being cancelled?
        </label>
        <input
          id="cancel-reason"
          className="input"
          type="text"
          value={reason}
          onChange={(event) => setReason(event.target.value)}
          placeholder="e.g. Candidate withdrew, interviewer unavailable"
        />
      </div>
      <div className="buttons">
        <button
          type="button"
          className={`button is-small ${busy ? "is-loading" : ""}`}
          style={{ background: "var(--color-error)", color: "#fff" }}
          onClick={cancel}
          disabled={busy || reason.trim().length === 0}
        >
          Confirm cancellation
        </button>
        <button
          type="button"
          className="button is-small"
          onClick={() => setConfirming(false)}
          disabled={busy}
        >
          Keep it
        </button>
      </div>
    </div>
  );
}
