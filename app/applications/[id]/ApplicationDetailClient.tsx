"use client";

// Interactive parts of the application detail page: the AI summary, the stage
// control, and the note composer. The page itself stays a server component so
// the timeline renders without a client fetch.
import { useState } from "react";
import { useRouter } from "next/navigation";
import { FormError } from "@/components/states";
import { availableTransitions, STAGE_LABELS, type ApplicationStage } from "@/lib/applications/stages";

/**
 * AI summary. Generation is opt-in rather than automatic: the cost model chapter
 * warns against AI calls a user can trigger repeatedly, and the structured
 * fields below are already complete without it.
 */
export function ApplicationSummary({ applicationId }: { applicationId: string }) {
  const [summary, setSummary] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function generate() {
    setBusy(true);
    setError(null);

    try {
      const response = await fetch(`/api/applications/${applicationId}/ai-action`, {
        method: "POST",
      });
      const payload = await response.json().catch(() => null);

      if (!response.ok) {
        // A failed summary must never obscure the real record below it.
        setError(
          payload?.error ?? "Couldn't generate a summary. The details below are unaffected."
        );
        return;
      }
      setSummary((payload.data as { summary: string }).summary);
    } catch {
      setError("Couldn't reach the AI service. The details below are unaffected.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="ai-panel mb-4">
      <div className="is-flex is-justify-content-space-between is-align-items-center">
        <p style={{ fontSize: 13, fontWeight: 600, color: "var(--color-info)" }}>
          AI summary
        </p>
        <button
          type="button"
          className={`button is-small ${busy ? "is-loading" : ""}`}
          onClick={generate}
          disabled={busy}
        >
          {summary ? "Regenerate" : "Summarise"}
        </button>
      </div>

      {!summary && !error && (
        <p className="has-text-secondary mt-2" style={{ fontSize: 14 }}>
          Summarise this application&apos;s current state in a paragraph.
        </p>
      )}

      {error && (
        <p className="mt-2" style={{ fontSize: 14, color: "var(--color-error)" }} role="alert">
          {error}
        </p>
      )}

      {summary && (
        <>
          <p className="mt-2" style={{ fontSize: 15 }}>
            {summary}
          </p>
          <p className="has-text-secondary mt-3" style={{ fontSize: 11 }}>
            Written from this application&apos;s own recorded facts. Every figure is checked against
            them before display.
          </p>
        </>
      )}
    </div>
  );
}

/** Stage control. Every change is written to the timeline by the database. */
export function StageControl({
  applicationId,
  currentStage,
  canEdit,
}: {
  applicationId: string;
  currentStage: ApplicationStage;
  canEdit: boolean;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const options = availableTransitions(currentStage);

  if (!canEdit) {
    return (
      <p className="has-text-secondary" style={{ fontSize: 13 }}>
        Your role can view this pipeline but not move it.
      </p>
    );
  }

  if (options.length === 0) {
    return (
      <p className="has-text-secondary" style={{ fontSize: 13 }}>
        This application is {STAGE_LABELS[currentStage].toLowerCase()}. To consider this candidate
        again, create a new application.
      </p>
    );
  }

  async function moveTo(stage: string) {
    setBusy(true);
    setError(null);

    const response = await fetch(`/api/applications/${applicationId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ stage }),
    });

    setBusy(false);

    if (!response.ok) {
      const payload = await response.json().catch(() => null);
      setError(payload?.error ?? "Could not move this application.");
      return;
    }
    router.refresh();
  }

  return (
    <div>
      <FormError message={error} />
      <label className="label" style={{ fontSize: 13 }} htmlFor="stage-control">
        Move to stage
      </label>
      <div className="select is-fullwidth">
        <select
          id="stage-control"
          value=""
          disabled={busy}
          onChange={(event) => {
            if (event.target.value) moveTo(event.target.value);
          }}
        >
          <option value="">Choose a stage…</option>
          {options.map((stage) => (
            <option key={stage} value={stage}>
              {STAGE_LABELS[stage]}
            </option>
          ))}
        </select>
      </div>
      <p className="help has-text-secondary">Every move is recorded in the timeline.</p>
    </div>
  );
}

/** Note composer. Notes appear in the timeline alongside stage changes. */
export function NoteComposer({
  applicationId,
  canWrite,
}: {
  applicationId: string;
  canWrite: boolean;
}) {
  const router = useRouter();
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!canWrite) return null;

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);

    const response = await fetch(`/api/applications/${applicationId}/notes`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ note }),
    });

    setBusy(false);

    if (!response.ok) {
      const payload = await response.json().catch(() => null);
      setError(payload?.error ?? "Could not save the note.");
      return;
    }

    setNote("");
    router.refresh();
  }

  return (
    <form onSubmit={submit} className="mb-4">
      <FormError message={error} />
      <div className="field">
        <textarea
          className="textarea"
          rows={3}
          placeholder="Add a note — what happened, what's next…"
          maxLength={5000}
          value={note}
          onChange={(event) => setNote(event.target.value)}
        />
      </div>
      <button
        type="submit"
        className={`button is-primary is-small ${busy ? "is-loading" : ""}`}
        disabled={busy || note.trim().length === 0}
      >
        Add note
      </button>
    </form>
  );
}
