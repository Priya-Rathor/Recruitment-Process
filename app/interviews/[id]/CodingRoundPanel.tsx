"use client";

// =============================================================================
// The interviewer's coding-round control, on the interview page.
//
// WHY IT LIVES HERE AND NOT ON THE APPLICATION PAGE.
//
// A coding round happens DURING an interview. The interviewer is on a call, has
// this page open beside Google Meet, and needs the QR code on screen within one
// click of where they already are. Putting it on the Application page would mean
// leaving the interview they are conducting to start a round that belongs to it.
//
// The result is readable from both — see the Evaluation panel, which picks the
// submission up through application_evaluations without being edited.
//
// TWO STATES, ONE COMPONENT: setting the question up, and sharing the link.
// They are the same modal because they are the same act interrupted by a save,
// and closing one to open the other would lose the QR code the interviewer is
// mid-way through sharing.
//
// DATA COMES IN AS PROPS, LOADED ON THE SERVER.
//
// This started as a client component that fetched on mount. That is not how
// this codebase loads data — AGENTS.md is explicit: "Prefer loading data in
// server components and refreshing after mutations over client-side fetch
// effects" — and the effect version also flashed an empty card on every visit
// to an interview that already had a round open. The page reads the sessions
// server-side and router.refresh() re-runs it after a mutation, which is the
// same pattern every other mutating surface here uses.
// =============================================================================

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Check, Code2, Copy, Monitor, X } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Field } from "@/components/ui/Field";
import { StatusChip } from "@/components/ui/StatusChip";
import { FormError } from "@/components/states";
import {
  CODING_LANGUAGES,
  LANGUAGE_LABELS,
  type CodingLanguage,
} from "@/lib/coding/languages";
import {
  MAX_QUESTION_TITLE,
  MAX_TIME_LIMIT_MINUTES,
  MIN_TIME_LIMIT_MINUTES,
  STATUS_LABELS,
  STATUS_TONE,
  type CodingSessionStatus,
} from "@/lib/coding/session";

type SessionSummary = {
  id: string;
  status: CodingSessionStatus;
  question_title: string;
  created_at: string;
  submitted_at: string | null;
  candidate_url: string | null;
};

type Suggestion = {
  title: string;
  description: string;
  instructions: string | null;
  timeLimitMinutes: number | null;
  fromJobConfig: boolean;
};

export function CodingRoundPanel({
  candidateName,
  interviewId,
  sessions,
  suggestion,
  signingConfigured,
  canStart,
  blockedReason,
  schemaOutOfDate,
}: {
  candidateName: string;
  interviewId: string;
  /** Loaded on the server by the interview page. Newest first. */
  sessions: SessionSummary[];
  /** Prefill from the job's Written Assessment configuration, when it has one. */
  suggestion: Suggestion | null;
  /** False when INTEGRATION_ENCRYPTION_KEY is unset, so no link can be signed. */
  signingConfigured: boolean;
  /** From the existing role check on the page — never re-derived here. */
  canStart: boolean;
  /** Why not, when canStart is false. Shown instead of a disabled button. */
  blockedReason: string | null;
  /** Migration 0031 has not been applied. A build state, said plainly. */
  schemaOutOfDate: boolean;
}) {
  const router = useRouter();

  const [modalOpen, setModalOpen] = useState(false);
  const [shared, setShared] = useState<SessionSummary | null>(null);

  const open = sessions.find(
    (session) => session.status === "created" || session.status === "in_progress"
  );
  const finished = sessions.filter(
    (session) => session.status !== "created" && session.status !== "in_progress"
  );

  return (
    <div className="card mb-4">
      <div className="is-flex is-justify-content-space-between is-align-items-center mb-3">
        <h2 className="title is-5 mb-0">Coding round</h2>
        {open && <StatusChip tone={STATUS_TONE[open.status]} label={STATUS_LABELS[open.status]} />}
      </div>

      {schemaOutOfDate ? (
        <p className="intake-callout">
          Coding rounds need a database migration that hasn&apos;t been applied yet. Apply{" "}
          <code>0031_live_coding_interview.sql</code> and reload.
        </p>
      ) : (
        <>
          {/*
            The honest states come first, and each names the fix. A disabled
            button with no explanation is the thing this codebase keeps
            designing out.
          */}
          {!signingConfigured && (
            <p className="intake-callout mb-3">
              Coding rounds need <code>INTEGRATION_ENCRYPTION_KEY</code> set on the server before a
              candidate link can be signed. Ask whoever runs this deployment.
            </p>
          )}

          {blockedReason && (
            <p className="has-text-secondary mb-3" style={{ fontSize: 13 }}>
              {blockedReason}
            </p>
          )}

          {open ? (
            <>
              <p style={{ fontSize: 14 }} className="mb-1">
                <strong>{open.question_title}</strong>
              </p>
              <p className="has-text-secondary mb-3" style={{ fontSize: 13 }}>
                A round is open for {candidateName}. Share the QR code on your call, then watch
                their code come in.
              </p>
              <div className="buttons">
                <Button variant="primary" size="small" icon={Code2} onClick={() => setShared(open)}>
                  Show QR code
                </Button>
                <Link className="button is-small" href={`/coding-sessions/${open.id}`}>
                  <Monitor size={14} aria-hidden="true" />
                  Open live monitor
                </Link>
              </div>
            </>
          ) : canStart && signingConfigured ? (
            <>
              <p className="has-text-secondary mb-3" style={{ fontSize: 13 }}>
                Set a question, then share a QR code on your Google Meet screen. {candidateName}{" "}
                scans it with their phone and writes code in their browser — you watch it live here.
              </p>
              <Button variant="primary" size="small" icon={Code2} onClick={() => setModalOpen(true)}>
                Start coding round
              </Button>
            </>
          ) : (
            !blockedReason &&
            signingConfigured && (
              <p className="has-text-secondary" style={{ fontSize: 13 }}>
                Your role can see coding rounds but not start them.
              </p>
            )
          )}

          {finished.length > 0 && (
            <ul className="mt-4" style={{ borderTop: "1px solid var(--color-border)" }}>
              {finished.map((session) => (
                <li
                  key={session.id}
                  className="py-3 is-flex is-justify-content-space-between is-align-items-center"
                  style={{ borderBottom: "1px solid var(--color-border)", gap: "0.75rem" }}
                >
                  <div style={{ minWidth: 0 }}>
                    <p style={{ fontSize: 14, fontWeight: 600 }}>{session.question_title}</p>
                    <p className="has-text-secondary" style={{ fontSize: 12 }}>
                      {new Date(session.created_at).toLocaleString("en-GB", {
                        day: "numeric",
                        month: "short",
                        hour: "2-digit",
                        minute: "2-digit",
                      })}
                    </p>
                  </div>
                  <div className="is-flex is-align-items-center" style={{ gap: "0.5rem" }}>
                    <StatusChip
                      tone={STATUS_TONE[session.status]}
                      label={STATUS_LABELS[session.status]}
                    />
                    <Link className="button is-small" href={`/coding-sessions/${session.id}`}>
                      View
                    </Link>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </>
      )}

      {modalOpen && (
        <StartRoundModal
          interviewId={interviewId}
          candidateName={candidateName}
          suggestion={suggestion}
          onCancel={() => setModalOpen(false)}
          onCreated={(session) => {
            setModalOpen(false);
            setShared(session);
            // The page owns the session list, so refreshing it is what makes the
            // new round appear — there is no second copy here to keep in step.
            router.refresh();
          }}
        />
      )}

      {shared && (
        <ShareModal
          session={shared}
          candidateName={candidateName}
          onClose={() => setShared(null)}
        />
      )}
    </div>
  );
}

// -----------------------------------------------------------------------------
// Setting the question
// -----------------------------------------------------------------------------

function StartRoundModal({
  interviewId,
  candidateName,
  suggestion,
  onCancel,
  onCreated,
}: {
  interviewId: string;
  candidateName: string;
  suggestion: Suggestion | null;
  onCancel: () => void;
  onCreated: (session: SessionSummary) => void;
}) {
  const [title, setTitle] = useState(suggestion?.title ?? "");
  const [description, setDescription] = useState(suggestion?.description ?? "");
  const [instructions, setInstructions] = useState(suggestion?.instructions ?? "");
  const [timeLimit, setTimeLimit] = useState(
    suggestion?.timeLimitMinutes ? String(suggestion.timeLimitMinutes) : ""
  );
  const [languages, setLanguages] = useState<CodingLanguage[]>([...CODING_LANGUAGES]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function toggleLanguage(language: CodingLanguage) {
    setLanguages((current) =>
      current.includes(language)
        ? current.filter((entry) => entry !== language)
        : // Kept in catalogue order so the candidate's selector is stable
          // whichever order the interviewer ticked the boxes.
          CODING_LANGUAGES.filter((entry) => current.includes(entry) || entry === language)
    );
  }

  async function start() {
    setBusy(true);
    setError(null);

    const response = await fetch(`/api/interviews/${interviewId}/coding-session`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        question_title: title,
        question_description: description,
        instructions: instructions.trim().length === 0 ? null : instructions,
        languages,
        time_limit_minutes: timeLimit === "" ? null : timeLimit,
      }),
    });

    if (!response.ok) {
      const payload = await response.json().catch(() => null);
      setError(payload?.error ?? "Could not start the coding round.");
      setBusy(false);
      return;
    }

    const payload = await response.json();
    onCreated(payload.data);
  }

  return (
    <div
      className="modal is-active intake-modal"
      role="dialog"
      aria-modal="true"
      aria-label="Start a coding round"
    >
      {/* No backdrop-click close: a mis-click would discard a typed question. */}
      <div className="modal-background" />

      <div className="modal-card intake-modal__card">
        <header className="intake-modal__head">
          <div>
            <h2 className="intake-modal__title">Start a coding round</h2>
            <p className="intake-modal__subtitle">
              {candidateName} will see only what you set here.
            </p>
          </div>
          <button type="button" className="intake-modal__close" onClick={onCancel} aria-label="Close">
            <X size={18} aria-hidden="true" />
          </button>
        </header>

        <section className="intake-modal__body">
          <FormError message={error} />

          {suggestion?.fromJobConfig && (
            <p className="intake-callout mb-4">
              Prefilled from this job&apos;s Written Assessment configuration. Edit it freely —
              what you save here is what this candidate sees, and the job&apos;s own settings are
              left alone.
            </p>
          )}

          <Field
            label="Question title"
            hint="Shown as the heading on the candidate's screen."
            htmlFor="coding-title"
          >
            <input
              id="coding-title"
              className="input"
              type="text"
              maxLength={MAX_QUESTION_TITLE}
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              placeholder="e.g. Rate limiter"
            />
          </Field>

          <Field
            label="Question"
            hint="The problem itself. Line breaks are preserved."
            htmlFor="coding-description"
          >
            <textarea
              id="coding-description"
              className="textarea"
              rows={7}
              value={description}
              onChange={(event) => setDescription(event.target.value)}
              placeholder="e.g. Design a rate limiter for a public API. Explain your choice of data structure."
            />
          </Field>

          <Field
            label="Instructions (optional)"
            hint="Constraints, what to optimise for, whether pseudocode is acceptable."
            htmlFor="coding-instructions"
          >
            <textarea
              id="coding-instructions"
              className="textarea"
              rows={3}
              value={instructions}
              onChange={(event) => setInstructions(event.target.value)}
              placeholder="e.g. Focus on correctness over performance. Talk us through your thinking."
            />
          </Field>

          <Field
            label="Languages offered"
            hint="The candidate picks one of these. Untick anything this role does not use."
          >
            <div className="buttons">
              {CODING_LANGUAGES.map((language) => {
                const selected = languages.includes(language);
                return (
                  <button
                    key={language}
                    type="button"
                    className={`button is-small ${selected ? "is-primary" : ""}`}
                    onClick={() => toggleLanguage(language)}
                    aria-pressed={selected}
                  >
                    {selected && <Check size={13} aria-hidden="true" />}
                    {LANGUAGE_LABELS[language]}
                  </button>
                );
              })}
            </div>
          </Field>

          <Field
            label="Time limit in minutes (optional)"
            hint="Shown to the candidate as guidance. Nothing is submitted automatically when it runs out — a dropped connection must not cost them their work."
            htmlFor="coding-time-limit"
          >
            <input
              id="coding-time-limit"
              className="input"
              type="number"
              min={MIN_TIME_LIMIT_MINUTES}
              max={MAX_TIME_LIMIT_MINUTES}
              value={timeLimit}
              onChange={(event) => setTimeLimit(event.target.value)}
              placeholder="e.g. 45"
              style={{ maxWidth: 160 }}
            />
          </Field>
        </section>

        <footer className="intake-modal__foot">
          <p className="intake-modal__foothint">
            The link expires 24 hours from now, or when you cancel the round.
          </p>
          <div className="buttons mb-0">
            <Button onClick={onCancel} disabled={busy}>
              Cancel
            </Button>
            <Button
              variant="primary"
              loading={busy}
              onClick={() => void start()}
              disabled={title.trim().length === 0 || description.trim().length === 0 || languages.length === 0}
            >
              Start round
            </Button>
          </div>
        </footer>
      </div>
    </div>
  );
}

// -----------------------------------------------------------------------------
// Sharing the link
// -----------------------------------------------------------------------------

function ShareModal({
  session,
  candidateName,
  onClose,
}: {
  session: SessionSummary;
  candidateName: string;
  onClose: () => void;
}) {
  const [copied, setCopied] = useState(false);
  const copyTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (copyTimer.current) clearTimeout(copyTimer.current);
    };
  }, []);

  async function copy() {
    if (!session.candidate_url) return;
    try {
      await navigator.clipboard.writeText(session.candidate_url);
      setCopied(true);
      copyTimer.current = setTimeout(() => setCopied(false), 2500);
    } catch {
      // Clipboard permission refused, or an insecure origin. The link is on
      // screen and selectable either way, so this is not worth an error banner.
      setCopied(false);
    }
  }

  return (
    <div
      className="modal is-active intake-modal"
      role="dialog"
      aria-modal="true"
      aria-label="Coding round link"
    >
      <div className="modal-background" onClick={onClose} />

      <div className="modal-card intake-modal__card" style={{ width: "min(520px, calc(100vw - 32px))" }}>
        <header className="intake-modal__head">
          <div>
            <h2 className="intake-modal__title">Coding round</h2>
            <p className="intake-modal__subtitle">
              {candidateName} · {STATUS_LABELS[session.status]}
            </p>
          </div>
          <button type="button" className="intake-modal__close" onClick={onClose} aria-label="Close">
            <X size={18} aria-hidden="true" />
          </button>
        </header>

        <section className="intake-modal__body">
          <p className="has-text-secondary mb-4" style={{ fontSize: 13 }}>
            Share your screen on the call and let {candidateName} scan this with their phone camera.
          </p>

          <div className="coding-qr">
            {/*
              Rendered by an authenticated endpoint, so the link never enters
              client state. See app/api/coding-sessions/[id]/qr/route.ts.

              A plain <img>, not next/image, and deliberately. The optimizer
              would proxy and cache this — caching a credential — and it cannot
              usefully resize an SVG anyway. There is no LCP cost to weigh
              against that: this image only exists inside a modal the
              interviewer opened.
            */}
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={`/api/coding-sessions/${session.id}/qr`}
              alt={`QR code opening the coding round for ${candidateName}`}
              width={280}
              height={280}
            />
          </div>

          {session.candidate_url && (
            <>
              <p className="label mt-4" style={{ marginBottom: "var(--space-2)" }}>
                Or send them this link
              </p>
              <p className="coding-link" title={session.candidate_url}>
                {session.candidate_url}
              </p>
            </>
          )}
        </section>

        <footer className="intake-modal__foot">
          <Link className="button is-small" href={`/coding-sessions/${session.id}`}>
            <Monitor size={14} aria-hidden="true" />
            Open live monitor
          </Link>
          <div className="buttons mb-0">
            <Button
              size="small"
              icon={copied ? Check : Copy}
              onClick={() => void copy()}
              disabled={!session.candidate_url}
            >
              {copied ? "Copied" : "Copy link"}
            </Button>
            <Button size="small" variant="primary" onClick={onClose}>
              Close
            </Button>
          </div>
        </footer>
      </div>
    </div>
  );
}
