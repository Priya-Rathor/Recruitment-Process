"use client";

// =============================================================================
// Section 9 — Test Agent.
//
// THIS BUTTON TELEPHONES A REAL PERSON, so it is built like every other outbound
// control in this product rather than like a "run" button:
//
//   - two-step confirm, naming the number that will be dialled
//   - disabled outright when the integration is not connected or the agent has
//     never been synced, with the reason said out loud
//   - the disclosure is not mentioned as a possibility but as a fact, because
//     lib/screening/script.ts emits it and it cannot be switched off
//
// STATUS DISPLAY IS REUSED, NOT REBUILT. The badge is Module 8's CallStatusBadge
// and the underlying row is advanced by the SAME provider webhook that advances a
// screening call, so a test call and a candidate call cannot end up with two
// different ideas of what "no answer" looks like. Module 8 had no polling loop to
// reuse — it refreshes the server component — so the poll is new; it reads our own
// row through our own route and never talks to the provider.
// =============================================================================

import { useCallback, useEffect, useRef, useState } from "react";
import { PhoneCall } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { FormError } from "@/components/ui/states";
import { CallStatusBadge } from "@/app/screening-calls/CallStatusBadge";
import type { TestCall } from "@/lib/voice/queries";

/** Statuses that will not change again, so polling can stop. */
const TERMINAL = new Set([
  "completed",
  "failed",
  "no_answer",
  "busy",
  "cancelled",
  "callback_requested",
]);

/** Every 4s, and never for more than 5 minutes — a call that long is over. */
const POLL_INTERVAL_MS = 4_000;
const POLL_LIMIT = 75;

export function TestAgentSection({
  agentId,
  initialCall,
  connected,
  synced,
  hasUnsavedChanges,
}: {
  agentId: string;
  /** The most recent test call for this agent, so the readout survives a reload. */
  initialCall: TestCall | null;
  connected: boolean;
  synced: boolean;
  hasUnsavedChanges: boolean;
}) {
  const [phoneNumber, setPhoneNumber] = useState("");
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [call, setCall] = useState<TestCall | null>(initialCall);

  // A ref, not state: the poll count must not re-render the component 75 times.
  const pollCount = useRef(0);

  const poll = useCallback(
    async (callId: string): Promise<TestCall | null> => {
      const response = await fetch(
        `/api/settings/voice-agents/${agentId}/test-call?callId=${encodeURIComponent(callId)}`
      );
      if (!response.ok) return null;
      const payload = await response.json();
      return payload.data as TestCall;
    },
    [agentId]
  );

  useEffect(() => {
    if (!call || TERMINAL.has(call.status)) return;
    if (pollCount.current >= POLL_LIMIT) return;

    const timer = setTimeout(async () => {
      pollCount.current += 1;
      const next = await poll(call.id);
      // A failed poll leaves the last known state alone. Blanking the readout
      // because one request 500'd would look like the call vanished.
      if (next) setCall(next);
    }, POLL_INTERVAL_MS);

    return () => clearTimeout(timer);
  }, [call, poll]);

  async function placeCall() {
    setBusy(true);
    setError(null);

    try {
      const response = await fetch(`/api/settings/voice-agents/${agentId}/test-call`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ phoneNumber, confirmed: true }),
      });
      const payload = await response.json().catch(() => null);

      if (!response.ok) {
        setError(payload?.error ?? "Couldn't place the test call.");
        // A provider refusal still recorded a row — show it, so the failure is
        // in the call history rather than only in a toast that disappears.
        if (payload?.data?.callId) {
          const recorded = await poll(payload.data.callId as string);
          if (recorded) setCall(recorded);
        }
        return;
      }

      pollCount.current = 0;
      const started = await poll(payload.data.callId as string);
      setCall(
        started ?? {
          id: payload.data.callId as string,
          status: "dialing",
          phoneNumber,
          startedAt: null,
          endedAt: null,
          durationSeconds: null,
          transcript: null,
          failureReason: null,
          createdAt: new Date().toISOString(),
        }
      );
    } catch {
      setError("Couldn't reach the server.");
    } finally {
      setBusy(false);
      setConfirming(false);
    }
  }

  const dialable = phoneNumber.replace(/\D/g, "").length >= 8;

  const blocked = !connected
    ? "The voice integration isn't connected, so no call can be placed."
    : !synced
      ? "Save this agent first — the provider doesn't have this configuration yet."
      : null;

  return (
    <>
      <div className="vac-test">
        <div className="vac-field">
          <label className="label" htmlFor="vac-test-number">
            Your phone number
          </label>
          <p className="stage-field__help">
            The agent calls this number and runs a short version of the conversation. Include the
            country code.
          </p>
          <input
            id="vac-test-number"
            className="input"
            type="tel"
            placeholder="+91 98765 43210"
            value={phoneNumber}
            onChange={(event) => {
              setPhoneNumber(event.target.value);
              setConfirming(false);
            }}
          />
        </div>

        {blocked ? (
          <p className="stage-warning">{blocked}</p>
        ) : (
          <>
            {/*
              Said before the click, not after. The person answering may not be
              the person who pressed the button, and the disclosure is a legal
              obligation rather than a setting — so it is described as what
              happens, not as an option.
            */}
            <p className="stage-field__help">
              The call opens by stating that it is automated and may be recorded, exactly as a
              candidate call does.
            </p>

            {hasUnsavedChanges && (
              <p className="stage-note">
                You have unsaved changes. The test call uses the <strong>last saved</strong>{" "}
                settings — save first to hear your edits.
              </p>
            )}

            {!confirming ? (
              <Button
                variant="primary"
                icon={PhoneCall}
                disabled={!dialable}
                onClick={() => setConfirming(true)}
              >
                Call me
              </Button>
            ) : (
              <div className="vac-test__confirm">
                <p>
                  Call <strong>{phoneNumber}</strong> now? This places a real phone call.
                </p>
                <div className="buttons">
                  <Button variant="primary" loading={busy} onClick={placeCall}>
                    Yes, call now
                  </Button>
                  <Button onClick={() => setConfirming(false)} disabled={busy}>
                    Cancel
                  </Button>
                </div>
              </div>
            )}
          </>
        )}

        <FormError message={error} />
      </div>

      {call && <TestCallReadout call={call} />}
    </>
  );
}

/**
 * The result.
 *
 * A transcript is shown only when one exists — an empty <pre> reads as "the call
 * said nothing", which is a different fact from "the provider has not sent the
 * transcript yet".
 */
function TestCallReadout({ call }: { call: TestCall }) {
  const settled = TERMINAL.has(call.status);

  return (
    <div className="vac-result">
      <div className="vac-result__head">
        <div>
          <p className="label">Last test call</p>
          <p className="stage-field__help">
            {call.phoneNumber}
            {call.durationSeconds !== null && ` · ${call.durationSeconds}s`}
          </p>
        </div>
        <CallStatusBadge status={call.status} />
      </div>

      {!settled && (
        <p className="stage-field__help">
          Waiting for the provider to report back — this updates on its own.
        </p>
      )}

      {call.failureReason && <p className="stage-warning">{call.failureReason}</p>}

      {call.transcript ? (
        <div className="stage-preview">
          <p className="stage-preview__label">Transcript preview</p>
          <pre className="stage-preview__body">{call.transcript.slice(0, 2000)}</pre>
        </div>
      ) : (
        settled &&
        call.status === "completed" && (
          <p className="stage-field__help">
            No transcript came back with this call. The call itself completed.
          </p>
        )
      )}
    </div>
  );
}
