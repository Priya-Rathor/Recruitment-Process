"use client";

// =============================================================================
// "Send message" — the manual path, always available alongside the automatic one.
//
// THE PREVIEW USES THE SAME RENDERER THE SEND USES.
//
// renderMessage() here, renderMessage() in the route, one implementation in
// lib/communications/tokens.ts. A preview built from a second renderer is worse
// than no preview, because it is believed — and the values it renders against are
// this application's REAL details, loaded on the server and passed in, not sample
// data.
//
// THE OPT-OUT FLOW IS TWO STEPS, DELIBERATELY.
//
// The first Send returns 409 with the reason. The warning appears, and the button
// changes to say what it will do. Only then does the request carry
// `acknowledge_opt_out`. The spec: "never silently block a human-initiated
// message, but do warn them first" — a one-click send with a warning printed
// somewhere on the page is not a warning, and a hard block would stop a recruiter
// answering a question the candidate themselves asked.
// =============================================================================
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Mail, MessageCircle, Send, X } from "lucide-react";
import { FormError } from "@/components/states";
import { StatusChip } from "@/components/ui/StatusChip";
import { renderMessage } from "@/lib/communications/tokens";
import {
  bodyFor,
  MAX_WHATSAPP_BODY_LENGTH,
  subjectFor,
  type MessageTemplate,
  type SendChannel,
} from "@/lib/communications/templates";
import type { PlaceholderValues } from "@/lib/hiring-stages/placeholders";

export type SendMessagePanelProps = {
  applicationId: string;
  candidateName: string;
  /** Resolved on the server from this application's real rows. */
  values: PlaceholderValues;
  /** Every template in the library, active or not — a human may send any of them. */
  templates: MessageTemplate[];
  candidateEmail: string | null;
  candidatePhone: string | null;
  emailOptedOut: boolean;
  whatsappOptedOut: boolean;
  /** So the panel can say a channel will not deliver before anything is typed. */
  emailConnected: boolean;
  whatsappConnected: boolean;
};

export function SendMessagePanel(props: SendMessagePanelProps) {
  const router = useRouter();
  const [open, setOpen] = useState(false);

  if (!open) {
    return (
      <button
        type="button"
        className="button is-outlined-primary is-small"
        onClick={() => setOpen(true)}
      >
        <Send size={14} aria-hidden="true" />
        Send message
      </button>
    );
  }

  return <Composer {...props} onClose={() => setOpen(false)} onSent={() => router.refresh()} />;
}

function Composer({
  applicationId,
  candidateName,
  values,
  templates,
  candidateEmail,
  candidatePhone,
  emailOptedOut,
  whatsappOptedOut,
  emailConnected,
  whatsappConnected,
  onClose,
  onSent,
}: SendMessagePanelProps & { onClose: () => void; onSent: () => void }) {
  const [channel, setChannel] = useState<SendChannel>("email");
  const [templateId, setTemplateId] = useState<string>("");
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [warning, setWarning] = useState<string | null>(null);
  const [result, setResult] = useState<{ status: string; detail: string | null } | null>(null);

  const optedOut = channel === "email" ? emailOptedOut : whatsappOptedOut;
  const connected = channel === "email" ? emailConnected : whatsappConnected;
  const recipient = channel === "email" ? candidateEmail : candidatePhone;

  // Templates that can go out on the chosen channel. A WhatsApp-only template
  // offered under Email would pre-fill a body with no subject and then be refused.
  const usable = templates.filter(
    (template) => template.channel === "both" || template.channel === channel
  );

  function applyTemplate(nextId: string) {
    setTemplateId(nextId);
    setResult(null);

    if (!nextId) {
      setSubject("");
      setBody("");
      return;
    }

    const template = templates.find((candidate) => candidate.id === nextId);
    if (!template) return;

    // Pre-filled with the RAW template, tokens intact, so the recruiter edits the
    // template's own language and any field they add still resolves on send. The
    // preview below shows what it becomes.
    setSubject(subjectFor(template, channel) ?? "");
    setBody(bodyFor(template, channel));
  }

  const resolvedSubject = renderMessage(subject, values);
  const resolvedBody = renderMessage(body, values);

  async function send(acknowledge: boolean) {
    setBusy(true);
    setError(null);
    if (!acknowledge) setWarning(null);

    try {
      const response = await fetch("/api/messages", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          application_id: applicationId,
          channel,
          template_id: templateId || null,
          subject: channel === "email" ? subject : null,
          body,
          acknowledge_opt_out: acknowledge,
        }),
      });

      const payload = await response.json().catch(() => ({}));

      if (!response.ok) {
        // 409 + a code is the "warn, then let them decide" path. Anything else is
        // a genuine error and stays an error.
        if (
          response.status === 409 &&
          (payload.code === "opted_out" || payload.code === "opt_out_unknown")
        ) {
          setWarning(payload.error);
          return;
        }
        setError(payload.error ?? "Couldn't send that message.");
        return;
      }

      setResult({ status: payload.data?.status ?? "sent", detail: payload.data?.detail ?? null });
      setWarning(null);
      onSent();
    } catch {
      setError("Couldn't reach the server.");
    } finally {
      setBusy(false);
    }
  }

  if (result) {
    const delivered = result.status === "sent";

    return (
      <div className="card mb-4" style={{ flexBasis: "100%" }}>
        <div className="is-flex is-justify-content-space-between is-align-items-center mb-2">
          <h3 className="title is-6 mb-0">
            {delivered ? "Message sent" : "Nothing was sent"}
          </h3>
          <button type="button" className="button is-small" onClick={onClose}>
            Close
          </button>
        </div>
        <p style={{ fontSize: 14 }}>
          {delivered
            ? `${candidateName} has been messaged. It is recorded in Communications below.`
            : (result.detail ?? "The attempt is recorded in Communications below.")}
        </p>
      </div>
    );
  }

  return (
    // flexBasis: the header renders this inside a wrapping flex row beside "Edit
    // application", and a full basis puts the composer on its own line rather than
    // squeezing a form into a button strip.
    <div className="card mb-4" style={{ flexBasis: "100%" }}>
      <div className="is-flex is-justify-content-space-between is-align-items-flex-start mb-3">
        <div>
          <h3 className="title is-6 mb-1">Send {candidateName} a message</h3>
          <p className="has-text-secondary" style={{ fontSize: 13, margin: 0 }}>
            Sent by you, recorded against this application, and never counted as an automatic send.
          </p>
        </div>
        <button type="button" className="button is-small" onClick={onClose} aria-label="Close">
          <X size={14} aria-hidden="true" />
        </button>
      </div>

      {/* ---- Channel ------------------------------------------------------- */}
      <div className="field">
        <label className="label" htmlFor="message-channel">
          Channel
        </label>
        <div className="select">
          <select
            id="message-channel"
            value={channel}
            onChange={(event) => {
              const next = event.target.value as SendChannel;
              setChannel(next);
              // The chosen template may not cover the new channel, and silently
              // keeping a stale pre-fill would send the wrong words.
              setTemplateId("");
              setSubject("");
              setBody("");
              setWarning(null);
            }}
          >
            <option value="email">Email</option>
            <option value="whatsapp">WhatsApp</option>
          </select>
        </div>

        <div className="is-flex mt-2" style={{ gap: "0.5rem", flexWrap: "wrap" }}>
          {optedOut && (
            <StatusChip
              tone="warning"
              label={channel === "email" ? "Opted out of email" : "Opted out of WhatsApp"}
            />
          )}
          {!connected && (
            <StatusChip
              tone="neutral"
              label={channel === "email" ? "Email not connected" : "WhatsApp not connected"}
              icon={channel === "email" ? Mail : MessageCircle}
            />
          )}
          {!recipient && (
            <StatusChip
              tone="warning"
              label={channel === "email" ? "No email address on file" : "No phone number on file"}
            />
          )}
        </div>
      </div>

      {/* ---- Template or one-off ------------------------------------------- */}
      <div className="field">
        <label className="label" htmlFor="message-template">
          Template
        </label>
        <div className="select is-fullwidth">
          <select
            id="message-template"
            value={templateId}
            onChange={(event) => applyTemplate(event.target.value)}
          >
            <option value="">Write a one-off message</option>
            {usable.map((template) => (
              <option key={template.id} value={template.id}>
                {template.name}
                {template.active ? "" : " (off — still fine to send by hand)"}
              </option>
            ))}
          </select>
        </div>
        <p className="help">
          Picking one fills the fields below and you can still edit them. A template that is
          switched off does not send automatically, but you may still use its wording.
        </p>
      </div>

      {channel === "email" && (
        <div className="field">
          <label className="label" htmlFor="message-subject">
            Subject
          </label>
          <input
            id="message-subject"
            className="input"
            value={subject}
            onChange={(event) => setSubject(event.target.value)}
            placeholder="Your application for {{job.title}}"
          />
        </div>
      )}

      <div className="field">
        <label className="label" htmlFor="message-body">
          Message
        </label>
        <textarea
          id="message-body"
          className="textarea"
          rows={8}
          value={body}
          onChange={(event) => setBody(event.target.value)}
          placeholder={`Hi ${candidateName.split(" ")[0] ?? "there"},`}
        />
        {channel === "whatsapp" && (
          <p
            className="help"
            style={{
              color:
                body.length > MAX_WHATSAPP_BODY_LENGTH
                  ? "var(--color-error)"
                  : "var(--color-text-secondary)",
            }}
          >
            {MAX_WHATSAPP_BODY_LENGTH - body.length} characters left
          </p>
        )}
      </div>

      {/* ---- The preview --------------------------------------------------- */}
      {(body.trim().length > 0 || subject.trim().length > 0) && (
        <div className="stage-preview">
          <p className="stage-preview__label">
            Preview — {candidateName}&apos;s real details, exactly as this will be sent
          </p>
          {channel === "email" && resolvedSubject.trim().length > 0 && (
            <p style={{ fontSize: 14, fontWeight: 600, marginBottom: 6 }}>{resolvedSubject}</p>
          )}
          <pre className="stage-preview__body">{resolvedBody}</pre>
        </div>
      )}

      <FormError message={error} />

      {/* ---- The opt-out warning ------------------------------------------- */}
      {warning && (
        <div
          className="mt-3"
          style={{
            border: "1px solid var(--color-warning)",
            borderRadius: 8,
            padding: 12,
          }}
        >
          <p style={{ fontSize: 14, fontWeight: 600, marginBottom: 6 }}>
            {candidateName} has opted out of this channel
          </p>
          <p style={{ fontSize: 13, marginBottom: 10 }}>{warning}</p>
          <div className="buttons">
            <button
              type="button"
              className={`button is-small ${busy ? "is-loading" : ""}`}
              style={{
                background: "var(--color-warning)",
                color: "#fff",
                borderColor: "transparent",
              }}
              onClick={() => send(true)}
              disabled={busy}
            >
              Send anyway
            </button>
            <button
              type="button"
              className="button is-small"
              onClick={() => setWarning(null)}
              disabled={busy}
            >
              Don&apos;t send
            </button>
          </div>
        </div>
      )}

      {!warning && (
        <div className="buttons mt-3">
          <button
            type="button"
            className={`button is-primary is-small ${busy ? "is-loading" : ""}`}
            onClick={() => send(false)}
            disabled={
              busy ||
              body.trim().length === 0 ||
              (channel === "email" && subject.trim().length === 0) ||
              (channel === "whatsapp" && body.length > MAX_WHATSAPP_BODY_LENGTH)
            }
          >
            <Send size={14} aria-hidden="true" />
            Send {channel === "email" ? "email" : "WhatsApp"}
          </button>
          <button type="button" className="button is-small" onClick={onClose} disabled={busy}>
            Cancel
          </button>
        </div>
      )}
    </div>
  );
}
