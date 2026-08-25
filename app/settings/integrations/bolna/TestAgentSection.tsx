"use client";

// =============================================================================
// Section 9 — Test Agent. Two modes: Call, and Chat.
//
// CALL tests the thing that actually happens to a candidate — voice, pacing,
// interruption handling, the recogniser coping with an accent. It telephones a
// real person, so it keeps every safety property it had: two-step confirm naming
// the number, disabled with a stated reason when the integration isn't connected
// or the agent was never synced, a hard hourly cap server-side, and a disclosure
// that cannot be switched off.
//
// CHAT tests the prompt. It is a text rehearsal against the SAME persona,
// instructions and guardrails, with no call, no call record and no telephony
// charge — see lib/ai/chatAsAgent.ts, which has no database handle at all.
//
// The two are labelled with what each can and cannot tell you, because the
// tempting mistake is to rehearse in chat and ship. Chat cannot hear pacing.
//
// The call flow lives in useTestCall() — shared with the header's "Get call from
// agent" button, so there is one code path and one confirmation, not two.
// =============================================================================

import { useEffect, useRef, useState } from "react";
import { MessageSquare, PhoneCall, Send } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { FormError } from "@/components/ui/states";
import { CallStatusBadge } from "@/app/screening-calls/CallStatusBadge";
import type { AgentSettings } from "@/lib/voice/settings";
import type { TestCall } from "@/lib/voice/queries";
import { isTerminalCallStatus, type TestCallController } from "./useTestCall";

export type Mode = "call" | "chat";

export function TestAgentSection({
  agentId,
  controller,
  settings,
  mode,
  onModeChange,
  connected,
  synced,
  hasUnsavedChanges,
}: {
  agentId: string;
  /** Shared with the header button. See useTestCall. */
  controller: TestCallController;
  /** The DRAFT settings, so Chat rehearses what is on screen. */
  settings: AgentSettings;
  /*
    Mode is owned by the console, not by this section.

    Because the header's "Get call from agent" button has to switch it: arming the
    confirmation while the Chat tab is showing would hide the confirmation behind
    a tab. Lifting the state lets that button say what it means in one handler —
    set the mode, arm, scroll — instead of this component watching `confirming`
    and reacting, which is a setState-in-an-effect and a render behind.
  */
  mode: Mode;
  onModeChange: (mode: Mode) => void;
  connected: boolean;
  synced: boolean;
  hasUnsavedChanges: boolean;
}) {
  const numberRef = useRef<HTMLInputElement>(null);

  /*
    Focus the number field when a confirmation is armed with nothing to dial —
    which is what happens when the header button is pressed first.

    A DOM side effect, not state: this is exactly what an effect is for.
  */
  useEffect(() => {
    if (controller.confirming && !controller.dialable) numberRef.current?.focus();
  }, [controller.confirming, controller.dialable]);

  const blocked = !connected
    ? "The voice integration isn't connected, so no call can be placed."
    : !synced
      ? "Save this agent first — the provider doesn't have this configuration yet."
      : null;

  return (
    <>
      {/* Two modes, one section. Tabs rather than a toggle, because these are two
          different activities rather than one setting being switched. */}
      <div className="vac-tabs" role="tablist" aria-label="How to test this agent">
        <button
          type="button"
          role="tab"
          aria-selected={mode === "call"}
          className={`vac-tabs__tab${mode === "call" ? " is-active" : ""}`}
          onClick={() => onModeChange("call")}
        >
          <PhoneCall size={14} aria-hidden="true" />
          Call
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={mode === "chat"}
          className={`vac-tabs__tab${mode === "chat" ? " is-active" : ""}`}
          onClick={() => onModeChange("chat")}
        >
          <MessageSquare size={14} aria-hidden="true" />
          Chat
        </button>
      </div>

      {/*
        The honest framing, on both tabs. Written so neither mode oversells: chat
        is fastest for the prompt, and cannot tell you how the agent SOUNDS.
      */}
      <p className="vac-tabs__note">
        Chat is the fastest way to test your prompt and persona — for testing voice, pacing, and
        interruption handling, use Call instead.
      </p>

      {mode === "call" ? (
        <CallMode
          controller={controller}
          numberRef={numberRef}
          blocked={blocked}
          hasUnsavedChanges={hasUnsavedChanges}
        />
      ) : (
        <ChatMode agentId={agentId} settings={settings} />
      )}
    </>
  );
}

// -----------------------------------------------------------------------------
// Call
// -----------------------------------------------------------------------------

function CallMode({
  controller,
  numberRef,
  blocked,
  hasUnsavedChanges,
}: {
  controller: TestCallController;
  numberRef: React.RefObject<HTMLInputElement | null>;
  blocked: string | null;
  hasUnsavedChanges: boolean;
}) {
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
            ref={numberRef}
            className="input"
            type="tel"
            placeholder="+91 98765 43210"
            value={controller.phoneNumber}
            onChange={(event) => controller.setPhoneNumber(event.target.value)}
          />
        </div>

        {blocked ? (
          <p className="stage-warning">{blocked}</p>
        ) : (
          <>
            {/* Said before the click, not after. The person answering may not be
                the person who pressed the button, and the disclosure is a legal
                obligation rather than a setting. */}
            <p className="stage-field__help">
              The call opens by stating that it is automated and may be recorded, exactly as a
              candidate call does.
            </p>

            {hasUnsavedChanges && (
              <p className="stage-note">
                You have unsaved changes. The call uses the <strong>last saved</strong> settings —
                save first to hear your edits. (Chat rehearses the unsaved ones.)
              </p>
            )}

            {!controller.confirming ? (
              <Button
                variant="primary"
                icon={PhoneCall}
                disabled={!controller.dialable}
                onClick={controller.arm}
              >
                Call me
              </Button>
            ) : (
              <div className="vac-test__confirm">
                <p>
                  Call <strong>{controller.phoneNumber}</strong> now? This places a real phone call.
                </p>
                <div className="buttons">
                  <Button variant="primary" loading={controller.busy} onClick={controller.place}>
                    Yes, call now
                  </Button>
                  <Button onClick={controller.cancel} disabled={controller.busy}>
                    Cancel
                  </Button>
                </div>
              </div>
            )}
          </>
        )}

        <FormError message={controller.error} />
      </div>

      {controller.call && <TestCallReadout call={controller.call} />}
    </>
  );
}

/**
 * The result.
 *
 * A transcript is shown only when one exists — an empty block reads as "the call
 * said nothing", which is a different fact from "the transcript hasn't arrived".
 */
function TestCallReadout({ call }: { call: TestCall }) {
  const settled = isTerminalCallStatus(call.status);

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

// -----------------------------------------------------------------------------
// Chat
// -----------------------------------------------------------------------------

type Bubble = { role: "operator" | "agent"; text: string };

/**
 * The text rehearsal.
 *
 * Conversation state lives HERE and nowhere else — no table, no row. A prompt
 * sandbox does not need a transcript store, and storing rehearsal text that looks
 * like a candidate conversation is how a fake transcript later gets mistaken for
 * evidence.
 *
 * Bubble styling is new: this product had no chat UI to reuse (the communication
 * log is a list of sent messages, not a conversation), so `.vac-chat__*` is the
 * first of its kind rather than a divergent second copy of something.
 */
function ChatMode({ agentId, settings }: { agentId: string; settings: AgentSettings }) {
  const [turns, setTurns] = useState<Bubble[]>([]);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    // Only scrolls the thread, not the page — `block: "nearest"` keeps the long
    // console still while a reply lands.
    endRef.current?.scrollIntoView({ block: "nearest" });
  }, [turns]);

  async function send() {
    const message = draft.trim();
    if (message.length === 0) return;

    const history = turns;
    setTurns([...history, { role: "operator", text: message }]);
    setDraft("");
    setBusy(true);
    setError(null);

    try {
      const response = await fetch(`/api/settings/voice-agents/${agentId}/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        // The DRAFT settings, so the rehearsal reflects unsaved edits — the whole
        // point of testing before committing.
        body: JSON.stringify({ message, history, settings }),
      });
      const payload = await response.json().catch(() => null);

      if (!response.ok) {
        setError(payload?.error ?? "The agent couldn't reply.");
        return;
      }

      setTurns((current) => [...current, { role: "agent", text: payload.data.reply as string }]);
    } catch {
      setError("Couldn't reach the server.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="vac-chat">
      <p className="vac-chat__meta">
        No phone call and no call charge — this runs on text only, against the settings currently on
        screen, including unsaved ones.
      </p>

      <div className="vac-chat__thread" role="log" aria-live="polite" aria-label="Rehearsal">
        {turns.length === 0 && (
          <p className="vac-chat__empty">
            Say something the way a candidate would — &ldquo;Hello?&rdquo;, or an answer to your
            first question — and see how the agent replies.
          </p>
        )}

        {turns.map((turn, index) => (
          <div
            key={index}
            className={`vac-chat__bubble vac-chat__bubble--${turn.role === "agent" ? "agent" : "operator"}`}
          >
            <span className="vac-chat__who">{turn.role === "agent" ? "Agent" : "You"}</span>
            {turn.text}
          </div>
        ))}

        {busy && (
          <div className="vac-chat__bubble vac-chat__bubble--agent vac-chat__bubble--waiting">
            <span className="vac-chat__who">Agent</span>
            Thinking…
          </div>
        )}

        <div ref={endRef} />
      </div>

      <FormError message={error} />

      <div className="vac-chat__compose">
        <input
          className="input"
          type="text"
          placeholder="Type as the candidate…"
          aria-label="Your message"
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => {
            // Enter sends. Without preventDefault this would submit the
            // surrounding form and save a half-finished configuration.
            if (event.key === "Enter") {
              event.preventDefault();
              void send();
            }
          }}
        />
        <Button
          variant="primary"
          icon={Send}
          loading={busy}
          disabled={draft.trim().length === 0}
          onClick={send}
        >
          Send
        </Button>
      </div>

      {turns.length > 0 && (
        <button type="button" className="text-link mt-2" onClick={() => setTurns([])}>
          Clear rehearsal
        </button>
      )}
    </div>
  );
}
