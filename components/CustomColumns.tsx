"use client";

// =============================================================================
// "Customize columns" — optional custom-field columns on a list table.
//
// One hook and one control, shared by the Candidates and Applications tables so
// the two behave identically. Neither page had a column picker before; this adds
// the first one, and it is deliberately small — a checklist of the organization's
// own fields, not a general column manager for the built-in columns, which the
// brief does not ask for and which would let somebody hide the Name column.
//
// -----------------------------------------------------------------------------
// THE CHOICE IS PER-VIEWER AND LIVES IN localStorage.
//
// Which columns YOU want to see is a preference, not organization configuration:
// two recruiters looking at the same pipeline reasonably want different ones, and
// storing it server-side would make one person's choice everybody's. It is also
// the kind of state that is fine to lose — a cleared browser costs one click, so
// it does not need a table.
//
// Every read and write is wrapped: a browser with site data blocked throws on
// access rather than returning null, and a table that fails to render because a
// preference could not be read would be a bad trade for a convenience.
// =============================================================================
import { useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { Columns3 } from "lucide-react";
import type { CustomFieldDefinition, CustomFieldEntity } from "@/lib/customFields/definitions";
import { formatValue } from "@/lib/customFields/values";

function storageKey(entity: CustomFieldEntity): string {
  return `recruitment-os:columns:${entity}`;
}

function writeChosen(entity: CustomFieldEntity, ids: string[]) {
  try {
    window.localStorage.setItem(storageKey(entity), JSON.stringify(ids));
  } catch {
    // A private window, or site data blocked. The columns still work for this
    // visit; they just will not be remembered.
  }
}

export type CustomColumnState = {
  /** The definitions currently shown, in display order. */
  columns: CustomFieldDefinition[];
  /** entityId -> definitionId -> value. Empty until the fetch lands. */
  values: Map<string, Record<string, unknown>>;
  loading: boolean;
  chosenIds: string[];
  toggle: (definitionId: string) => void;
};

/**
 * The chosen-column ids, as an external store.
 *
 * useSyncExternalStore rather than useState-in-an-effect: localStorage is an
 * external system that does not exist on the server, and React's own answer for
 * reading one is this hook. It also gets the server render right for free —
 * getServerSnapshot returns the empty selection, so the markup matches until the
 * browser takes over.
 *
 * getSnapshot MUST return a stable reference while the underlying string is
 * unchanged, or React re-renders for ever. Hence the one-entry parse cache.
 */
const listeners = new Set<() => void>();
const parseCache = new Map<string, { raw: string | null; parsed: string[] }>();
const EMPTY_IDS: string[] = [];
const EMPTY_VALUES = new Map<string, Record<string, unknown>>();

function subscribe(listener: () => void) {
  listeners.add(listener);
  // Another tab changing the same preference.
  window.addEventListener("storage", listener);
  return () => {
    listeners.delete(listener);
    window.removeEventListener("storage", listener);
  };
}

function snapshotFor(entity: CustomFieldEntity): string[] {
  let raw: string | null = null;
  try {
    raw = window.localStorage.getItem(storageKey(entity));
  } catch {
    return EMPTY_IDS;
  }

  const cached = parseCache.get(entity);
  if (cached && cached.raw === raw) return cached.parsed;

  let parsed: string[] = EMPTY_IDS;
  try {
    const value: unknown = raw ? JSON.parse(raw) : null;
    if (Array.isArray(value)) {
      parsed = value.filter((id): id is string => typeof id === "string");
    }
  } catch {
    parsed = EMPTY_IDS;
  }

  parseCache.set(entity, { raw, parsed });
  return parsed;
}

/**
 * Owns the chosen columns and the values for whatever rows are on screen.
 *
 * `rowIds` is the CURRENT rows — including search results, which is the whole
 * reason the values are fetched rather than server-rendered. See the GET handler
 * in app/api/custom-fields/values/route.ts.
 */
export function useCustomColumns(
  entity: CustomFieldEntity,
  definitions: CustomFieldDefinition[],
  rowIds: string[]
): CustomColumnState {
  const chosenIds = useSyncExternalStore(
    subscribe,
    () => snapshotFor(entity),
    () => EMPTY_IDS
  );

  const columns = useMemo(
    () => definitions.filter((definition) => chosenIds.includes(definition.id)),
    [definitions, chosenIds]
  );

  /*
    ONE piece of state holding both the values AND the request they answer.

    Storing `loading` separately would mean setting it synchronously inside the
    effect, which cascades a render. Keeping the answered key beside the data
    makes "still loading" a DERIVED fact — snapshot.key !== wanted — so the
    effect only ever sets state from its async callback.
  */
  const rowKey = rowIds.join(",");
  const wanted = columns.length === 0 || rowKey === "" ? "" : `${entity}:${rowKey}`;

  const [snapshot, setSnapshot] = useState<{
    key: string;
    values: Map<string, Record<string, unknown>>;
  }>({ key: "", values: EMPTY_VALUES });

  useEffect(() => {
    if (wanted === "") return;

    let cancelled = false;

    fetch(`/api/custom-fields/values?entity_type=${entity}&entity_ids=${rowKey}`)
      .then((response) => (response.ok ? response.json() : null))
      .then((payload: { data?: Record<string, Record<string, unknown>> } | null) => {
        if (cancelled) return;
        setSnapshot({ key: wanted, values: new Map(Object.entries(payload?.data ?? {})) });
      })
      .catch(() => {
        // Leave the previous values rather than blanking the table: a failed
        // refresh showing stale data beats one showing "—" everywhere, which
        // reads as "nobody has filled these in".
      });

    return () => {
      cancelled = true;
    };
  }, [entity, rowKey, wanted]);

  function toggle(definitionId: string) {
    const next = chosenIds.includes(definitionId)
      ? chosenIds.filter((id) => id !== definitionId)
      : [...chosenIds, definitionId];

    writeChosen(entity, next);
    // localStorage fires no event in the tab that wrote it, so tell the store.
    for (const listener of listeners) listener();
  }

  return {
    columns,
    values: wanted === "" ? EMPTY_VALUES : snapshot.values,
    loading: wanted !== "" && snapshot.key !== wanted,
    chosenIds,
    toggle,
  };
}

/** The control. Renders nothing when the organization has no custom fields. */
export function CustomColumnsPicker({
  definitions,
  chosenIds,
  onToggle,
}: {
  definitions: CustomFieldDefinition[];
  chosenIds: string[];
  onToggle: (definitionId: string) => void;
}) {
  const [open, setOpen] = useState(false);

  if (definitions.length === 0) return null;

  return (
    <div style={{ position: "relative", display: "inline-block" }}>
      <button
        type="button"
        className="button is-small"
        onClick={() => setOpen((current) => !current)}
        aria-expanded={open}
      >
        <Columns3 size={14} style={{ marginRight: 6 }} />
        Columns
        {chosenIds.length > 0 && (
          <span className="has-text-secondary" style={{ marginLeft: 6 }}>
            {chosenIds.length}
          </span>
        )}
      </button>

      {open && (
        <div
          className="card"
          style={{
            position: "absolute",
            zIndex: 20,
            right: 0,
            marginTop: 4,
            padding: 12,
            minWidth: 220,
          }}
        >
          <p className="label is-small mb-2">Custom fields</p>
          {definitions.map((definition) => (
            <label
              key={definition.id}
              className="checkbox"
              style={{ display: "block", marginBottom: 6, fontSize: 13 }}
            >
              <input
                type="checkbox"
                checked={chosenIds.includes(definition.id)}
                onChange={() => onToggle(definition.id)}
              />{" "}
              {definition.label}
            </label>
          ))}
          <button type="button" className="button is-small mt-2" onClick={() => setOpen(false)}>
            Done
          </button>
        </div>
      )}
    </div>
  );
}

/**
 * One cell.
 *
 * A row whose values have NOT been fetched yet renders empty, not "—". The dash
 * means "asked, and there is no answer"; an empty cell means "not known yet",
 * and conflating them would report absent data as a confirmed blank.
 */
export function CustomColumnCell({
  definition,
  values,
  loaded,
}: {
  definition: CustomFieldDefinition;
  values: Record<string, unknown> | undefined;
  loaded: boolean;
}) {
  if (!loaded) return <td />;
  const value = values?.[definition.id];
  return <td style={{ fontSize: 13 }}>{formatValue(definition.field_type, value) || "—"}</td>;
}
