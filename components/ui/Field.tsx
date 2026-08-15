// =============================================================================
// Form field — label, helper text, control, and inline validation.
//
// The audit found labels rendered inconsistently (some `.label`, some raw
// `<label>` with inline styles, some just bold text) and validation shown only
// as a message elsewhere on the page, never on the field itself.
//
// One component: the label is always the same size and weight, the helper line
// is always separate from the label (the brief's "every label should do exactly
// one job"), and an error puts a red border on the CONTROL as well as a message
// beneath it.
// =============================================================================
"use client";

import type { ReactNode } from "react";
import { AlertCircle } from "lucide-react";

export function Field({
  label,
  hint,
  error,
  htmlFor,
  children,
}: {
  label: string;
  /** Explanation. Kept out of the label so the label does one job. */
  hint?: string;
  /** When set, the field renders in its error state. */
  error?: string | null;
  htmlFor?: string;
  children: ReactNode;
}) {
  return (
    <div style={{ marginBottom: "var(--space-4)" }}>
      <label
        htmlFor={htmlFor}
        className="label"
        style={{ display: "block", marginBottom: hint ? "var(--space-1)" : "var(--space-2)" }}
      >
        {label}
      </label>

      {hint && (
        <p
          style={{
            fontSize: "var(--text-caption)",
            color: "var(--color-text-secondary)",
            margin: "0 0 var(--space-2)",
          }}
        >
          {hint}
        </p>
      )}

      {children}

      {error && (
        <p
          role="alert"
          style={{
            display: "flex",
            alignItems: "center",
            gap: "var(--space-1)",
            fontSize: "var(--text-caption)",
            color: "var(--color-error)",
            margin: "var(--space-1) 0 0",
          }}
        >
          <AlertCircle size={13} aria-hidden="true" />
          {error}
        </p>
      )}
    </div>
  );
}
