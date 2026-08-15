"use client";

// =============================================================================
// Add or edit one evaluation entry.
//
// Only ever opened for a MANUAL stage — phone interview, video interview,
// written assessment, director round. Screening reports and scheduled
// interviews are edited on their own screens, so this form never sees them.
// =============================================================================

import { useState } from "react";
import { useRouter } from "next/navigation";
import { X } from "lucide-react";
import { FormError } from "@/components/states";
import { OUTCOME_LABELS, type EvaluationOutcome, type EvaluationStage } from "@/lib/applications/evaluations";
import { STAGE_LABELS } from "@/lib/applications/stages";

export type EntryDraft = {
  id: string;
  occurredAt: string;
  score: number | null;
  outcome: EvaluationOutcome;
  summary: string;
};

/** ISO timestamp -> the value a datetime-local input wants. */
function toLocalInput(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  const pad = (n: number) => String(n).padStart(2, "0");
  return (
    `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}` +
    `T${pad(date.getHours())}:${pad(date.getMinutes())}`
  );
}

export function EvaluationEntryForm({
  applicationId,
  stage,
  entry,
  onClose,
}: {
  applicationId: string;
  stage: EvaluationStage;
  /** Null when adding. */
  entry: EntryDraft | null;
  onClose: () => void;
}) {
  const router = useRouter();

  const [occurredAt, setOccurredAt] = useState(
    toLocalInput(entry?.occurredAt ?? new Date().toISOString())
  );
  const [score, setScore] = useState<string>(entry?.score === null || entry?.score === undefined ? "" : String(entry.score));
  const [outcome, setOutcome] = useState<EvaluationOutcome>(entry?.outcome ?? "pending");
  const [summary, setSummary] = useState(entry?.summary ?? "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save() {
    setSaving(true);
    setError(null);

    const payload = {
      stage_key: stage,
      // Sent as an absolute instant. The input is local time, so this is where
      // the browser's offset is applied — once, here, rather than guessed at
      // read time.
      occurred_at: occurredAt ? new Date(occurredAt).toISOString() : new Date().toISOString(),
      score: score === "" ? null : Number(score),
      outcome,
      summary: summary.trim() || null,
    };

    const response = await fetch(
      entry
        ? `/api/applications/${applicationId}/evaluations/${entry.id}`
        : `/api/applications/${applicationId}/evaluations`,
      {
        method: entry ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      }
    );

    const result = await response.json().catch(() => null);
    setSaving(false);

    if (!response.ok) {
      setError(result?.error ?? "Could not save this entry.");
      return;
    }

    onClose();
    router.refresh();
  }

  return (
    <div className="modal is-active intake-modal" role="dialog" aria-modal="true"
         aria-label={`${entry ? "Edit" : "Add"} ${STAGE_LABELS[stage]} entry`}>
      <div className="modal-background" />

      <div className="modal-card intake-modal__card" style={{ width: "min(560px, calc(100vw - 32px))" }}>
        <header className="intake-modal__head">
          <div>
            <h2 className="intake-modal__title">
              {entry ? "Edit entry" : "Add entry"}
            </h2>
            <p className="intake-modal__subtitle">{STAGE_LABELS[stage]}</p>
          </div>
          <button type="button" className="intake-modal__close" onClick={onClose} aria-label="Close">
            <X size={18} aria-hidden="true" />
          </button>
        </header>

        <section className="intake-modal__body">
          <FormError message={error} />

          <div className="columns is-variable is-3">
            <div className="column is-half">
              <label className="label" htmlFor="eval-when">Date &amp; time</label>
              <input
                id="eval-when"
                className="input"
                type="datetime-local"
                value={occurredAt}
                onChange={(event) => setOccurredAt(event.target.value)}
              />
              <p className="stage-field__help">When it happened, not when you wrote it up.</p>
            </div>

            <div className="column is-half">
              <label className="label" htmlFor="eval-score">Score (1-10)</label>
              <input
                id="eval-score"
                className="input"
                type="number"
                min={1}
                max={10}
                value={score}
                onChange={(event) => setScore(event.target.value)}
              />
              <p className="stage-field__help">Leave blank if you did not score it.</p>
            </div>
          </div>

          <div className="field">
            <label className="label" htmlFor="eval-outcome">Outcome</label>
            <div className="select is-fullwidth">
              <select
                id="eval-outcome"
                value={outcome}
                onChange={(event) => setOutcome(event.target.value as EvaluationOutcome)}
              >
                {(["pass", "fail", "pending"] as const).map((value) => (
                  <option key={value} value={value}>
                    {OUTCOME_LABELS[value]}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div className="field">
            <label className="label" htmlFor="eval-summary">Summary</label>
            <textarea
              id="eval-summary"
              className="textarea"
              rows={5}
              value={summary}
              onChange={(event) => setSummary(event.target.value)}
              placeholder="What happened, and what you concluded."
            />
          </div>
        </section>

        <footer className="intake-modal__foot">
          <span />
          <div className="is-flex" style={{ gap: "var(--space-2)" }}>
            <button type="button" className="button" onClick={onClose} disabled={saving}>
              Cancel
            </button>
            <button
              type="button"
              className={`button is-primary ${saving ? "is-loading" : ""}`}
              onClick={save}
              disabled={saving}
            >
              {entry ? "Save changes" : "Add entry"}
            </button>
          </div>
        </footer>
      </div>
    </div>
  );
}
