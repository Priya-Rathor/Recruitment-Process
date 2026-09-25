"use client";

// =============================================================================
// The test-call flow, extracted so there is exactly ONE of it.
//
// Two controls now start a test call: "Call me" in the Test Agent section, and
// "Get call from agent" in the page header. The brief is explicit that the second
// is "a convenience shortcut to the same action, not a duplicate feature", and its
// test is "no duplicated/divergent logic".
//
// A hook is what makes that true rather than intended. Both controls read and
// write the same state and call the same place(), so the cap, the confirmation,
// the polling and the error handling cannot drift apart — and there is no second
// fetch() to forget to update.
//
// THE CONFIRMATION STAYS IN ONE PLACE TOO.
//
// The header button does NOT dial. It arms the confirmation and the page scrolls
// to it, because this product's rule for anything that telephones a person is an
// explicit confirm that NAMES THE NUMBER — and the number lives in the Test Agent
// section. A header button that dialled straight from a click would be a second,
// weaker safety path.
// =============================================================================

import { useCallback, useEffect, useRef, useState } from "react";
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

export function isTerminalCallStatus(status: string): boolean {
  return TERMINAL.has(status);
}

/** Every 4s, and never for more than ~5 minutes — a call that long is over. */
const POLL_INTERVAL_MS = 4_000;
const POLL_LIMIT = 75;

export type TestCallController = {
  phoneNumber: string;
  setPhoneNumber: (value: string) => void;
  /** True once a number looks dialable. Drives both buttons' disabled state. */
  dialable: boolean;
  /** The confirmation step is armed. Both controls set this; the section shows it. */
  confirming: boolean;
  arm: () => void;
  cancel: () => void;
  place: () => Promise<void>;
  busy: boolean;
  error: string | null;
  call: TestCall | null;
};

export function useTestCall({
  agentId,
  initialCall,
}: {
  agentId: string;
  initialCall: TestCall | null;
}): TestCallController {
  const [phoneNumber, setPhoneNumberState] = useState("");
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [call, setCall] = useState<TestCall | null>(initialCall);

  // A ref, not state: the poll count must not re-render 75 times.
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
      // A failed poll leaves the last known state alone — blanking the readout
      // because one request 500'd would look like the call vanished.
      if (next) setCall(next);
    }, POLL_INTERVAL_MS);

    return () => clearTimeout(timer);
  }, [call, poll]);

  const setPhoneNumber = useCallback((value: string) => {
    setPhoneNumberState(value);
    // Editing the number retracts the confirmation. Otherwise an armed confirm
    // could end up naming one number while the field holds another.
    setConfirming(false);
  }, []);

  const place = useCallback(async () => {
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
        // A provider refusal still recorded a row — show it, so the failure lands
        // in the call history rather than only in a message that disappears.
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
  }, [agentId, phoneNumber, poll]);

  return {
    phoneNumber,
    setPhoneNumber,
    dialable: phoneNumber.replace(/\D/g, "").length >= 8,
    confirming,
    arm: useCallback(() => setConfirming(true), []),
    cancel: useCallback(() => setConfirming(false), []),
    place,
    busy,
    error,
    call,
  };
}
