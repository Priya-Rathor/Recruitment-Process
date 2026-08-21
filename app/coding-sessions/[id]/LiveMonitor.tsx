"use client";

// =============================================================================
// Watching the candidate write.
//
// POLLING, NOT SOCKETS, and that is a decision rather than a shortcut.
//
// This product has no realtime infrastructure — no socket server, no
// subscription layer, nothing the automation engine or the notification centre
// already use. Introducing one for a screen that a handful of people look at
// during an interview would be a permanent piece of infrastructure bought for a
// transient view, and AGENTS.md is explicit that unnecessary infrastructure is
// not the answer when periodic updates are sufficient.
//
// They are sufficient here. The candidate's code only reaches the server when it
// is saved, and it is saved about once every 1.5 seconds of typing. A poll every
// five seconds is never more than one save behind, which is the granularity an
// interviewer reading over someone's shoulder actually perceives.
//
// THE POLL STOPS WHEN NOBODY IS LOOKING. A hidden tab polls nothing, and polling
// stops entirely once the round is submitted or cancelled — a monitor left open
// overnight must not hold a request loop open with it.
//
// READ-ONLY BY CONSTRUCTION, not by a disabled prop: there is no interviewer
// write path to coding_submissions anywhere, including in RLS. This component
// could not overwrite the candidate's code if it tried.
// =============================================================================

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { RefreshCw, X } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { StatusChip } from "@/components/ui/StatusChip";
import { FormError } from "@/components/states";
import { LANGUAGE_LABELS, isCodingLanguage } from "@/lib/coding/languages";
import {
  isTerminalStatus,
  STATUS_LABELS,
  STATUS_TONE,
  type CodingSessionStatus,
} from "@/lib/coding/session";

const POLL_INTERVAL_MS = 5000;

export type MonitorSnapshot = {
  id: string;
  status: CodingSessionStatus;
  candidate_name: string;
  job_title: string;
  language: string | null;
  code: string | null;
  last_saved_at: string | null;
  last_saved_label: string;
  save_count: number;
  submitted_at: string | null;
  cancelled_reason: string | null;
};

export function LiveMonitor({
  initial,
  canCancel,
}: {
  initial: MonitorSnapshot;
  /** From the page's role check. Never re-derived here. */
  canCancel: boolean;
}) {
  const router = useRouter();

  const [snapshot, setSnapshot] = useState(initial);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const [cancelReason, setCancelReason] = useState("");
  const [cancelError, setCancelError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const live = !isTerminalStatus(snapshot.status);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);

  const poll = useCallback(
    async ({ manual = false }: { manual?: boolean } = {}) => {
      if (manual) setRefreshing(true);
      try {
        const response = await fetch(`/api/coding-sessions/${initial.id}`, {
          cache: "no-store",
        });
        if (!response.ok) {
          const payload = await response.json().catch(() => null);
          setError(payload?.error ?? "Could not refresh the candidate's code.");
          return;
        }
        const payload = await response.json();
        setSnapshot(payload.data);
        setError(null);
      } catch {
        // A dropped poll is not worth an alarming banner — the next one is five
        // seconds away, and the code on screen is still the last real code.
        setError("Couldn't reach the server. Still showing the last code received.");
      } finally {
        if (manual) setRefreshing(false);
      }
    },
    [initial.id]
  );

  useEffect(() => {
    if (!live) return;

    function start() {
      if (timer.current) return;
      timer.current = setInterval(() => void poll(), POLL_INTERVAL_MS);
    }
    function stop() {
      if (timer.current) {
        clearInterval(timer.current);
        timer.current = null;
      }
    }

    function onVisibility() {
      if (document.visibilityState === "visible") {
        // Catch up immediately rather than waiting out a full interval — coming
        // back to a stale screen is exactly when the interviewer needs it fresh.
        void poll();
        start();
      } else {
        stop();
      }
    }

    if (document.visibilityState === "visible") start();
    document.addEventListener("visibilitychange", onVisibility);

    return () => {
      stop();
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [live, poll]);

  /**
   * A submission arriving mid-poll changes what the rest of the product shows —
   * the evaluation panel gains a row. Refresh the server components once, on
   * the transition only, rather than on every poll.
   */
  const wasLive = useRef(live);
  useEffect(() => {
    if (wasLive.current && !live) router.refresh();
    wasLive.current = live;
  }, [live, router]);

  async function cancel() {
    setBusy(true);
    setCancelError(null);

    const response = await fetch(`/api/coding-sessions/${initial.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: "cancelled", reason: cancelReason }),
    });

    if (!response.ok) {
      const payload = await response.json().catch(() => null);
      setCancelError(payload?.error ?? "Could not cancel this round.");
      setBusy(false);
      return;
    }

    setCancelling(false);
    setBusy(false);
    await poll();
    router.refresh();
  }

  const language =
    snapshot.language && isCodingLanguage(snapshot.language)
      ? LANGUAGE_LABELS[snapshot.language]
      : "Not chosen yet";

  return (
    <>
      <div className="card mb-4">
        <div className="coding-monitor__head">
          <div style={{ minWidth: 0 }}>
            <h2 className="title is-5 mb-1">{snapshot.candidate_name}</h2>
            <p className="has-text-secondary" style={{ fontSize: 13 }}>
              {snapshot.job_title} · {language}
            </p>
          </div>
          <div className="is-flex is-align-items-center" style={{ gap: "0.5rem" }}>
            <StatusChip
              tone={STATUS_TONE[snapshot.status]}
              label={STATUS_LABELS[snapshot.status]}
            />
            {live && (
              <Button
                size="small"
                icon={RefreshCw}
                loading={refreshing}
                onClick={() => void poll({ manual: true })}
              >
                Refresh
              </Button>
            )}
          </div>
        </div>

        {error && (
          <p className="has-text-secondary mt-2" style={{ fontSize: 12 }}>
            {error}
          </p>
        )}

        {snapshot.cancelled_reason && (
          <p className="intake-callout mt-3">
            Cancelled — {snapshot.cancelled_reason}
          </p>
        )}
      </div>

      <div className="card mb-4">
        <div className="coding-monitor__head mb-3">
          <h2 className="title is-6 mb-0">
            {snapshot.submitted_at ? "Submitted code" : "Live code"}
          </h2>
          <p className="has-text-secondary" style={{ fontSize: 12 }}>
            {snapshot.submitted_at
              ? `Submitted ${new Date(snapshot.submitted_at).toLocaleString("en-GB", {
                  day: "numeric",
                  month: "short",
                  hour: "2-digit",
                  minute: "2-digit",
                })}`
              : `Last updated: ${snapshot.last_saved_label}`}
          </p>
        </div>

        {snapshot.code === null || snapshot.code.trim().length === 0 ? (
          <p className="has-text-secondary" style={{ fontSize: 14 }}>
            {snapshot.status === "created"
              ? "The candidate hasn't opened the link yet."
              : "The candidate has the page open but hasn't saved anything yet."}
          </p>
        ) : (
          // Plain <pre>, not an editor. Nothing here should be typeable, and
          // shipping a code editor to a screen nobody can type into would cost
          // the interviewer a megabyte for the privilege of not using it.
          <pre className="coding-code" tabIndex={0} aria-label="Candidate's code">
            {snapshot.code}
          </pre>
        )}

        {snapshot.save_count > 0 && (
          <p className="has-text-secondary mt-2" style={{ fontSize: 12 }}>
            {snapshot.save_count} save{snapshot.save_count === 1 ? "" : "s"} so far.
          </p>
        )}
      </div>

      {canCancel && live && (
        <div className="card" style={{ borderColor: "var(--color-error)" }}>
          <h2 className="title is-6 mb-2" style={{ color: "var(--color-error)" }}>
            Danger zone
          </h2>
          <p className="has-text-secondary mb-3" style={{ fontSize: 13 }}>
            Cancelling closes the candidate&apos;s editor immediately and stops their link working.
            Anything they have saved is kept.
          </p>

          {cancelling ? (
            <>
              <FormError message={cancelError} />
              <textarea
                className="textarea mb-3"
                rows={2}
                value={cancelReason}
                onChange={(event) => setCancelReason(event.target.value)}
                placeholder="e.g. We're rescheduling this round — the connection kept dropping."
                aria-label="Why you're cancelling"
              />
              <p className="has-text-secondary mb-3" style={{ fontSize: 12 }}>
                The candidate sees this, so write it for them.
              </p>
              <div className="buttons">
                <Button
                  variant="danger"
                  loading={busy}
                  disabled={cancelReason.trim().length === 0}
                  onClick={() => void cancel()}
                >
                  Cancel this round
                </Button>
                <Button icon={X} onClick={() => setCancelling(false)} disabled={busy}>
                  Keep it open
                </Button>
              </div>
            </>
          ) : (
            <Button variant="danger" size="small" onClick={() => setCancelling(true)}>
              Cancel this coding round
            </Button>
          )}
        </div>
      )}
    </>
  );
}
