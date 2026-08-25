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
import { Eye, Mail, MessageCircle, Pencil, Plug, Plus, Trash2 } from "lucide-react";
import { FormError } from "@/components/states";
import { formatDateTimeInZone } from "@/lib/time";
import { StatusChip } from "@/components/ui/StatusChip";
import { Toggle } from "@/components/ui/Toggle";
import {
  COMMUNICATION_EVENT_DEFINITIONS,
  type CommunicationEventKey,
} from "@/lib/communications/events";
import type { MessageTemplate } from "@/lib/communications/templates";
import type { TemplateGroup } from "@/lib/communications/queries";
import { TemplateEditor } from "./TemplateEditor";

/** The channel filter. "all" is a filter value, not a channel. */
type ChannelFilter = "all" | "email" | "whatsapp";

export function TemplateLibrary({
  groups,
  emailConnected,
  whatsappConnected,
  timeZone,
  canManage,
}: {
  groups: TemplateGroup[];
  emailConnected: boolean;
  whatsappConnected: boolean;
  timeZone: string;
  /**
   * Owner/Admin. False for a Recruiter or Viewer, who read the library without
   * being able to change organization-wide messaging.
   *
   * One prop rather than the role: the page owns the rule, this component asks a
   * question. The routes and RLS enforce it independently — nothing here is a
   * boundary.
   */
  canManage: boolean;
}) {
  const router = useRouter();
  const [channelFilter, setChannelFilter] = useState<ChannelFilter>("all");

  const [editing, setEditing] = useState<MessageTemplate | null>(null);
  const [creatingFor, setCreatingFor] = useState<CommunicationEventKey | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirmingDelete, setConfirmingDelete] = useState<string | null>(null);

  /*
    ONE LIST, FILTERED — not two pages.

    A `both` template matches BOTH filters, because it genuinely sends on both.
    Hiding it under "Email" would tell an admin filtering for email problems that
    a template which emails candidates does not exist.

    Groups whose templates all filter out are kept, not dropped: an empty event
    group is the useful one — it is how somebody sees that "Offer extended" would
    send nothing. Dropping it would make a gap invisible, which is the reason the
    unfiltered list shows empty groups in the first place.
  */
  const visibleGroups = groups.map((group) => ({
    ...group,
    templates: group.templates.filter(
      (template) =>
        channelFilter === "all" ||
        template.channel === channelFilter ||
        template.channel === "both"
    ),
  }));

  const filteredCount = visibleGroups.reduce(
    (total, group) => total + group.templates.length,
    0
  );

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
          readOnly={!canManage}
          emailConnected={emailConnected}
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
          {/*
            Lands on the Email card itself rather than the top of the
            integrations page — the anchor the settings grid already uses, so
            somebody sent here to fix a channel arrives at the control that
            fixes it.
          */}
          <Link className="text-link" href="/settings/integrations#integration-email">
            <Plug size={14} aria-hidden="true" />
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

      {/*
        All / Email / WhatsApp. Tabs rather than a dropdown: three options that
        change what the list shows are worth one click, not two.
      */}
      <div className="tpl-filter" role="tablist" aria-label="Filter templates by channel">
        {(
          [
            { key: "all", label: "All", icon: null },
            { key: "email", label: "Email", icon: Mail },
            { key: "whatsapp", label: "WhatsApp", icon: MessageCircle },
          ] as { key: ChannelFilter; label: string; icon: typeof Mail | null }[]
        ).map((option) => {
          const Icon = option.icon;
          const selected = channelFilter === option.key;
          return (
            <button
              key={option.key}
              type="button"
              role="tab"
              aria-selected={selected}
              className={`tpl-filter__tab${selected ? " is-active" : ""}`}
              onClick={() => setChannelFilter(option.key)}
            >
              {Icon && <Icon size={14} aria-hidden="true" />}
              {option.label}
            </button>
          );
        })}

        <span className="tpl-filter__count" role="status" aria-live="polite">
          {filteredCount} {filteredCount === 1 ? "template" : "templates"}
          {channelFilter !== "all" && " on this channel"}
        </span>
      </div>

      {filteredCount === 0 && channelFilter !== "all" && (
        <div className="card mb-4">
          <p style={{ fontSize: 14, margin: 0 }}>
            No {channelFilter === "email" ? "email" : "WhatsApp"} templates yet. Templates that send
            on both channels appear under both filters.
          </p>
        </div>
      )}

      {visibleGroups.map((group) => {
        const definition = COMMUNICATION_EVENT_DEFINITIONS[group.eventKey];

        return (
          /*
            SPACING SAYS WHAT BELONGS TO WHAT.

            The header sat 8px from its own template row and 16px from the next
            event's card — so each row read as if it belonged to the group BELOW
            it. Backwards. Now 16px inside a group and 32px between groups, which
            is the same 2:1 relationship the settings landing grid uses.
          */
          <div className="card tpl-group" key={group.eventKey}>
            <div
              className="is-flex is-justify-content-space-between is-align-items-flex-start tpl-group__head"
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

              {canManage && (
                <button
                  type="button"
                  className="button is-small is-outlined-primary"
                  onClick={() => setCreatingFor(group.eventKey)}
                >
                  <Plus size={14} aria-hidden="true" />
                  New template
                </button>
              )}
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
                          {/*
                            ONE CHIP PER CHANNEL, each coloured by that channel's
                            REAL connection state.

                            The combined "Email + WhatsApp" chip could not carry
                            this: a template that sends on both, with only one
                            connected, is half-working — and a single flat label
                            said nothing about which half. Two chips make the
                            answer readable without opening anything.

                            Same StatusChip and the same tones the Integrations
                            page uses, so "connected" looks identical wherever it
                            appears.
                          */}
                          {(template.channel === "email" || template.channel === "both") && (
                            <StatusChip
                              tone={emailConnected ? "success" : "neutral"}
                              label="Email"
                              icon={Mail}
                            />
                          )}
                          {(template.channel === "whatsapp" || template.channel === "both") && (
                            <StatusChip
                              tone={whatsappConnected ? "success" : "neutral"}
                              label="WhatsApp"
                              icon={MessageCircle}
                            />
                          )}
                          {template.active ? (
                            <StatusChip tone="success" label="Sending automatically" />
                          ) : (
                            <StatusChip tone="neutral" label="Off" />
                          )}
                          {/* Organization timezone, so this reads the same for
                              everyone on the team — see lib/time.ts. */}
                          <span className="tpl-edited">
                            Edited {formatDateTimeInZone(template.updated_at, timeZone)}
                          </span>
                        </div>

                        {/*
                          Said on the ROW, not only in the banner at the top.

                          A template switched on against a disconnected channel is
                          the one state that looks like it is working and is not —
                          the toggle reads On, the chip reads "Sending
                          automatically", and nothing arrives. The banner above
                          says the channel is down; this says which template it
                          costs.

                          Only shown when ACTIVE. An inactive template on a
                          disconnected channel is not a problem to solve today.
                        */}
                        {template.active && (
                          <>
                            {(template.channel === "email" || template.channel === "both") &&
                              !emailConnected && (
                                <p className="tpl-row-warning">
                                  Email not connected — this won&apos;t send yet.
                                </p>
                              )}
                            {(template.channel === "whatsapp" || template.channel === "both") &&
                              !whatsappConnected && (
                                <p className="tpl-row-warning">
                                  WhatsApp not connected — this won&apos;t send yet.
                                </p>
                              )}
                          </>
                        )}
                      </div>

                      <div
                        className="is-flex is-align-items-center"
                        style={{ gap: "0.75rem" }}
                      >
                        {/*
                          A Recruiter or Viewer gets "View" and nothing else.

                          The write controls are ABSENT rather than disabled — the
                          settings area's rule throughout is to hide what a role
                          cannot do rather than present a wall of dead switches.
                          The status chip beside the name already says whether the
                          template is sending, so nothing is lost by removing the
                          toggle.
                        */}
                        {canManage ? (
                          <>
                            <Toggle
                              checked={template.active}
                              disabled={busyId === template.id}
                              label={template.active ? "On" : "Off"}
                              onChange={(next) => toggle(template, next)}
                            />
                            <button
                              type="button"
                              className="button is-small is-outlined-primary"
                              onClick={() => setEditing(template)}
                            >
                              <Pencil size={14} aria-hidden="true" />
                              Edit
                            </button>
                            {/*
                              DELETE MUST NOT LOOK LIKE EDIT.

                              These sat side by side in identical grey, which is a
                              real hazard rather than an inconsistency: the two
                              buttons are adjacent, one is reversible and one is
                              not, and nothing but the label separated them.
                              `is-danger-soft` is the treatment this product
                              already uses for destructive actions.
                            */}
                            <button
                              type="button"
                              className="button is-small is-danger-soft"
                              onClick={() => setConfirmingDelete(template.id)}
                              disabled={busyId === template.id}
                            >
                              <Trash2 size={14} aria-hidden="true" />
                              Delete
                            </button>
                          </>
                        ) : (
                          <button
                            type="button"
                            className="button is-small is-outlined-primary"
                            onClick={() => setEditing(template)}
                          >
                            <Eye size={14} aria-hidden="true" />
                            View
                          </button>
                        )}
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
                          {/*
                            `is-danger-solid` instead of three inline overrides —
                            the class this product already uses for a confirmed
                            destructive action, so it cannot drift from the others.
                          */}
                          <button
                            type="button"
                            className={`button is-small is-danger-solid ${busyId === template.id ? "is-loading" : ""}`}
                            onClick={() => remove(template)}
                          >
                            Delete it
                          </button>
                          <button
                            type="button"
                            className="button is-small is-quiet"
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
