// =============================================================================
// Empty, error and loading states.
//
// The audit found `EmptyState` rendering a centred grey sentence and nothing
// else, and `ErrorState` a red sentence plus a small Retry. Both are the shape
// this kind of brief produces by default, which is exactly why they read as
// unfinished.
//
// The pattern here, applied once so all 17 modules inherit it:
//   icon -> short BOLD headline -> one helper sentence -> at most one action
//
// The headline is a fragment ("No jobs yet"), not a sentence. The helper line
// carries the explanation. Splitting them is what lets the eye land on the
// state in one pass instead of reading a paragraph to find out nothing is here.
//
// NO "use client" DIRECTIVE, deliberately.
//
// This is a SHARED module: it adopts whichever environment imports it. A Server
// Component gets it as server code; a Client Component gets it bundled as
// client code, and `onRetry` works there.
//
// Marking it "use client" broke the `icon` prop — a Server Component passing
// `icon={Briefcase}` is passing a FUNCTION across the server/client boundary,
// which React refuses ("Functions cannot be passed directly to Client
// Components"). Leaving the directive off is what lets an icon be chosen at the
// call site, which is the whole reason these states stopped looking generic.
// =============================================================================

import type { ComponentType, ReactNode } from "react";
import { AlertCircle, Inbox, RefreshCw } from "lucide-react";

export function Skeleton({ height = 16, width = "100%" }: { height?: number; width?: string }) {
  return <div className="skeleton" style={{ height, width }} aria-hidden="true" />;
}

/** Skeleton shaped like a list of rows, for tables/member lists. */
export function SkeletonRows({ rows = 3 }: { rows?: number }) {
  return (
    <div role="status" aria-label="Loading">
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} style={{ marginBottom: "var(--space-4)" }}>
          <Skeleton height={14} width="35%" />
          <div style={{ marginTop: "var(--space-2)" }}>
            <Skeleton height={12} width="60%" />
          </div>
        </div>
      ))}
    </div>
  );
}

/** Skeleton shaped like a row of KPI tiles. */
export function SkeletonTiles({ count = 4 }: { count?: number }) {
  return (
    <div
      className="is-flex"
      style={{ gap: "var(--space-4)", flexWrap: "wrap" }}
      role="status"
      aria-label="Loading"
    >
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} className="card" style={{ flex: "1 1 180px" }}>
          <Skeleton height={12} width="50%" />
          <div style={{ marginTop: "var(--space-3)" }}>
            <Skeleton height={26} width="40%" />
          </div>
        </div>
      ))}
    </div>
  );
}

export function EmptyState({
  headline,
  message,
  action,
  icon: Icon = Inbox,
  compact = false,
  accent = "neutral",
}: {
  /** A short fragment: "No jobs yet". Not a sentence. */
  headline?: string;
  /** One line explaining what to do about it. */
  message: string;
  action?: ReactNode;
  icon?: ComponentType<{ size?: number; strokeWidth?: number; "aria-hidden"?: boolean }>;
  /**
   * Sizes the block to its content rather than to a full page-height void.
   *
   * For an empty state sharing a row with another card, the generous version
   * stretched its card far taller than its neighbour and left an icon floating
   * in white space. Compact keeps the same anatomy at 48px vertical padding.
   */
  compact?: boolean;
  /**
   * Tints the icon well.
   *
   * "neutral" is the grey default every existing page already renders — changing
   * it here would repaint 17 modules. "primary" is opt-in, for the empty states
   * whose icon carries real meaning (people, jobs) rather than "nothing here":
   * a grey ring around a person icon reads as absence, a tinted one reads as an
   * invitation.
   */
  accent?: "neutral" | "primary";
}) {
  const isPrimary = accent === "primary";
  return (
    <div
      className="fade-in"
      style={{
        textAlign: "center",
        padding: compact ? "48px var(--space-6)" : "var(--space-12) var(--space-6)",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        gap: "var(--space-2)",
      }}
    >
      <div
        aria-hidden="true"
        style={{
          // The tinted well carries an illustration rather than a marker, so it
          // gets a little more room. Neutral keeps the size every other page
          // already renders — this pass is scoped to Candidates.
          width: isPrimary ? 52 : compact ? 40 : 44,
          height: isPrimary ? 52 : compact ? 40 : 44,
          borderRadius: "50%",
          background: isPrimary ? "var(--color-primary-tint)" : "var(--color-background)",
          border: isPrimary ? "none" : "1px solid var(--color-border)",
          display: "grid",
          placeItems: "center",
          color: isPrimary ? "var(--color-primary)" : "var(--color-text-secondary)",
          marginBottom: "var(--space-2)",
        }}
      >
        <Icon size={isPrimary ? 24 : compact ? 18 : 20} strokeWidth={1.75} aria-hidden />
      </div>

      {headline && (
        <p
          style={{
            fontFamily: "var(--font-heading)",
            fontSize: "var(--text-section)",
            fontWeight: "var(--weight-semibold)",
            color: "var(--color-text)",
            margin: 0,
          }}
        >
          {headline}
        </p>
      )}

      <p
        style={{
          fontSize: "var(--text-body)",
          color: "var(--color-text-secondary)",
          margin: 0,
          maxWidth: 420,
        }}
      >
        {message}
      </p>

      {action && <div style={{ marginTop: "var(--space-4)" }}>{action}</div>}
    </div>
  );
}

/**
 * Error state.
 *
 * Same shape as the empty state so the two read as siblings, in error colour.
 * The headline names what failed; the message says what to do next. A raw error
 * string or a stack trace never reaches this component — callers pass plain
 * language, which the route handlers already guarantee.
 */
export function ErrorState({
  headline = "Couldn't load this",
  message,
  onRetry,
}: {
  headline?: string;
  message: string;
  onRetry?: () => void;
}) {
  return (
    <div
      className="fade-in"
      style={{
        textAlign: "center",
        padding: "var(--space-8) var(--space-6)",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        gap: "var(--space-2)",
      }}
      role="alert"
    >
      <div
        aria-hidden="true"
        style={{
          width: 44,
          height: 44,
          borderRadius: "50%",
          background: "var(--status-error-bg)",
          display: "grid",
          placeItems: "center",
          color: "var(--color-error)",
          marginBottom: "var(--space-2)",
        }}
      >
        <AlertCircle size={20} strokeWidth={1.75} aria-hidden />
      </div>

      <p
        style={{
          fontFamily: "var(--font-heading)",
          fontSize: "var(--text-section)",
          fontWeight: "var(--weight-semibold)",
          color: "var(--color-error)",
          margin: 0,
        }}
      >
        {headline}
      </p>

      <p
        style={{
          fontSize: "var(--text-body)",
          color: "var(--color-text-secondary)",
          margin: 0,
          maxWidth: 420,
        }}
      >
        {message}
      </p>

      {onRetry && (
        <button
          type="button"
          className="button is-small"
          onClick={onRetry}
          style={{ marginTop: "var(--space-4)", display: "inline-flex", gap: "var(--space-2)" }}
        >
          <RefreshCw size={14} aria-hidden="true" />
          Try again
        </button>
      )}
    </div>
  );
}

/**
 * Inline form-level error.
 *
 * Sits directly above the control it refers to, with an icon so it is not
 * carried by colour alone.
 */
export function FormError({ message }: { message: string | null }) {
  if (!message) return null;

  return (
    <p
      role="alert"
      className="fade-in"
      style={{
        display: "flex",
        alignItems: "flex-start",
        gap: "var(--space-2)",
        color: "var(--color-error)",
        fontSize: "var(--text-body)",
        marginBottom: "var(--space-4)",
      }}
    >
      <AlertCircle size={16} strokeWidth={2} aria-hidden="true" style={{ flexShrink: 0, marginTop: 2 }} />
      <span>{message}</span>
    </p>
  );
}
