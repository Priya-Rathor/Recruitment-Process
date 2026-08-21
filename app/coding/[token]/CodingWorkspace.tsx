"use client";

// =============================================================================
// The candidate's coding screen.
//
// THE PERSON USING THIS IS BEING JUDGED WHILE THEY USE IT.
//
// That single fact decides nearly every choice below. They are on a call, under
// time pressure, possibly on a phone, and the one thing they cannot afford is to
// wonder whether their work is safe. So:
//
//   * Save status is always visible and always specific — "All changes saved" at
//     a time, not a spinner that vanishes.
//   * A failed save says the code is still here, because it is: nothing clears
//     the buffer, and a retry sends the same text.
//   * Autosave debounces rather than firing per keystroke, and a manual Save
//     button exists anyway — because under pressure people want to press
//     something, and telling them "it saves automatically" is not reassurance.
//   * Submitting asks for confirmation once, and after it the editor is
//     read-only rather than gone. Seeing what you sent is part of being able to
//     stop thinking about it.
// =============================================================================

import { useCallback, useEffect, useRef, useState } from "react";
import { AlertCircle, Check, Loader2, Send } from "lucide-react";
import { Button } from "@/components/ui/Button";
import {
  LANGUAGE_LABELS,
  LANGUAGE_STARTERS,
  isCodingLanguage,
  type CodingLanguage,
} from "@/lib/coding/languages";
import type { CandidateSessionView } from "@/lib/coding/candidate";
import { CodeEditor } from "./CodeEditor";

/**
 * How long after the last keystroke a save fires.
 *
 * 1.5 seconds. Short enough that a candidate who stops to think has their work
 * saved before they start typing again; long enough that ordinary typing
 * produces one request per pause rather than one per character.
 */
const AUTOSAVE_DEBOUNCE_MS = 1500;

type SaveState =
  | { kind: "idle" }
  | { kind: "dirty" }
  | { kind: "saving" }
  | { kind: "saved"; at: string }
  | { kind: "failed"; message: string };

export function CodingWorkspace({
  token,
  session,
}: {
  token: string;
  session: CandidateSessionView;
}) {
  const submitted = session.status === "submitted";

  const [code, setCode] = useState(session.code);
  const [language, setLanguage] = useState<CodingLanguage>(session.language);
  const [saveState, setSaveState] = useState<SaveState>(
    session.lastSavedAt ? { kind: "saved", at: session.lastSavedAt } : { kind: "idle" }
  );
  const [confirming, setConfirming] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [closed, setClosed] = useState<string | null>(null);
  const [isSubmitted, setIsSubmitted] = useState(submitted);

  const debounce = useRef<ReturnType<typeof setTimeout> | null>(null);
  /**
   * The latest buffer, readable from inside a timer without re-arming it.
   *
   * A closure over `code` would capture whatever the value was when the timer
   * was set, so a save firing 1.5s after the last keystroke would post the text
   * from 1.5s ago — losing the final word of every burst of typing.
   */
  const latest = useRef({ code: session.code, language: session.language });

  useEffect(() => {
    latest.current = { code, language };
  }, [code, language]);

  const save = useCallback(
    async ({ manual }: { manual: boolean }) => {
      if (isSubmitted || closed) return;

      setSaveState({ kind: "saving" });

      try {
        const response = await fetch(`/api/coding/${token}/draft`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            code: latest.current.code,
            language: latest.current.language,
          }),
        });

        if (!response.ok) {
          const payload = await response.json().catch(() => null);
          const message = payload?.error ?? "Unable to save. Please try again.";

          // A round the interviewer cancelled, or one that expired while the tab
          // sat open. The editor stops accepting work and says why, rather than
          // letting somebody keep typing into a session that will not store it.
          if (payload?.code && payload.code !== "rejected" && payload.code !== "unavailable") {
            setClosed(message);
          }

          setSaveState({ kind: "failed", message });
          return;
        }

        const payload = await response.json();
        setSaveState({ kind: "saved", at: payload.data.last_saved_at });
      } catch {
        setSaveState({
          kind: "failed",
          message: "Unable to save — check your connection. Your code is still here.",
        });
      }
      void manual;
    },
    [token, isSubmitted, closed]
  );

  /** Arms the debounce. Called on every change to the buffer or the language. */
  const scheduleSave = useCallback(() => {
    if (isSubmitted || closed) return;
    setSaveState({ kind: "dirty" });
    if (debounce.current) clearTimeout(debounce.current);
    debounce.current = setTimeout(() => void save({ manual: false }), AUTOSAVE_DEBOUNCE_MS);
  }, [save, isSubmitted, closed]);

  useEffect(() => {
    return () => {
      if (debounce.current) clearTimeout(debounce.current);
    };
  }, []);

  /**
   * A last-chance save when the tab is hidden or closed.
   *
   * `visibilitychange` rather than `beforeunload`: the latter is unreliable on
   * mobile, which is exactly where this page is used. Fires the pending save
   * immediately rather than waiting out the debounce nobody is around for.
   */
  useEffect(() => {
    if (isSubmitted || closed) return;

    function flush() {
      if (document.visibilityState === "hidden" && debounce.current) {
        clearTimeout(debounce.current);
        debounce.current = null;
        void save({ manual: false });
      }
    }

    document.addEventListener("visibilitychange", flush);
    return () => document.removeEventListener("visibilitychange", flush);
  }, [save, isSubmitted, closed]);

  function handleCodeChange(next: string) {
    setCode(next);
    scheduleSave();
  }

  function handleLanguageChange(next: string) {
    if (!isCodingLanguage(next)) return;

    setLanguage(next);
    // Only swap the buffer when it is still an untouched starter. Replacing real
    // work because somebody explored the dropdown would be unforgivable here.
    setCode((current) => {
      const untouched = Object.values(LANGUAGE_STARTERS).some(
        (starter) => starter.trim() === current.trim()
      );
      return untouched ? LANGUAGE_STARTERS[next] : current;
    });
    scheduleSave();
  }

  async function submit() {
    setSubmitting(true);
    setSubmitError(null);

    // Flush anything pending first, so the submission carries the latest text
    // even if the debounce had not fired.
    if (debounce.current) {
      clearTimeout(debounce.current);
      debounce.current = null;
    }

    try {
      const response = await fetch(`/api/coding/${token}/submit`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          code: latest.current.code,
          language: latest.current.language,
        }),
      });

      if (!response.ok) {
        const payload = await response.json().catch(() => null);
        setSubmitError(payload?.error ?? "Could not submit. Please try again.");
        setSubmitting(false);
        setConfirming(false);
        return;
      }

      setIsSubmitted(true);
      setConfirming(false);
      setSaveState({ kind: "saved", at: new Date().toISOString() });
    } catch {
      setSubmitError("Could not submit — check your connection and try again.");
    }
    setSubmitting(false);
  }

  return (
    <div className="coding-shell">
      <header className="coding-shell__head">
        <div style={{ minWidth: 0 }}>
          <p className="coding-shell__eyebrow">
            {session.organizationName ?? "Technical interview"}
          </p>
          <h1 className="coding-shell__title">{session.questionTitle}</h1>
          <p className="coding-shell__meta">
            {session.candidateName ? `${session.candidateName} · ` : ""}
            {session.jobTitle ?? "Coding round"}
            {session.timeLimitMinutes ? ` · suggested ${session.timeLimitMinutes} minutes` : ""}
          </p>
        </div>
      </header>

      {isSubmitted && (
        <div className="coding-banner is-done" role="status">
          <Check size={16} aria-hidden="true" />
          <span>
            Your coding submission has been successfully submitted. You can close this page — your
            interviewer can see your answer.
          </span>
        </div>
      )}

      {closed && !isSubmitted && (
        <div className="coding-banner is-stopped" role="alert">
          <AlertCircle size={16} aria-hidden="true" />
          <span>{closed}</span>
        </div>
      )}

      <div className="coding-grid">
        <section className="card coding-question">
          <h2 className="title is-6 mb-2">Question</h2>
          <p className="coding-question__body">{session.questionDescription}</p>

          {session.instructions && (
            <>
              <h3 className="label mt-4" style={{ marginBottom: "var(--space-1)" }}>
                Instructions
              </h3>
              <p className="coding-question__body">{session.instructions}</p>
            </>
          )}
        </section>

        <section className="card coding-work">
          <div className="coding-work__bar">
            <label className="coding-work__language">
              <span className="label" style={{ marginBottom: 0 }}>
                Language
              </span>
              <span className="select is-small">
                <select
                  value={language}
                  onChange={(event) => handleLanguageChange(event.target.value)}
                  disabled={isSubmitted || Boolean(closed)}
                  aria-label="Programming language"
                >
                  {session.languages.map((entry) => (
                    <option key={entry} value={entry}>
                      {LANGUAGE_LABELS[entry]}
                    </option>
                  ))}
                </select>
              </span>
            </label>

            <SaveStatus state={saveState} submitted={isSubmitted} />
          </div>

          <CodeEditor
            value={code}
            language={language}
            onChange={handleCodeChange}
            readOnly={isSubmitted || Boolean(closed)}
          />

          {submitError && (
            <p className="coding-work__error" role="alert">
              <AlertCircle size={14} aria-hidden="true" />
              {submitError}
            </p>
          )}

          {!isSubmitted && !closed && (
            <div className="coding-work__actions">
              <Button
                onClick={() => void save({ manual: true })}
                loading={saveState.kind === "saving"}
              >
                Save draft
              </Button>
              <Button variant="primary" icon={Send} onClick={() => setConfirming(true)}>
                Submit code
              </Button>
            </div>
          )}
        </section>
      </div>

      {confirming && (
        <div
          className="modal is-active intake-modal"
          role="dialog"
          aria-modal="true"
          aria-label="Confirm submission"
        >
          <div className="modal-background" onClick={() => setConfirming(false)} />
          <div
            className="modal-card intake-modal__card"
            style={{ width: "min(460px, calc(100vw - 32px))" }}
          >
            <header className="intake-modal__head">
              <div>
                <h2 className="intake-modal__title">Submit your code?</h2>
                <p className="intake-modal__subtitle">
                  After submitting you will not be able to edit it.
                </p>
              </div>
            </header>
            <section className="intake-modal__body">
              <p style={{ fontSize: 14 }}>
                Your answer will be sent to your interviewer exactly as it appears now, in{" "}
                {LANGUAGE_LABELS[language]}.
              </p>
            </section>
            <footer className="intake-modal__foot">
              <p className="intake-modal__foothint">You can keep editing if you are not ready.</p>
              <div className="buttons mb-0">
                <Button onClick={() => setConfirming(false)} disabled={submitting}>
                  Cancel
                </Button>
                <Button variant="primary" loading={submitting} onClick={() => void submit()}>
                  Submit
                </Button>
              </div>
            </footer>
          </div>
        </div>
      )}
    </div>
  );
}

/**
 * The save indicator.
 *
 * Every state says something specific. "Saving…" with no follow-up, or a tick
 * that disappears after two seconds, both leave the candidate checking.
 */
function SaveStatus({ state, submitted }: { state: SaveState; submitted: boolean }) {
  if (submitted) {
    return (
      <span className="coding-save is-saved">
        <Check size={14} aria-hidden="true" />
        Submitted
      </span>
    );
  }

  switch (state.kind) {
    case "saving":
      return (
        <span className="coding-save" aria-live="polite">
          <Loader2 size={14} aria-hidden="true" className="coding-save__spin" />
          Saving…
        </span>
      );
    case "saved":
      return (
        <span className="coding-save is-saved" aria-live="polite">
          <Check size={14} aria-hidden="true" />
          All changes saved{" "}
          {new Date(state.at).toLocaleTimeString("en-GB", {
            hour: "2-digit",
            minute: "2-digit",
          })}
        </span>
      );
    case "failed":
      return (
        <span className="coding-save is-failed" role="alert">
          <AlertCircle size={14} aria-hidden="true" />
          {state.message}
        </span>
      );
    case "dirty":
      return <span className="coding-save">Unsaved changes</span>;
    default:
      return <span className="coding-save">Nothing saved yet</span>;
  }
}
