"use client";

// =============================================================================
// The candidate's communication card.
//
// Two things a recruiter needs before they type anything:
//
//   1. WHETHER THIS PERSON HAS ASKED US TO STOP. The chips are at the top, and the
//      spec is explicit that they belong here "so recruiters see it before
//      attempting a manual send too".
//   2. WHAT WE HAVE ALREADY SAID. The log below, rolled up across every
//      application this candidate holds — the same component the Application page
//      uses, so "Delivered" cannot come to mean two different things.
//
// LIFTING AN OPT-OUT IS A CONFIRMED ACTION, AND MORE GUARDED THAN SETTING ONE.
//
// Recording an opt-out is a recruiter writing down what they were told. Lifting one
// is the product resuming contact with somebody who asked it to stop, which needs
// evidence — the candidate said so — and it is the direction that causes a
// complaint. So it has a confirmation and the copy says what it is for.
// =============================================================================
import { useState } from "react";
import { useRouter } from "next/navigation";
import { MailX, MessageCircleOff } from "lucide-react";
import { FormError } from "@/components/states";
import { StatusChip } from "@/components/ui/StatusChip";
import { CommunicationLog } from "@/components/CommunicationLog";
import type { CommunicationPreferences, MessageLogEntry } from "@/lib/communications/queries";
import { formatDateTimeInZone } from "@/lib/time";

export function CommunicationCard({
  candidateId,
  candidateName,
  preferences,
  messages,
  messagesFailed,
  timeZone,
  canManage,
}: {
  candidateId: string;
  candidateName: string;
  preferences: CommunicationPreferences;
  messages: MessageLogEntry[];
  messagesFailed: boolean;
  timeZone: string;
  /** Owner/Admin/Recruiter. The API enforces it independently. */
  canManage: boolean;
}) {
  const router = useRouter();

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirming, setConfirming] = useState<"email" | "whatsapp" | null>(null);

  async function setOptOut(next: { email: boolean; whatsapp: boolean }, reason: string | null) {
    setBusy(true);
    setError(null);

    try {
      const response = await fetch(`/api/candidates/${candidateId}/communication-preferences`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          // Both flags always, never a partial update — see the route's header.
          email_opted_out: next.email,
          whatsapp_opted_out: next.whatsapp,
          opted_out_reason: reason,
        }),
      });

      if (!response.ok) {
        const payload = await response.json().catch(() => ({}));
        setError(payload.error ?? "Couldn't save that.");
        return;
      }

      setConfirming(null);
      router.refresh();
    } catch {
      setError("Couldn't reach the server.");
    } finally {
      setBusy(false);
    }
  }

  const anyOptOut = preferences.email_opted_out || preferences.whatsapp_opted_out;

  return (
    <div className="card mb-4" id="communications">
      <div className="is-flex is-justify-content-space-between is-align-items-flex-start mb-3">
        <div>
          <h2 className="title is-5 mb-1">Communications</h2>
          <p className="has-text-secondary" style={{ fontSize: 13, margin: 0 }}>
            Every message sent to {candidateName}, across all their applications.
          </p>
        </div>
      </div>

      {/* ---- Opt-out state ------------------------------------------------- */}
      <div className="is-flex mb-3" style={{ gap: "0.5rem", flexWrap: "wrap" }}>
        {preferences.unknown ? (
          /*
            The absence of a chip must mean "they have not opted out", never "we
            do not know". A recruiter about to press Send needs that distinction.
          */
          <StatusChip tone="warning" label="Opt-out status unknown" />
        ) : (
          <>
            {preferences.email_opted_out && (
              <StatusChip tone="warning" label="Email opted out" icon={MailX} />
            )}
            {preferences.whatsapp_opted_out && (
              <StatusChip tone="warning" label="WhatsApp opted out" icon={MessageCircleOff} />
            )}
            {!anyOptOut && <StatusChip tone="success" label="Happy to be contacted" />}
          </>
        )}
      </div>

      {anyOptOut && preferences.opted_out_at && (
        <p className="has-text-secondary mb-3" style={{ fontSize: 12 }}>
          Recorded {formatDateTimeInZone(preferences.opted_out_at, timeZone)}
          {preferences.opted_out_reason ? ` — ${preferences.opted_out_reason}` : ""}
        </p>
      )}

      {anyOptOut && (
        <p className="has-text-secondary mb-3" style={{ fontSize: 12 }}>
          Automatic messages skip the opted-out channel. A recruiter can still send by hand — with a
          warning first — so an answer to a question this candidate asked is never blocked.
        </p>
      )}

      {canManage && (
        <div className="buttons mb-3">
          {(["email", "whatsapp"] as const).map((channel) => {
            const optedOut =
              channel === "email" ? preferences.email_opted_out : preferences.whatsapp_opted_out;

            return (
              <button
                key={channel}
                type="button"
                className={`button is-small ${busy ? "is-loading" : ""}`}
                disabled={busy}
                onClick={() => {
                  if (optedOut) {
                    // Lifting: confirm first. See the header.
                    setConfirming(channel);
                    return;
                  }
                  setOptOut(
                    {
                      email: channel === "email" ? true : preferences.email_opted_out,
                      whatsapp: channel === "whatsapp" ? true : preferences.whatsapp_opted_out,
                    },
                    "Recorded by a recruiter."
                  );
                }}
              >
                {optedOut
                  ? `Allow ${channel === "email" ? "email" : "WhatsApp"} again`
                  : `Record ${channel === "email" ? "email" : "WhatsApp"} opt-out`}
              </button>
            );
          })}
        </div>
      )}

      {confirming && (
        <div
          className="mb-3"
          style={{ border: "1px solid var(--color-warning)", borderRadius: 8, padding: 12 }}
        >
          <p style={{ fontSize: 14, fontWeight: 600, marginBottom: 6 }}>
            Start sending {candidateName} automatic{" "}
            {confirming === "email" ? "emails" : "WhatsApp messages"} again?
          </p>
          <p style={{ fontSize: 13, marginBottom: 10 }}>
            Only do this if they have told you they want to hear from us again. They asked us to
            stop, and resuming without being asked is the thing an opt-out exists to prevent.
          </p>
          <div className="buttons">
            <button
              type="button"
              className={`button is-small ${busy ? "is-loading" : ""}`}
              style={{
                background: "var(--color-warning)",
                color: "#fff",
                borderColor: "transparent",
              }}
              disabled={busy}
              onClick={() =>
                setOptOut(
                  {
                    email: confirming === "email" ? false : preferences.email_opted_out,
                    whatsapp: confirming === "whatsapp" ? false : preferences.whatsapp_opted_out,
                  },
                  null
                )
              }
            >
              They asked us to resume
            </button>
            <button
              type="button"
              className="button is-small"
              onClick={() => setConfirming(null)}
              disabled={busy}
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      <FormError message={error} />

      {/* ---- The log ------------------------------------------------------- */}
      <CommunicationLog
        messages={messages}
        failed={messagesFailed}
        timeZone={timeZone}
        // One candidate can hold five applications, so each row names its job.
        showJob
        emptyMessage={`Nothing has been sent to ${candidateName} yet.`}
      />
    </div>
  );
}
