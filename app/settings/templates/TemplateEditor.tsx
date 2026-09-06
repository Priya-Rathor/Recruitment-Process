"use client";

// =============================================================================
// The template editor.
//
// The body fields use components/PlaceholderEditor — the SAME editor the Job
// Hiring Stage prompts use, with the same picker, caret handling, chip list and
// "Preview with sample data" toggle. It was extracted from that screen rather
// than reimplemented here; see the header of that file.
//
// THE `both` CHANNEL GETS TWO BODIES, and that is the whole reason the channel
// exists as a third option rather than as two separate templates. WhatsApp has no
// subject line and a much shorter useful length, so one shared body would read
// badly on one of the two channels. Two rows would mean two things to switch on
// and two chances to forget.
// =============================================================================
import { useMemo, useState } from "react";
import { FormError } from "@/components/states";
import { PlaceholderEditor } from "@/components/PlaceholderEditor";
/*
  messageFieldsForEvent, not the whole catalogue.

  Interview fields are withheld unless the trigger is interview-related: an offer
  letter has no interview, so {{interview.time}} in a "Hired" template resolves to
  an em dash inside a sentence that reads as finished. Not offering it is the only
  reliable prevention — a warning afterwards is read by nobody.

  Still the SAME picker. components/PlaceholderEditor takes a `fields` prop for
  exactly this ("each caller passes the vocabulary that is true where it renders"),
  so this narrows an argument rather than forking a component.
*/
import { messageFieldsForEvent } from "@/lib/communications/tokens";
import type { PlaceholderField } from "@/lib/hiring-stages/placeholders";
import {
  CHANNEL_LABELS,
  MAX_WHATSAPP_BODY_LENGTH,
  TEMPLATE_CHANNELS,
  type MessageTemplate,
  type TemplateChannel,
} from "@/lib/communications/templates";
import {
  COMMUNICATION_EVENTS,
  COMMUNICATION_EVENT_DEFINITIONS,
  type CommunicationEventKey,
} from "@/lib/communications/events";

export function TemplateEditor({
  template,
  eventKey,
  emailConnected,
  whatsappConnected,
  readOnly = false,
  customFields = [],
  onDone,
  onCancel,
}: {
  /** Null when creating. */
  template: MessageTemplate | null;
  eventKey: CommunicationEventKey;
  emailConnected: boolean;
  whatsappConnected: boolean;
  /**
   * True for a Recruiter or Viewer: the same editor, every field locked and no
   * Save.
   *
   * The SAME component rather than a separate read-only view, so what a recruiter
   * reads is laid out exactly like what an admin writes — including the preview,
   * which is the part they actually came for ("what will this candidate get?").
   * A second display-only component would be a second thing to keep in step.
   */
  readOnly?: boolean;
  /**
   * MODULE 27 — this organization's custom fields, already in PlaceholderField
   * shape.
   *
   * A PROP, not a fetch. The picker's vocabulary is "what is true where this
   * renders" (see the note on lib/hiring-stages/placeholders.ts's lookupFor),
   * and the caller is a server component that already has the definitions. An
   * effect fetching them here would make an empty picker the first thing every
   * editor shows.
   */
  customFields?: PlaceholderField[];
  onDone: () => void;
  onCancel: () => void;
}) {
  const [name, setName] = useState(template?.name ?? "");
  const [event, setEvent] = useState<CommunicationEventKey>(template?.event_key ?? eventKey);
  const [channel, setChannel] = useState<TemplateChannel>(template?.channel ?? "email");
  const [subject, setSubject] = useState(template?.subject ?? "");
  const [body, setBody] = useState(template?.body ?? "");
  const [whatsappBody, setWhatsappBody] = useState(template?.whatsapp_body ?? "");

  /*
    The event's own vocabulary PLUS the organization's custom fields.

    Concatenated rather than merged by key: the two namespaces cannot collide —
    every custom token starts "custom." and no built-in one does — so there is
    nothing to reconcile, and a merge would only invite a precedence rule that
    never fires.
  */
  const pickerFields = useMemo(
    () => [...messageFieldsForEvent(event), ...customFields],
    [event, customFields]
  );


  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [warnings, setWarnings] = useState<string[]>([]);

  const emailIncluded = channel === "email" || channel === "both";
  const whatsappIncluded = channel === "whatsapp" || channel === "both";
  const definition = COMMUNICATION_EVENT_DEFINITIONS[event];

  // The single body doubles as the WhatsApp text when the channel is WhatsApp
  // only, so the length limit follows the channel rather than the field.
  const singleBodyIsWhatsApp = channel === "whatsapp";

  async function save() {
    setBusy(true);
    setError(null);
    setWarnings([]);

    const payload = {
      name,
      event_key: event,
      channel,
      subject: emailIncluded ? subject : null,
      body,
      whatsapp_body: channel === "both" ? whatsappBody : null,
      // NEVER changed by an edit. Activation is its own action with its own
      // confirmation on the list — an editor that could switch a template on as a
      // side effect of a wording change would start messaging candidates while
      // somebody was still drafting.
      active: template?.active ?? false,
    };

    try {
      const response = await fetch(
        template
          ? `/api/settings/message-templates/${template.id}`
          : "/api/settings/message-templates",
        {
          method: template ? "PATCH" : "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        }
      );

      const result = await response.json().catch(() => ({}));

      if (!response.ok) {
        setError(result.error ?? "Couldn't save that template.");
        return;
      }

      // An unrecognised token does not block the save, but it must not vanish
      // either: it is shown before the editor closes.
      if (Array.isArray(result.warnings) && result.warnings.length > 0) {
        setWarnings(result.warnings);
        return;
      }

      onDone();
    } catch {
      setError("Couldn't reach the server.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="card">
      <h2 className="title is-5 mb-1">{template ? "Edit template" : "New template"}</h2>
      <p className="has-text-secondary mb-4" style={{ fontSize: 13 }}>
        Insert fields with the picker — they are replaced with this candidate&apos;s real details
        when the message is sent, never when it is saved.
      </p>

      <div className="field">
        <label className="label" htmlFor="template-name">
          Name
        </label>
        <input
          id="template-name"
          className="input"
          value={name}
          onChange={(changed) => setName(changed.target.value)}
          placeholder="e.g. Shortlisted — engineering roles"
        readOnly={readOnly}
          />
        <p className="help">Only your team sees this. Candidates never do.</p>
      </div>

      <div className="field">
        <label className="label" htmlFor="template-event">
          Event trigger
        </label>
        <div className="select is-fullwidth">
          <select
            id="template-event"
            value={event}
            onChange={(changed) => setEvent(changed.target.value as CommunicationEventKey)}
            disabled={readOnly}
          >
            {COMMUNICATION_EVENTS.map((key) => (
              <option key={key} value={key}>
                {COMMUNICATION_EVENT_DEFINITIONS[key].label}
              </option>
            ))}
          </select>
        </div>
        <p className="help">
          {definition.firesWhen
            ? `Once switched on, this sends ${definition.firesWhen}.`
            : "This event has no automatic trigger in this product. The template still works for a message you send by hand, or from an automation."}
        </p>
      </div>

      <div className="field">
        <label className="label" htmlFor="template-channel">
          Channel
        </label>
        <div className="select is-fullwidth">
          <select
            id="template-channel"
            value={channel}
            onChange={(changed) => setChannel(changed.target.value as TemplateChannel)}
            disabled={readOnly}
          >
            {TEMPLATE_CHANNELS.map((option) => (
              <option key={option} value={option}>
                {CHANNEL_LABELS[option]}
              </option>
            ))}
          </select>
        </div>
        {/*
          ONE TREATMENT FOR BOTH CHANNELS.

          Only WhatsApp warned here, so a disconnected EMAIL integration said
          nothing at all on the page where somebody writes an email — the exact
          asymmetry that teaches people a warning's absence means everything is
          fine. Same class, same amber, same shape of sentence; only the channel
          and the reassurance differ.
        */}
        {emailIncluded && !emailConnected && (
          <p className="tpl-channel-warning">
            Email isn&apos;t connected yet, so the email half of this template will be recorded as
            “not sent” until it is.
            {whatsappIncluded && " The WhatsApp half is unaffected."}
          </p>
        )}
        {whatsappIncluded && !whatsappConnected && (
          <p className="tpl-channel-warning">
            WhatsApp isn&apos;t connected yet, so the WhatsApp half of this template will be
            recorded as “not sent” until it is.
            {emailIncluded && " The email half is unaffected."}
          </p>
        )}
      </div>

      {emailIncluded && (
        <div className="field">
          <label className="label" htmlFor="template-subject">
            Email subject
          </label>
          <input
            id="template-subject"
            className="input"
            value={subject}
            onChange={(changed) => setSubject(changed.target.value)}
            placeholder="e.g. Your application for {{job.title}}"
          readOnly={readOnly}
          />
          <p className="help">
            Placeholders work here too. WhatsApp has no subject line, so this is email only.
          </p>
        </div>
      )}

      <PlaceholderEditor
        id="template-body"
        label={channel === "both" ? "Email body" : "Message body"}
        help={
          singleBodyIsWhatsApp
            ? `Keep it short — WhatsApp messages are read on a phone, and this one has to stay under ${MAX_WHATSAPP_BODY_LENGTH} characters.`
            : "Write it as you would write it to one person. The unsubscribe line is added automatically to every automatic send and cannot be removed."
        }
        value={body}
        onChange={setBody}
        rows={channel === "both" ? 10 : 8}
        fields={pickerFields}
          readOnly={readOnly}
        placeholder="Hi {{candidate.name}}, …"
        footer={
          singleBodyIsWhatsApp ? (
            <CharacterCount value={body} limit={MAX_WHATSAPP_BODY_LENGTH} />
          ) : null
        }
      />

      {channel === "both" && (
        <PlaceholderEditor
          id="template-whatsapp-body"
          label="WhatsApp body"
          help="Shorter, no subject, no signature. Left blank, the email body is sent instead — which works, but reads long on a phone."
          value={whatsappBody}
          onChange={setWhatsappBody}
          rows={5}
          fields={pickerFields}
          readOnly={readOnly}
          placeholder="Hi {{candidate.name}}, …"
          footer={<CharacterCount value={whatsappBody} limit={MAX_WHATSAPP_BODY_LENGTH} />}
        />
      )}

      <FormError message={error} />

      {warnings.length > 0 && (
        <div className="mt-3" style={{ fontSize: 13 }}>
          {warnings.map((warning, index) => (
            <p key={index} className="stage-warning">
              {warning}
            </p>
          ))}
          <p className="has-text-secondary mt-2" style={{ fontSize: 12 }}>
            Saved anyway. Fix the field and save again, or leave it — it will be sent exactly as
            written.
          </p>
          <button type="button" className="button is-small is-quiet mt-2" onClick={onDone}>
            Done
          </button>
        </div>
      )}

      {/*
        NO SAVE AT ALL in read-only mode, rather than a disabled one.

        A greyed-out Save invites a recruiter to hunt for the permission that would
        enable it. "Close" says the truth: this is a thing you read.
      */}
      {readOnly ? (
        <div className="buttons mt-4">
          <button type="button" className="button is-outlined-primary" onClick={onCancel}>
            Close
          </button>
        </div>
      ) : (
        warnings.length === 0 && (
          <div className="buttons mt-4">
            <button
              type="button"
              className={`button is-primary ${busy ? "is-loading" : ""}`}
              onClick={save}
              disabled={busy}
            >
              {template ? "Save changes" : "Create template"}
            </button>
            <button type="button" className="button is-quiet" onClick={onCancel} disabled={busy}>
              Cancel
            </button>
          </div>
        )
      )}

      {template?.active && (
        <p className="has-text-secondary mt-3" style={{ fontSize: 12 }}>
          This template is live. Saving changes the words the next candidate receives.
        </p>
      )}
    </div>
  );
}

/** Counts down rather than up, because the limit is the thing that matters. */
function CharacterCount({ value, limit }: { value: string; limit: number }) {
  const remaining = limit - value.length;
  const over = remaining < 0;

  return (
    <p
      style={{
        fontSize: 12,
        marginTop: 4,
        color: over ? "var(--color-error)" : "var(--color-secondary-text)",
      }}
    >
      {over
        ? `${Math.abs(remaining)} characters over the WhatsApp limit`
        : `${remaining} characters left`}
    </p>
  );
}
