"use client";

// =============================================================================
// Settings → Onboarding Documents.
//
// The organization's checklist, applied to every hire from here on.
//
// REORDERING HAS TWO CONTROLS, NOT ONE. A drag handle for a mouse, and up/down
// buttons for everyone else — a keyboard user, a screen-reader user, and anyone
// on a touch device where HTML5 drag events do not fire. Drag-only reordering is
// simply unusable for a chunk of people, and the arrows cost one button each.
//
// SAVING IS EXPLICIT PER ROW. A toggle writes immediately because it is a single
// unambiguous fact; the name and description sit behind a Save, per the design
// system's rule against silent auto-save on config edits.
// =============================================================================

import { useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowDown, ArrowUp, GripVertical, Plus, Trash2 } from "lucide-react";
import { Toggle } from "@/components/ui/Toggle";
import { StatusChip } from "@/components/ui/StatusChip";
import { FormError } from "@/components/states";
import { DOCUMENT_OWNER_LABELS, DOCUMENT_OWNERS, type DocumentOwner } from "@/lib/onboarding/documents";
import type { DocumentTemplate } from "@/lib/onboarding/queries";

type Draft = {
  name: string;
  description: string;
  required: boolean;
  expected_from: DocumentOwner;
};

const EMPTY_DRAFT: Draft = {
  name: "",
  description: "",
  required: true,
  expected_from: "candidate",
};

export function DocumentTemplates({
  initial,
  reminderDays,
}: {
  initial: DocumentTemplate[];
  reminderDays: number;
}) {
  const router = useRouter();

  const [templates, setTemplates] = useState(initial);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState<Draft>(EMPTY_DRAFT);
  const [dragId, setDragId] = useState<string | null>(null);
  const [days, setDays] = useState(String(reminderDays));
  const [savingDays, setSavingDays] = useState(false);
  const [daysSaved, setDaysSaved] = useState(false);

  async function patch(id: string, body: Record<string, unknown>) {
    setBusyId(id);
    setError(null);

    const response = await fetch(`/api/settings/document-templates/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });

    setBusyId(null);

    if (!response.ok) {
      const payload = await response.json().catch(() => null);
      setError(payload?.error ?? "Could not save that change.");
      // Reload rather than leave the row showing a value that was refused.
      router.refresh();
      return false;
    }

    const payload = await response.json();
    const updated = payload.data as DocumentTemplate;
    setTemplates((current) => current.map((row) => (row.id === id ? { ...row, ...updated } : row)));
    return true;
  }

  async function add() {
    if (draft.name.trim().length === 0) {
      setError("Give this document type a name.");
      return;
    }

    setBusyId("new");
    setError(null);

    const response = await fetch("/api/settings/document-templates", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: draft.name,
        description: draft.description || null,
        required: draft.required,
        expected_from: draft.expected_from,
        active: true,
      }),
    });

    setBusyId(null);

    if (!response.ok) {
      const payload = await response.json().catch(() => null);
      setError(payload?.error ?? "Could not add that document type.");
      return;
    }

    const payload = await response.json();
    setTemplates((current) => [...current, payload.data as DocumentTemplate]);
    setDraft(EMPTY_DRAFT);
    setAdding(false);
  }

  async function remove(template: DocumentTemplate) {
    setBusyId(template.id);
    setError(null);

    const response = await fetch(`/api/settings/document-templates/${template.id}`, {
      method: "DELETE",
    });

    setBusyId(null);

    if (!response.ok) {
      const payload = await response.json().catch(() => null);
      setError(payload?.error ?? "Could not remove that document type.");
      return;
    }

    setTemplates((current) => current.filter((row) => row.id !== template.id));
  }

  /** Writes the whole order in one request — see the reorder route. */
  async function commitOrder(next: DocumentTemplate[]) {
    setTemplates(next);
    setError(null);

    const response = await fetch("/api/settings/document-templates/reorder", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ids: next.map((row) => row.id) }),
    });

    if (!response.ok) {
      const payload = await response.json().catch(() => null);
      setError(payload?.error ?? "Could not save the new order.");
      router.refresh();
    }
  }

  function move(index: number, direction: -1 | 1) {
    const target = index + direction;
    if (target < 0 || target >= templates.length) return;

    const next = [...templates];
    [next[index], next[target]] = [next[target], next[index]];
    commitOrder(next);
  }

  function dropOn(targetId: string) {
    if (!dragId || dragId === targetId) return;

    const from = templates.findIndex((row) => row.id === dragId);
    const to = templates.findIndex((row) => row.id === targetId);
    if (from === -1 || to === -1) return;

    const next = [...templates];
    const [moved] = next.splice(from, 1);
    next.splice(to, 0, moved);
    setDragId(null);
    commitOrder(next);
  }

  async function saveDays() {
    const value = Number(days);
    if (!Number.isFinite(value) || value < 0 || value > 90) {
      setError("Set the reminder between 0 and 90 days. 0 switches it off.");
      return;
    }

    setSavingDays(true);
    setDaysSaved(false);
    setError(null);

    const response = await fetch("/api/settings", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ onboarding_settings: { pendingReminderDays: Math.floor(value) } }),
    });

    setSavingDays(false);

    if (!response.ok) {
      const payload = await response.json().catch(() => null);
      setError(payload?.error ?? "Could not save the reminder setting.");
      return;
    }
    setDaysSaved(true);
  }

  return (
    <>
      <FormError message={error} />

      {/*
        Said once, plainly, at the top. The behaviour is deliberate — a hire
        halfway through a checklist must not have documents appear or vanish
        under them — but it is not guessable, and a recruiter who edits this
        expecting it to fix a live hire would be quietly wrong.
      */}
      <div className="ai-panel mb-4">
        <p style={{ fontSize: "var(--text-label)", fontWeight: 600, color: "var(--color-info)" }}>
          Changes here apply to new hires going forward
        </p>
        <p className="has-text-secondary mt-1" style={{ fontSize: "var(--text-label)" }}>
          Onboarding checklists already in progress keep the documents they were created with, so
          nobody midway through has an item added or removed under them.
        </p>
      </div>

      <div className="card mb-4">
        <div className="is-flex is-justify-content-space-between is-align-items-center mb-3">
          <h3 className="title is-6 mb-0">Document checklist</h3>
          {!adding && (
            <button type="button" className="button is-outlined-primary is-small" onClick={() => setAdding(true)}>
              <Plus size={14} aria-hidden="true" />
              Add document type
            </button>
          )}
        </div>

        {templates.length === 0 ? (
          <p className="has-text-secondary" style={{ fontSize: "var(--text-label)" }}>
            No document types yet. Hires created now would get an empty checklist — add the
            documents you collect.
          </p>
        ) : (
          <ul className="doc-template-list">
            {templates.map((template, index) => (
              <li
                key={template.id}
                className={`doc-template${dragId === template.id ? " is-dragging" : ""}${
                  template.active ? "" : " is-inactive"
                }`}
                draggable
                onDragStart={() => setDragId(template.id)}
                onDragEnd={() => setDragId(null)}
                onDragOver={(event) => event.preventDefault()}
                onDrop={() => dropOn(template.id)}
              >
                <span className="doc-template__handle" aria-hidden="true" title="Drag to reorder">
                  <GripVertical size={15} />
                </span>

                {/* The accessible path to the same result. */}
                <div className="doc-template__arrows">
                  <button
                    type="button"
                    className="button is-small"
                    aria-label={`Move ${template.name} earlier`}
                    disabled={index === 0}
                    onClick={() => move(index, -1)}
                  >
                    <ArrowUp size={12} aria-hidden="true" />
                  </button>
                  <button
                    type="button"
                    className="button is-small"
                    aria-label={`Move ${template.name} later`}
                    disabled={index === templates.length - 1}
                    onClick={() => move(index, 1)}
                  >
                    <ArrowDown size={12} aria-hidden="true" />
                  </button>
                </div>

                <div className="doc-template__body">
                  <TemplateFields
                    template={template}
                    busy={busyId === template.id}
                    onSave={(fields) => patch(template.id, fields)}
                  />
                </div>

                <div className="doc-template__controls">
                  <label className="doc-template__required">
                    <input
                      type="checkbox"
                      checked={template.required}
                      disabled={busyId === template.id}
                      onChange={(event) => patch(template.id, { required: event.target.checked })}
                    />
                    Required
                  </label>

                  <div className="doc-template__active">
                    <span style={{ fontSize: "var(--text-caption)", color: "var(--color-text-secondary)" }}>
                      {template.active ? "Active" : "Inactive"}
                    </span>
                    <Toggle
                      checked={template.active}
                      disabled={busyId === template.id}
                      label={`${template.name} active`}
                      onChange={(next) => patch(template.id, { active: next })}
                    />
                  </div>

                  <button
                    type="button"
                    className="button is-small doc-template__remove"
                    aria-label={`Remove ${template.name}`}
                    disabled={busyId === template.id}
                    onClick={() => remove(template)}
                  >
                    <Trash2 size={13} aria-hidden="true" />
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}

        {adding && (
          <div className="doc-template-new mt-4">
            <h4 className="title is-6 mb-3">New document type</h4>

            <div className="field">
              <label className="label" htmlFor="template-name">Name</label>
              <input
                id="template-name"
                className="input"
                type="text"
                maxLength={120}
                placeholder="e.g. Work permit"
                value={draft.name}
                onChange={(event) => setDraft({ ...draft, name: event.target.value })}
              />
            </div>

            <div className="field">
              <label className="label" htmlFor="template-description">Description</label>
              <textarea
                id="template-description"
                className="textarea"
                rows={2}
                maxLength={500}
                placeholder="What exactly is being asked for, and why."
                value={draft.description}
                onChange={(event) => setDraft({ ...draft, description: event.target.value })}
              />
            </div>

            <div className="is-flex mb-3" style={{ gap: "var(--space-4)", flexWrap: "wrap" }}>
              <div className="field mb-0">
                <label className="label" htmlFor="template-owner">Provided by</label>
                <div className="select">
                  <select
                    id="template-owner"
                    value={draft.expected_from}
                    onChange={(event) =>
                      setDraft({ ...draft, expected_from: event.target.value as DocumentOwner })
                    }
                  >
                    {DOCUMENT_OWNERS.map((owner) => (
                      <option key={owner} value={owner}>
                        {DOCUMENT_OWNER_LABELS[owner]}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div className="field mb-0">
                <span className="label">Requirement</span>
                <label className="doc-template__required" style={{ height: 40 }}>
                  <input
                    type="checkbox"
                    checked={draft.required}
                    onChange={(event) => setDraft({ ...draft, required: event.target.checked })}
                  />
                  Required to complete onboarding
                </label>
              </div>
            </div>

            <div className="is-flex" style={{ gap: "var(--space-2)" }}>
              <button
                type="button"
                className={`button is-primary is-small ${busyId === "new" ? "is-loading" : ""}`}
                disabled={busyId === "new" || draft.name.trim().length === 0}
                onClick={add}
              >
                Add document type
              </button>
              <button
                type="button"
                className="button is-small"
                onClick={() => {
                  setAdding(false);
                  setDraft(EMPTY_DRAFT);
                  setError(null);
                }}
              >
                Cancel
              </button>
            </div>
          </div>
        )}
      </div>

      <div className="card">
        <h3 className="title is-6">Overdue reminder</h3>
        <p className="has-text-secondary mb-3" style={{ fontSize: "var(--text-label)" }}>
          How long a required document may sit Pending before the person it is assigned to is
          reminded. Set 0 to switch reminders off.
        </p>

        <div className="is-flex is-align-items-flex-end" style={{ gap: "var(--space-3)" }}>
          <div className="field mb-0" style={{ maxWidth: 140 }}>
            <label className="label" htmlFor="reminder-days">Days</label>
            <input
              id="reminder-days"
              className="input"
              type="number"
              min={0}
              max={90}
              value={days}
              onChange={(event) => {
                setDays(event.target.value);
                setDaysSaved(false);
              }}
            />
          </div>
          <button
            type="button"
            className={`button is-primary is-small ${savingDays ? "is-loading" : ""}`}
            disabled={savingDays}
            onClick={saveDays}
          >
            Save
          </button>
          {daysSaved && <StatusChip tone="success" label="Saved" />}
        </div>

        {/*
          Said out loud, because the alternative is a user believing reminders go
          out overnight when nothing runs overnight. Same honesty as Module 15's
          own reminder button.
        */}
        <p className="has-text-secondary mt-3" style={{ fontSize: "var(--text-caption)" }}>
          There is no scheduler in this product yet, so reminders go out when someone triggers
          them from the notifications screen — not automatically at a fixed hour.
        </p>
      </div>
    </>
  );
}

/**
 * Name and description behind an explicit Save.
 *
 * Uncontrolled inputs keyed on the stored value, so a refresh re-seeds them
 * without an effect that sets state during render.
 */
function TemplateFields({
  template,
  busy,
  onSave,
}: {
  template: DocumentTemplate;
  busy: boolean;
  onSave: (fields: Record<string, unknown>) => Promise<boolean>;
}) {
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(template.name);
  const [description, setDescription] = useState(template.description ?? "");

  if (!editing) {
    return (
      <>
        <p className="doc-template__name">
          {template.name}
          <span className="doc-template__owner">
            {DOCUMENT_OWNER_LABELS[template.expected_from]}
          </span>
        </p>
        {template.description && (
          <p className="doc-template__description">{template.description}</p>
        )}
        <button
          type="button"
          className="text-link"
          onClick={() => {
            setName(template.name);
            setDescription(template.description ?? "");
            setEditing(true);
          }}
        >
          Edit
        </button>
      </>
    );
  }

  return (
    <div className="doc-template__edit">
      <input
        className="input is-small"
        type="text"
        maxLength={120}
        aria-label="Document name"
        value={name}
        onChange={(event) => setName(event.target.value)}
      />
      <textarea
        className="textarea is-small"
        rows={2}
        maxLength={500}
        aria-label="Document description"
        value={description}
        onChange={(event) => setDescription(event.target.value)}
      />
      <div className="is-flex" style={{ gap: "var(--space-2)" }}>
        <button
          type="button"
          className={`button is-primary is-small ${busy ? "is-loading" : ""}`}
          disabled={busy || name.trim().length === 0}
          onClick={async () => {
            const saved = await onSave({
              name,
              description: description || null,
              expected_from: template.expected_from,
              required: template.required,
              active: template.active,
            });
            if (saved) setEditing(false);
          }}
        >
          Save
        </button>
        <button type="button" className="button is-small" onClick={() => setEditing(false)}>
          Cancel
        </button>
      </div>
    </div>
  );
}
