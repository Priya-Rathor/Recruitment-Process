"use client";

// Draft, review, then send.
//
// The spec's test: "Sending a submission requires an explicit recruiter action,
// never automatic." Two separate buttons hitting two separate endpoints, and the
// draft lands in an EDITABLE textarea — what gets recorded is what the recruiter
// approved, not what the model produced.
//
// The send button also names the client, because this text goes to a real
// company about a real person and a mis-sent submission is not undoable.
import { useState } from "react";
import { useRouter } from "next/navigation";
import { FormError } from "@/components/states";
import type { SubmissionDraft } from "@/lib/ai/generateClientSubmission";

export function SubmissionPanel({
  applicationId,
  candidateName,
  existing,
  canSubmit,
}: {
  applicationId: string;
  candidateName: string;
  existing: { requested_at: string; submission_text: string | null; responded_at: string | null } | null;
  canSubmit: boolean;
}) {
  const router = useRouter();
  const [text, setText] = useState(existing?.submission_text ?? "");
  const [highlights, setHighlights] = useState<string[]>([]);
  const [clientName, setClientName] = useState<string | null>(null);
  const [drafting, setDrafting] = useState(false);
  const [sending, setSending] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function draft() {
    setDrafting(true);
    setError(null);

    try {
      const response = await fetch(`/api/applications/${applicationId}/submission`, {
        method: "POST",
      });
      const payload = await response.json().catch(() => null);

      if (!response.ok) {
        setError(payload?.error ?? "Couldn't draft a submission.");
        return;
      }

      const data = payload.data as SubmissionDraft;
      setText(data.summary);
      setHighlights(data.highlights);
      setClientName(payload.clientName ?? null);
    } catch {
      setError("Couldn't reach the AI service. You can write the summary yourself.");
    } finally {
      setDrafting(false);
    }
  }

  async function send() {
    setSending(true);
    setError(null);

    const response = await fetch(`/api/applications/${applicationId}/submission`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ submission_text: text }),
    });

    setSending(false);
    setConfirming(false);

    if (!response.ok) {
      const payload = await response.json().catch(() => null);
      setError(payload?.error ?? "Could not record that submission.");
      return;
    }

    router.refresh();
  }

  if (!canSubmit) {
    return (
      <div className="card">
        <h2 className="title is-5">Client submission</h2>
        <p className="has-text-secondary" style={{ fontSize: 14 }}>
          Your role can view submissions but not send them.
        </p>
        {existing?.submission_text && (
          <p className="mt-3" style={{ fontSize: 14, whiteSpace: "pre-wrap" }}>
            {existing.submission_text}
          </p>
        )}
      </div>
    );
  }

  return (
    <div>
      <FormError message={error} />

      {existing && (
        <div className="card mb-4">
          <h2 className="title is-5">Already submitted</h2>
          <p className="has-text-secondary mb-2" style={{ fontSize: 13 }}>
            Sent{" "}
            {new Date(existing.requested_at).toLocaleDateString("en-GB", {
              day: "numeric",
              month: "long",
              year: "numeric",
            })}
            {existing.responded_at ? " · client has responded" : " · awaiting a response"}
          </p>
          {existing.submission_text && (
            <p style={{ fontSize: 14, whiteSpace: "pre-wrap" }}>{existing.submission_text}</p>
          )}
        </div>
      )}

      <div className="card mb-4">
        <h2 className="title is-5">{existing ? "Submit again" : "Draft a submission"}</h2>
        <p className="subtitle is-6 has-text-secondary">
          AI drafts from what&apos;s on the record. Read it before sending — this goes to the client
          about a real person.
        </p>

        <button
          type="button"
          className={`button ${drafting ? "is-loading" : ""}`}
          onClick={draft}
          disabled={drafting}
        >
          {text ? "Draft again" : "Draft with AI"}
        </button>

        {highlights.length > 0 && (
          <div className="mt-4">
            <p style={{ fontSize: 13, fontWeight: 600 }}>Highlights</p>
            <ul style={{ fontSize: 14, listStyle: "disc", paddingLeft: "1.25rem" }}>
              {highlights.map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
          </div>
        )}

        <div className="field mt-4">
          <label className="label" htmlFor="submission-text">
            Message to the client
          </label>
          <textarea
            id="submission-text"
            className="textarea"
            rows={8}
            maxLength={5000}
            placeholder="Write the introduction yourself, or draft it with AI above."
            value={text}
            onChange={(event) => setText(event.target.value)}
          />
          <p className="help has-text-secondary">
            Edit freely — what you send is what gets recorded, not what AI produced.
          </p>
        </div>
      </div>

      <div className="card">
        {!confirming ? (
          <>
            <button
              type="button"
              className="button is-primary"
              onClick={() => setConfirming(true)}
              disabled={text.trim().length === 0}
            >
              Send to client
            </button>
            <p className="has-text-secondary mt-2" style={{ fontSize: 12 }}>
              Records the submission and starts the feedback clock. Email delivery arrives with
              Notifications (Module 15).
            </p>
          </>
        ) : (
          <>
            {/* Naming the person and the client makes a mis-send much harder. */}
            <p className="mb-3" style={{ fontSize: 14 }}>
              Submit <strong>{candidateName}</strong>
              {clientName ? (
                <>
                  {" "}
                  to <strong>{clientName}</strong>
                </>
              ) : null}
              ? This records what you send and can&apos;t be unsent.
            </p>
            <div className="buttons">
              <button
                type="button"
                className={`button is-primary ${sending ? "is-loading" : ""}`}
                onClick={send}
                disabled={sending}
              >
                Yes, submit
              </button>
              <button
                type="button"
                className="button"
                onClick={() => setConfirming(false)}
                disabled={sending}
              >
                Cancel
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
