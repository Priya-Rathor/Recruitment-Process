"use client";

import { useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { FormError } from "@/components/states";

/**
 * Explicit Save with an unsaved-changes indicator.
 *
 * The design system forbids silent auto-save on configuration, and these
 * settings decide how many times the product telephones a candidate — a
 * mis-click that saved itself would be felt by a member of the public.
 *
 * Shared so all five settings forms behave identically; each supplies its own
 * fields and the patch to send.
 */
export function SettingsForm<T extends Record<string, unknown>>({
  initial,
  children,
  toPayload,
  savedMessage = "Saved.",
}: {
  initial: T;
  /** Render props: current values and a setter for one field. */
  children: (args: {
    values: T;
    set: <K extends keyof T>(key: K, value: T[K]) => void;
    dirty: boolean;
  }) => ReactNode;
  /** Turns the form state into the PATCH body. */
  toPayload: (values: T) => Record<string, unknown>;
  savedMessage?: string;
}) {
  const router = useRouter();
  const [values, setValues] = useState<T>(initial);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const set = <K extends keyof T>(key: K, value: T[K]) => {
    setValues((previous) => ({ ...previous, [key]: value }));
    setDirty(true);
    setSaved(false);
  };

  async function save() {
    setSaving(true);
    setError(null);

    try {
      const response = await fetch("/api/settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(toPayload(values)),
      });

      const payload = await response.json();

      if (!response.ok) {
        setError(payload.error ?? "Couldn't save those settings.");
        return;
      }

      setDirty(false);
      setSaved(true);
      router.refresh();
    } catch {
      setError("Couldn't reach the server. Nothing was saved.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
      <div className="card mb-4">{children({ values, set, dirty })}</div>

      <FormError message={error} />

      <div className="is-flex is-align-items-center" style={{ gap: "0.75rem" }}>
        <button
          type="button"
          className={`button is-primary ${saving ? "is-loading" : ""}`}
          onClick={save}
          disabled={saving || !dirty}
        >
          Save changes
        </button>

        {dirty && (
          <span className="has-text-secondary" style={{ fontSize: 13 }}>
            Unsaved changes
          </span>
        )}
        {saved && !dirty && (
          <span style={{ fontSize: 13, color: "var(--color-success)" }}>{savedMessage}</span>
        )}
      </div>
    </>
  );
}

/** A labelled field row, so every settings form lines up the same way. */
export function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: ReactNode;
}) {
  return (
    <div className="mb-4">
      <label className="is-block mb-1" style={{ fontSize: 14, fontWeight: 600 }}>
        {label}
      </label>
      {hint && (
        <p className="has-text-secondary mb-2" style={{ fontSize: 13 }}>
          {hint}
        </p>
      )}
      {children}
    </div>
  );
}
