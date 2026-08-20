"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

/**
 * Manual reminder dispatch.
 *
 * A button rather than a schedule, because this product has no scheduler — see
 * the note at the bottom of lib/notifications/reminders.ts. Showing a button is
 * honest about that; a "reminders are sent daily at 9am" line in the settings
 * screen would not be, since nothing runs at 9am.
 *
 * Safe to press repeatedly: the dispatcher dedupes against the last 24 hours.
 * The result says how many were suppressed, so a second press reporting "0 sent,
 * 4 already sent recently" reads as working rather than broken.
 *
 * MODULE 15 ADDED CANDIDATE-FACING INTERVIEW REMINDERS to the same dispatcher, and
 * this button now surfaces the one thing that queue can report which the other
 * three cannot: that it is switched OFF. "Nothing is overdue" when reminders are
 * disabled would send somebody looking for a bug that is not there.
 */
export function ReminderButton() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<string | null>(null);
  const [isError, setIsError] = useState(false);

  async function run() {
    setBusy(true);
    setResult(null);
    setIsError(false);

    try {
      const response = await fetch("/api/notifications/reminders", { method: "POST" });
      const payload = await response.json();

      if (!response.ok) {
        setIsError(true);
        setResult(payload.error ?? "Couldn't send reminders.");
        return;
      }

      const { sent, suppressed, partialFailure, interviews } = payload.data as {
        sent: number;
        suppressed: number;
        partialFailure: boolean;
        interviews?: { skipped: boolean; reason: string | null };
      };

      // Appended rather than replacing the count: the internal reminders may well
      // have gone out even while the candidate-facing one is off.
      const note = interviews?.skipped && interviews.reason ? ` Candidate interview reminders: ${interviews.reason}` : "";

      if (partialFailure) {
        // Never let a failed read render as "nothing was due".
        setIsError(true);
        setResult(
          `Sent ${sent}, but some queues couldn't be checked — the count may be incomplete.${note}`
        );
      } else if (sent === 0 && suppressed === 0) {
        setResult(`Nothing is overdue.${note}`);
      } else if (sent === 0) {
        setResult(`Nothing new — ${suppressed} already reminded in the last 24 hours.${note}`);
      } else {
        setResult(`Sent ${sent} reminder${sent === 1 ? "" : "s"}.${note}`);
      }

      router.refresh();
    } catch {
      setIsError(true);
      setResult("Couldn't reach the server.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="is-flex is-align-items-center" style={{ gap: "0.75rem" }}>
      {result && (
        <span
          style={{
            fontSize: 13,
            color: isError ? "var(--color-error)" : "var(--color-secondary-text)",
          }}
        >
          {result}
        </span>
      )}
      <button
        type="button"
        className={`button is-small ${busy ? "is-loading" : ""}`}
        onClick={run}
        disabled={busy}
      >
        Send overdue reminders
      </button>
    </div>
  );
}
