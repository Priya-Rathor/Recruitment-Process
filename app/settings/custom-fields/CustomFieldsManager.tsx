"use client";

// =============================================================================
// The three-tab list of custom field definitions.
//
// DELETE IS A DEACTIVATE, AND THE DIALOG SAYS SO WITH A NUMBER.
//
// The brief asks for the warning ("12 jobs have data in this field") and the
// count is fetched before the dialog opens rather than guessed, because a
// confirmation without it is not a decision — it is a coin toss. The wording
// differs from the brief's in one respect and deliberately: the brief says you
// can restore "by re-adding a field with the same key", but a soft-deleted row
// still holds that key, so re-adding it would collide. Turning it back ON is
// what actually restores it, and that is what the dialog offers.
// =============================================================================
import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowDown, ArrowUp, Pencil, Plus, Trash2 } from "lucide-react";
import { EmptyState, FormError } from "@/components/ui/states";
import {
  CUSTOM_FIELD_ENTITIES,
  ENTITY_LABELS,
  FIELD_TYPE_LABELS,
  type CustomFieldDefinition,
  type CustomFieldEntity,
} from "@/lib/customFields/definitions";
import { FieldEditor, type EditorDraft } from "./FieldEditor";

type PendingDelete = { definition: CustomFieldDefinition; valueCount: number };

export function CustomFieldsManager({
  definitions,
  canEdit,
}: {
  definitions: CustomFieldDefinition[];
  canEdit: boolean;
}) {
  const router = useRouter();

  const [entity, setEntity] = useState<CustomFieldEntity>("job");
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<CustomFieldDefinition | null>(null);
  const [pendingDelete, setPendingDelete] = useState<PendingDelete | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const forEntity = useMemo(
    () => definitions.filter((definition) => definition.entity_type === entity),
    [definitions, entity]
  );

  const takenKeys = useMemo(
    () => forEntity.map((definition) => definition.field_key),
    [forEntity]
  );

  async function call(input: string, init: RequestInit): Promise<boolean> {
    setBusy(true);
    setError(null);

    const response = await fetch(input, init);
    const payload = (await response.json().catch(() => null)) as { error?: string } | null;

    setBusy(false);

    if (!response.ok) {
      setError(payload?.error ?? "That didn't work.");
      return false;
    }

    // Server-rendered list; refresh rather than mutating local state, so what is
    // on screen is what the database actually holds.
    router.refresh();
    return true;
  }

  async function create(draft: EditorDraft) {
    const ok = await call("/api/custom-fields/definitions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ entity_type: entity, ...draft }),
    });
    if (ok) setAdding(false);
  }

  async function update(id: string, patch: Record<string, unknown>) {
    return call(`/api/custom-fields/definitions/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(patch),
    });
  }

  async function saveEdit(draft: EditorDraft) {
    if (!editing) return;
    const ok = await update(editing.id, draft);
    if (ok) setEditing(null);
  }

  /**
   * Swaps a field with its neighbour.
   *
   * Two PATCHes rather than one bulk reorder endpoint. The list is short (a
   * handful of fields per entity) and a swap is the only reorder this UI offers,
   * so a dedicated route would be a second way to write the same column.
   */
  async function move(index: number, direction: -1 | 1) {
    const target = index + direction;
    if (target < 0 || target >= forEntity.length) return;

    const a = forEntity[index];
    const b = forEntity[target];

    setBusy(true);
    setError(null);

    const responses = await Promise.all([
      fetch(`/api/custom-fields/definitions/${a.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ display_order: b.display_order }),
      }),
      fetch(`/api/custom-fields/definitions/${b.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ display_order: a.display_order }),
      }),
    ]);

    setBusy(false);

    if (responses.some((response) => !response.ok)) {
      setError("Could not reorder those fields.");
    }
    router.refresh();
  }

  /** Reads the value count BEFORE opening the dialog — see the file header. */
  async function askToDelete(definition: CustomFieldDefinition) {
    setBusy(true);
    setError(null);

    const response = await fetch(`/api/custom-fields/definitions/${definition.id}`);
    const payload = (await response.json().catch(() => null)) as
      | { data?: { value_count?: number } }
      | null;

    setBusy(false);

    if (!response.ok) {
      setError("Could not check that field.");
      return;
    }

    setPendingDelete({ definition, valueCount: payload?.data?.value_count ?? 0 });
  }

  async function confirmDelete(permanent: boolean) {
    if (!pendingDelete) return;
    const query = permanent ? "?permanent=true" : "";
    const ok = await call(`/api/custom-fields/definitions/${pendingDelete.definition.id}${query}`, {
      method: "DELETE",
    });
    if (ok) setPendingDelete(null);
  }

  return (
    <div>
      <div className="tabs is-boxed" style={{ marginBottom: 16 }}>
        <ul>
          {CUSTOM_FIELD_ENTITIES.map((candidate) => (
            <li key={candidate} className={candidate === entity ? "is-active" : ""}>
              <a
                onClick={() => {
                  setEntity(candidate);
                  setAdding(false);
                  setEditing(null);
                  setPendingDelete(null);
                }}
              >
                {ENTITY_LABELS[candidate]}
                <span className="has-text-secondary" style={{ marginLeft: 6, fontSize: 12 }}>
                  {definitions.filter((d) => d.entity_type === candidate).length}
                </span>
              </a>
            </li>
          ))}
        </ul>
      </div>

      <FormError message={error} />

      {pendingDelete && (
        <div className="card mb-4" style={{ padding: 16, borderLeft: "3px solid var(--color-warning)" }}>
          <p style={{ fontWeight: 600, fontSize: 14 }}>
            Turn off &quot;{pendingDelete.definition.label}&quot;?
          </p>

          {pendingDelete.valueCount > 0 ? (
            <p className="has-text-secondary mt-1" style={{ fontSize: 13 }}>
              {pendingDelete.valueCount}{" "}
              {entity === "job" ? "job" : entity === "candidate" ? "candidate" : "application"}
              {pendingDelete.valueCount === 1 ? "" : "s"} have data in this field. Turning it off
              hides it from forms — <strong>it does not erase the data</strong>. Turn the field
              back on to see those answers again.
            </p>
          ) : (
            <p className="has-text-secondary mt-1" style={{ fontSize: 13 }}>
              Nothing has been recorded in this field yet, so it can be deleted outright.
            </p>
          )}

          <div className="mt-3" style={{ display: "flex", gap: 8 }}>
            <button
              type="button"
              className={`button is-small ${busy ? "is-loading" : ""}`}
              onClick={() => confirmDelete(false)}
              disabled={busy}
            >
              Turn off (keep data)
            </button>
            {pendingDelete.valueCount === 0 && (
              <button
                type="button"
                className={`button is-small is-danger ${busy ? "is-loading" : ""}`}
                onClick={() => confirmDelete(true)}
                disabled={busy}
              >
                Delete permanently
              </button>
            )}
            <button
              type="button"
              className="button is-small"
              onClick={() => setPendingDelete(null)}
              disabled={busy}
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {adding && canEdit && (
        <FieldEditor
          entity={entity}
          takenKeys={takenKeys}
          busy={busy}
          onCancel={() => setAdding(false)}
          onSave={create}
        />
      )}

      {editing && canEdit && (
        <FieldEditor
          entity={entity}
          existing={editing}
          takenKeys={takenKeys}
          busy={busy}
          onCancel={() => setEditing(null)}
          onSave={saveEdit}
        />
      )}

      {forEntity.length === 0 ? (
        <EmptyState
          headline={`No ${ENTITY_LABELS[entity].toLowerCase()} yet`}
          message="Add a field to collect information the built-in fields don't cover."
        />
      ) : (
        <div className="card" style={{ padding: 0 }}>
          <table className="table is-fullwidth" style={{ marginBottom: 0 }}>
            <thead>
              <tr>
                <th>Field</th>
                <th>Type</th>
                <th>Required</th>
                {entity === "job" && <th>Public form</th>}
                <th>Active</th>
                {canEdit && <th style={{ width: 150 }}>&nbsp;</th>}
              </tr>
            </thead>
            <tbody>
              {forEntity.map((definition, index) => (
                <tr key={definition.id} style={{ opacity: definition.active ? 1 : 0.55 }}>
                  <td>
                    <div style={{ fontWeight: 600 }}>{definition.label}</div>
                    <code style={{ fontSize: 11 }}>{definition.field_key}</code>
                  </td>
                  <td style={{ fontSize: 13 }}>{FIELD_TYPE_LABELS[definition.field_type]}</td>
                  <td style={{ fontSize: 13 }}>{definition.required ? "Yes" : "—"}</td>
                  {entity === "job" && (
                    <td style={{ fontSize: 13 }}>{definition.show_on_public_form ? "Yes" : "—"}</td>
                  )}
                  <td>
                    <label className="checkbox">
                      <input
                        type="checkbox"
                        checked={definition.active}
                        disabled={!canEdit || busy}
                        onChange={(event) =>
                          update(definition.id, { active: event.target.checked })
                        }
                      />
                    </label>
                  </td>
                  {canEdit && (
                    <td>
                      <div style={{ display: "flex", gap: 4 }}>
                        <button
                          type="button"
                          className="button is-small"
                          title="Move up"
                          disabled={busy || index === 0}
                          onClick={() => move(index, -1)}
                        >
                          <ArrowUp size={14} />
                        </button>
                        <button
                          type="button"
                          className="button is-small"
                          title="Move down"
                          disabled={busy || index === forEntity.length - 1}
                          onClick={() => move(index, 1)}
                        >
                          <ArrowDown size={14} />
                        </button>
                        <button
                          type="button"
                          className="button is-small"
                          title="Edit"
                          disabled={busy}
                          onClick={() => {
                            setEditing(definition);
                            setAdding(false);
                          }}
                        >
                          <Pencil size={14} />
                        </button>
                        <button
                          type="button"
                          className="button is-small"
                          title="Turn off or delete"
                          disabled={busy}
                          onClick={() => askToDelete(definition)}
                        >
                          <Trash2 size={14} />
                        </button>
                      </div>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {canEdit && !adding && (
        <button
          type="button"
          className="button is-small mt-4"
          onClick={() => {
            setAdding(true);
            setEditing(null);
          }}
          disabled={busy}
        >
          <Plus size={14} style={{ marginRight: 6 }} />
          Add field
        </button>
      )}
    </div>
  );
}
