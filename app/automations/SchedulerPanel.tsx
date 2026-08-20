"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { FormError } from "@/components/states";
import type { LatestSweep } from "@/lib/automations/sweep";

function formatWhen(value: string) {
  return new Date(value).toLocaleString("en-GB", {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/**
 * THE SCHEDULER'S HONEST STATUS, plus the two switches that control it.
 *
 * THE POINT OF THIS PANEL is the difference between three states that all look
 * identical from an empty run history:
 *
 *   - the scheduler has NEVER run (no cron configured — time-based rules do
 *     nothing at all, however healthy they look on their own page);
 *   - it ran and found nothing to do;
 *   - it ran and failed partway.
 *
 * Only the first is a problem with the deployment, and only the third is a bug.
 * Reporting "0 runs" for all three would be true and useless.
 *
 * The kill switch and the manual sweep live here rather than in Settings because
 * this is the page somebody opens when a rule is misbehaving.
 */
export function SchedulerPanel({
  sweep,
  sweepReadFailed,
  enabled,
  scheduledRuleCount,
  canControl,
}: {
  sweep: LatestSweep | null;
  sweepReadFailed: boolean;
  enabled: boolean;
  /** Active rules on a scheduled trigger. Zero changes what "never run" means. */
  scheduledRuleCount: number;
  canControl: boolean;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState<"sweep" | "switch" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<string | null>(null);
  const [confirmingOff, setConfirmingOff] = useState(false);

  async function runSweep() {
    setBusy("sweep");
    setError(null);
    setResult(null);

    try {
      const response = await fetch("/api/automations/sweep", { method: "POST" });
      const payload = await response.json();

      if (!response.ok) {
        setError(payload.error ?? "Couldn't run the scheduler.");
        return;
      }

      const data = payload.data as {
        rulesConsidered: number;
        applicationsScanned: number;
        runsCreated: number;
        truncated: boolean;
        applicationsRemaining: number;
        error: string | null;
      };

      if (data.error) {
        setError(data.error);
        return;
      }

      // Every number is stated, including the zeroes. "Checked 40 applications,
      // nothing was due" is a useful answer; "Done" is not.
      setResult(
        `Checked ${data.applicationsScanned} application${
          data.applicationsScanned === 1 ? "" : "s"
        } against ${data.rulesConsidered} scheduled rule${
          data.rulesConsidered === 1 ? "" : "s"
        } — ${data.runsCreated} run${data.runsCreated === 1 ? "" : "s"} created.` +
          (data.truncated
            ? ` ${data.applicationsRemaining} more were left for the next sweep.`
            : "")
      );
      router.refresh();
    } catch {
      setError("Couldn't reach the server. Try again.");
    } finally {
      setBusy(null);
    }
  }

  async function setSwitch(next: boolean) {
    setBusy("switch");
    setError(null);
    setResult(null);

    try {
      const response = await fetch("/api/automations/switch", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enabled: next }),
      });
      const payload = await response.json();

      if (!response.ok) {
        setError(payload.error ?? "Couldn't change that setting.");
        return;
      }

      setConfirmingOff(false);
      router.refresh();
    } catch {
      setError("Couldn't reach the server. Try again.");
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="card mb-4">
      <div
        className="is-flex is-justify-content-space-between is-align-items-flex-start mb-3"
        style={{ gap: "1rem", flexWrap: "wrap" }}
      >
        <div>
          <h2 className="title is-5 mb-1">Scheduler</h2>
          <p className="has-text-secondary mb-0" style={{ fontSize: 13 }}>
            Runs the rules that fire because time passed, rather than because somebody did
            something.
          </p>
        </div>

        {!enabled && (
          <span
            style={{
              fontSize: 13,
              fontWeight: 600,
              color: "var(--color-error)",
              whiteSpace: "nowrap",
            }}
          >
            All automations are off
          </span>
        )}
      </div>

      {!enabled && (
        <p className="mb-3" style={{ fontSize: 14 }}>
          Automations are switched off for this organization. No rule runs — not the scheduled ones
          and not the ones triggered by somebody&apos;s action. Every rule keeps its own status, so
          switching back on restores exactly what was live before.
        </p>
      )}

      {sweepReadFailed ? (
        <p className="mb-3" style={{ fontSize: 14, color: "var(--color-error)" }}>
          Couldn&apos;t read the scheduler&apos;s history, so there is nothing reliable to report
          here. This is not the same as &quot;it hasn&apos;t run&quot;.
        </p>
      ) : sweep === null ? (
        <p className="mb-3" style={{ fontSize: 14 }}>
          <strong>The scheduler has never run.</strong>{" "}
          {scheduledRuleCount > 0 ? (
            <>
              {scheduledRuleCount} active rule
              {scheduledRuleCount === 1 ? " waits" : "s wait"} on it, so{" "}
              {scheduledRuleCount === 1 ? "it is" : "they are"} doing nothing at all right now.
              Either configure the cron (a <code>CRON_SECRET</code> and a schedule pointing at{" "}
              <code>/api/automations/sweep</code>) or run it by hand below.
            </>
          ) : (
            <>No rules need it yet, so there is nothing to do.</>
          )}
        </p>
      ) : (
        <p className="mb-3" style={{ fontSize: 14 }}>
          Last {sweep.source === "cron" ? "scheduled" : "manual"} run{" "}
          {formatWhen(sweep.startedAt)}
          {sweep.finishedAt === null ? (
            <>
              {" "}
              — <strong>it never finished.</strong> It may have timed out partway, so some rules may
              not have been checked.
            </>
          ) : (
            <>
              {" "}
              — checked {sweep.applicationsScanned} application
              {sweep.applicationsScanned === 1 ? "" : "s"}, created {sweep.runsCreated} run
              {sweep.runsCreated === 1 ? "" : "s"}.
            </>
          )}
          {sweep.errorMessage && (
            <>
              {" "}
              <span style={{ color: "var(--color-error)" }}>{sweep.errorMessage}</span>
            </>
          )}
        </p>
      )}

      <FormError message={error} />

      {result && (
        <p className="mb-3" style={{ fontSize: 13, color: "var(--color-success)" }}>
          {result}
        </p>
      )}

      {canControl && (
        <div className="is-flex" style={{ gap: "0.5rem", flexWrap: "wrap" }}>
          <button
            type="button"
            className={`button is-small ${busy === "sweep" ? "is-loading" : ""}`}
            onClick={runSweep}
            disabled={busy !== null || !enabled}
          >
            Run the scheduler now
          </button>

          {enabled ? (
            confirmingOff ? (
              <>
                <button
                  type="button"
                  className={`button is-small ${busy === "switch" ? "is-loading" : ""}`}
                  style={{ color: "var(--color-error)" }}
                  onClick={() => setSwitch(false)}
                  disabled={busy !== null}
                >
                  Yes, switch everything off
                </button>
                <button
                  type="button"
                  className="button is-small"
                  onClick={() => setConfirmingOff(false)}
                  disabled={busy !== null}
                >
                  Cancel
                </button>
              </>
            ) : (
              <button
                type="button"
                className="button is-small"
                onClick={() => setConfirmingOff(true)}
                disabled={busy !== null}
              >
                Switch all automations off
              </button>
            )
          ) : (
            <button
              type="button"
              className={`button is-small is-primary ${busy === "switch" ? "is-loading" : ""}`}
              onClick={() => setSwitch(true)}
              disabled={busy !== null}
            >
              Switch automations back on
            </button>
          )}
        </div>
      )}
    </div>
  );
}
