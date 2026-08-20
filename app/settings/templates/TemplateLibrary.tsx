"use client";

// =============================================================================
// The template library.
//
// Grouped by event, INCLUDING events with nothing behind them — an empty group is
// the useful one, because it is how an admin sees that "Offer extended" would send
// nothing today. A list of only what exists makes a gap invisible.
//
// THE ACTIVE TOGGLE IS THE ONE CONTROL THAT SENDS REAL MESSAGES, so it is the one
// place on this page with a confirmation. Everything else edits words; this starts
// messaging candidates.
//
// Saving is EXPLICIT throughout (AGENTS.md: "Config edits use an explicit Save,
// never silent auto-save"). The toggle is the deliberate exception: it is a single
// boolean behind its own confirmation, and an unsaved-switch state would be a
// switch that lies about what the product is doing.
// =============================================================================
import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Mail, MessageCircle, Pencil, Plus, Trash2 } from "lucide-react";
import { FormError } from "@/components/states";
import { StatusChip } from "@/components/ui/StatusChip";
import { Toggle } from "@/components/ui/Toggle";
import {
  COMMUNICATION_EVENT_DEFINITIONS,
  type CommunicationEventKey,
} from "@/lib/communications/events";
import { CHANNEL_LABELS, type MessageTemplate } from "@/lib/communications/templates";
import type { TemplateGroup } from "@/lib/communications/queries";
import { TemplateEditor } from "./TemplateEditor";

export function TemplateLibrary({
  groups,
  emailConnected,
  whatsappConnected,
}: {
  groups: TemplateGroup[];
  emailConnected: boolean;
  whatsappConnected: boolean;
}) {
  const router = useRouter();

  const [editing, setEditing] = useState<MessageTemplate | null>(null);
  const [creatingFor, setCreatingFor] = useState<CommunicationEventKey | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirmingDelete, setConfirmingDelete] = useState<string | null>(null);

  const activeCount = groups.reduce(
    (total, group) => total + group.templates.filter((template) => template.active).length,
    0
  );

  async function toggle(template: MessageTemplate, active: boolean) {
    setBusyId(template.id);
    setError(null);

    try {
      const response = await fetch(`/api/settings/message-templates/${template.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ active }),
      });

      if (!response.ok) {
        const payload = await response.json().catch(() => ({}));
        setError(payload.error ?? "Couldn't change that template.");
        return;
      }

      router.refresh();
    } catch {
      setError("Couldn't reach the server.");
    } finally {
      setBusyId(null);
    }
  }

  async function remove(template: MessageTemplate) {
    setBusyId(template.id);
    setError(null);

    try {
      const response = await fetch(`/api/settings/message-templates/${template.id}`, {
        method: "DELETE",
      });

      if (!response.ok) {
        const payload = await response.json().catch(() => ({}));
        setError(payload.error ?? "Couldn't delete that template.");
        return;
      }

      setConfirmingDelete(null);
      router.refresh();
    } catch {
      setError("Couldn't reach the server.");
    } finally {
      setBusyId(null);
    }
  }

  if (editing || creatingFor) {
    return (
      <TemplateEditor
        template={editing}
        eventKey={editing?.event_key ?? (creatingFor as CommunicationEventKey)}
        whatsappConnected={whatsappConnected}
        onDone={() => {
          setEditing(null);
          setCreatingFor(null);
          router.refresh();
        }}
        onCancel={() => {
          setEditing(null);
          setCreatingFor(null);
        }}
      />
    );
  }

  return (
    <>
      {/*
        The state of the world, stated before the list. A team that has just
        installed this needs to know that nothing is sending yet; a team with
        eleven active templates needs to know that too.
      */}
      <div className="card mb-4">
        <p style={{ fontSize: 14, marginBottom: 8 }}>
          {activeCount === 0 ? (
            <>
              <strong>Nothing is sending automatically.</strong> Every template below is switched
              off, which is how they ship — review the wording, then switch on the ones you want.
            </>
          ) : (
            <>
              <strong>
                {activeCount} {activeCount === 1 ? "template sends" : "templates send"}{" "}
                automatically.
              </strong>{" "}
              Each one goes out the moment its event happens, without anybody reviewing it.
            </>
          )}
        </p>

        {/*
          Channel health, said here rather than discovered as a silent skip. An
          active email template on a disconnected email integration sends nothing,
          and the log would fill with "not sent" rows nobody was expecting.
        */}
        <div className="is-flex" style={{ gap: "0.5rem", flexWrap: "wrap" }}>
          <StatusChip
            tone={emailConnected ? "success" : "neutral"}
            label={emailConnected ? "Email connected" : "Email not connected"}
            icon={Mail}
          />
          <StatusChip
            tone={whatsappConnected ? "success" : "neutral"}
            label={whatsappConnected ? "WhatsApp connected" : "WhatsApp not connected"}
            icon={MessageCircle}
          />
          <Link className="text-link" href="/settings/integrations">
            Manage channels
          </Link>
        </div>

        {!emailConnected && (
          <p className="has-text-secondary mt-2" style={{ fontSize: 12 }}>
            Until email is connected, an active email template records every send as “not sent” in
            the communication log rather than reaching anyone.
          </p>
        )}
      </div>

      <FormError message={error} />

      {groups.map((group) => {
        const definition = COMMUNICATION_EVENT_DEFINITIONS[group.eventKey];

        return (
          <div className="card mb-4" key={group.eventKey}>
            <div
              className="is-flex is-justify-content-space-between is-align-items-flex-start mb-2"
              style={{ gap: "1rem" }}
            >
              <div style={{ minWidth: 0 }}>
                <h3 className="title is-6 mb-1">{definition.label}</h3>
                <p className="has-text-secondary" style={{ fontSize: 13, margin: 0 }}>
                  {definition.description}
                </p>
                {/*
                  Where it fires from, in the org's own terms — and, for the two
                  events this product has no send point for, the plain truth
                  instead of a switch that would do nothing.
                */}
                <p
                  className="has-text-secondary"
                  style={{ fontSize: 12, margin: "4px 0 0" }}
                >
                  {definition.firesWhen
                    ? `Sends ${definition.firesWhen}.`
                    : "No automatic trigger — this product has no point in the pipeline that means this event. Send it by hand, or from an automation."}
                </p>
              </div>

              <button
                type="button"
                className="button is-small"
                onClick={() => setCreatingFor(group.eventKey)}
              >
                <Plus size={14} aria-hidden="true" />
                New template
              </button>
            </div>

            {group.templates.length === 0 ? (
              <p className="has-text-secondary" style={{ fontSize: 13 }}>
                Nothing here yet, so this event sends nothing.
              </p>
            ) : (
              <ul>
                {group.templates.map((template) => (
                  <li
                    key={template.id}
                    className="py-3"
                    style={{ borderTop: "1px solid var(--color-border)" }}
                  >
                    <div
                      className="is-flex is-justify-content-space-between is-align-items-center"
                      style={{ gap: "0.75rem", flexWrap: "wrap" }}
                    >
                      <div style={{ minWidth: 0, flex: "1 1 240px" }}>
                        <p style={{ fontSize: 14, fontWeight: 600, margin: 0 }}>{template.name}</p>
                        <div
                          className="is-flex mt-1"
                          style={{ gap: "0.5rem", alignItems: "center", flexWrap: "wrap" }}
                        >
                          <span className="intake-chip is-info">
                            {CHANNEL_LABELS[template.channel]}
                          </span>
                          {template.active ? (
                            <StatusChip tone="success" label="Sending automatically" />
                          ) : (
                            <StatusChip tone="neutral" label="Off" />
                          )}
                        </div>
                      </div>

                      <div
                        className="is-flex is-align-items-center"
                        style={{ gap: "0.75rem" }}
                      >
                        <Toggle
                          checked={template.active}
                          disabled={busyId === template.id}
                          label={template.active ? "On" : "Off"}
                          onChange={(next) => toggle(template, next)}
                        />
                        <button
                          type="button"
                          className="button is-small"
                          onClick={() => setEditing(template)}
                        >
                          <Pencil size={14} aria-hidden="true" />
                          Edit
                        </button>
                        <button
                          type="button"
                          className="button is-small"
                          onClick={() => setConfirmingDelete(template.id)}
                          disabled={busyId === template.id}
                        >
                          <Trash2 size={14} aria-hidden="true" />
                          Delete
                        </button>
                      </div>
                    </div>

                    {confirmingDelete === template.id && (
                      <div
                        className="mt-3"
                        style={{
                          border: "1px solid var(--color-warning)",
                          borderRadius: 8,
                          padding: 12,
                        }}
                      >
                        <p style={{ fontSize: 13, marginBottom: 8 }}>
                          Delete “{template.name}”? Messages already sent from it stay in the
                          communication log with their exact wording — the log stores what was sent,
                          not a link to this template.
                        </p>
                        <div className="buttons">
                          <button
                            type="button"
                            className={`button is-small ${busyId === template.id ? "is-loading" : ""}`}
                            style={{
                              background: "var(--color-error)",
                              color: "#fff",
                              borderColor: "transparent",
                            }}
                            onClick={() => remove(template)}
                          >
                            Delete it
                          </button>
                          <button
                            type="button"
                            className="button is-small"
                            onClick={() => setConfirmingDelete(null)}
                          >
                            Keep it
                          </button>
                        </div>
                      </div>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </div>
        );
      })}
    </>
  );
}
