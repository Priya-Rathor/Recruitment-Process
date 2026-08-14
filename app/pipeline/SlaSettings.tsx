"use client";

// Interim SLA editor.
//
// FORWARD STUB (spec): "Module 17's dedicated Pipeline Settings page doesn't
// exist yet, so this module both creates and provides a basic edit UI for
// pipeline_sla_config directly."
//
// When Module 17 ships /settings/pipeline it must write to the SAME table via
// the same endpoint, not create a duplicate.
import { useState } from "react";
import { useRouter } from "next/navigation";
import { FormError } from "@/components/states";

export type SlaRow = {
  stage: string;
  label: string;
  targetDays: number;
  isDefault: boolean;
};

export function SlaSettings({ rows, canEdit }: { rows: SlaRow[]; canEdit: boolean }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [values, setValues] = useState<Record<string, number>>(() =>
    Object.fromEntries(rows.map((row) => [row.stage, row.targetDays]))
  );
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save() {
    setBusy(true);
    setError(null);

    const response = await fetch("/api/pipeline/sla", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(values),
    });

    setBusy(false);

    if (!response.ok) {
      const payload = await response.json().catch(() => null);
      setError(payload?.error ?? "Could not save those targets.");
      return;
    }

    setDirty(false);
    router.refresh();
  }

  if (!open) {
    return (
      <button type="button" className="button is-small" onClick={() => setOpen(true)}>
        {canEdit ? "Stage targets" : "View stage targets"}
      </button>
    );
  }

  return (
    <div className="card mb-4">
      <div className="is-flex is-justify-content-space-between is-align-items-center mb-3">
        <div>
          <h2 className="title is-5 mb-1">Stage targets</h2>
          <p className="has-text-secondary" style={{ fontSize: 13 }}>
            How many days an application may sit in each stage before the board flags it.
          </p>
        </div>
        <button type="button" className="button is-small" onClick={() => setOpen(false)}>
          Close
        </button>
      </div>

      <FormError message={error} />

      <div className="columns is-multiline">
        {rows.map((row) => (
          <div key={row.stage} className="column is-one-third">
            <label className="label" style={{ fontSize: 13 }} htmlFor={`sla-${row.stage}`}>
              {row.label}
            </label>
            <input
              id={`sla-${row.stage}`}
              className="input"
              type="number"
              min={0}
              max={365}
              disabled={!canEdit || busy}
              value={values[row.stage] ?? row.targetDays}
              onChange={(event) => {
                setValues((current) => ({
                  ...current,
                  [row.stage]: Number(event.target.value),
                }));
                setDirty(true);
              }}
            />
            {row.isDefault && (
              <p className="help has-text-secondary">Default — not set for this team yet.</p>
            )}
          </div>
        ))}
      </div>

      {canEdit ? (
        <div className="is-flex is-justify-content-space-between is-align-items-center mt-3">
          <p className="has-text-secondary" style={{ fontSize: 13 }}>
            {dirty ? "You have unsaved changes." : "No unsaved changes."}
          </p>
          <button
            type="button"
            className={`button is-primary ${busy ? "is-loading" : ""}`}
            onClick={save}
            disabled={busy || !dirty}
          >
            Save targets
          </button>
        </div>
      ) : (
        <p className="has-text-secondary mt-3" style={{ fontSize: 13 }}>
          Only an Owner or Admin can change these.
        </p>
      )}
    </div>
  );
}
