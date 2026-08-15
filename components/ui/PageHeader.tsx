// =============================================================================
// Page header — title, optional description, optional primary action.
//
// The audit found the gap between a page heading and its first card varying
// across pages (mb-5, mb-4, and a raw inline marginBottom), and every page
// re-writing the same flex row. One component means one rhythm.
//
// ONE PRIMARY ACTION, deliberately. The brief asks for a single clear focal
// point per screen; an `action` slot that takes one node is the cheapest way to
// enforce that. A page needing two actions should make the second secondary,
// inside the content, where it competes less.
// =============================================================================
import type { ReactNode } from "react";

export function PageHeader({
  title,
  description,
  action,
  breadcrumb,
}: {
  title: string;
  /** One line. If it needs two, it belongs on the page, not in the header. */
  description?: string;
  action?: ReactNode;
  breadcrumb?: ReactNode;
}) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "flex-start",
        justifyContent: "space-between",
        gap: "var(--space-4)",
        flexWrap: "wrap",
        // The single vertical rhythm value, replacing the mb-4/mb-5 mix.
        marginBottom: "var(--stack-gap)",
      }}
    >
      <div style={{ minWidth: 0 }}>
        {breadcrumb && (
          <div
            style={{
              fontSize: "var(--text-label)",
              color: "var(--color-text-secondary)",
              marginBottom: "var(--space-1)",
            }}
          >
            {breadcrumb}
          </div>
        )}

        <h1
          style={{
            fontFamily: "var(--font-heading)",
            fontSize: "var(--text-page)",
            fontWeight: "var(--weight-bold)",
            lineHeight: "var(--leading-tight)",
            letterSpacing: "-0.02em",
            color: "var(--color-text)",
            margin: 0,
          }}
        >
          {title}
        </h1>

        {description && (
          <p
            style={{
              fontSize: "var(--text-body)",
              color: "var(--color-text-secondary)",
              margin: "var(--space-1) 0 0",
              maxWidth: "68ch",
            }}
          >
            {description}
          </p>
        )}
      </div>

      {action && <div style={{ flexShrink: 0 }}>{action}</div>}
    </div>
  );
}

/**
 * A card with a heading — the shape most sections on most pages actually are.
 *
 * Exists so a section heading is the same size and weight in every module. The
 * audit found these split between `.title is-5`, `.title is-6` and raw `<h2>`
 * with inline styles, sometimes on the same page.
 */
export function SectionCard({
  title,
  description,
  action,
  children,
  tone,
}: {
  title?: string;
  description?: string;
  action?: ReactNode;
  children: ReactNode;
  /** Border emphasis for a card that carries a warning or an error. */
  tone?: "warning" | "error" | "success";
}) {
  const borderColor =
    tone === "warning"
      ? "var(--color-warning)"
      : tone === "error"
        ? "var(--color-error)"
        : tone === "success"
          ? "var(--color-success)"
          : undefined;

  return (
    <div
      className="card"
      style={{
        marginBottom: "var(--space-4)",
        ...(borderColor ? { borderColor } : {}),
      }}
    >
      {(title || action) && (
        <div
          style={{
            display: "flex",
            alignItems: "flex-start",
            justifyContent: "space-between",
            gap: "var(--space-4)",
            marginBottom: description ? "var(--space-1)" : "var(--space-4)",
          }}
        >
          {title && (
            <h2
              style={{
                fontFamily: "var(--font-heading)",
                fontSize: "var(--text-section)",
                fontWeight: "var(--weight-semibold)",
                lineHeight: "var(--leading-tight)",
                color: "var(--color-text)",
                margin: 0,
              }}
            >
              {title}
            </h2>
          )}
          {action && <div style={{ flexShrink: 0 }}>{action}</div>}
        </div>
      )}

      {description && (
        <p
          style={{
            fontSize: "var(--text-body)",
            color: "var(--color-text-secondary)",
            margin: "0 0 var(--space-4)",
            maxWidth: "68ch",
          }}
        >
          {description}
        </p>
      )}

      {children}
    </div>
  );
}
