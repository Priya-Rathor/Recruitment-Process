// Shared loading / empty / error state primitives.
// Spec section 8 requires all three on every data-bearing view in every
// module — these exist so no module re-invents them.
"use client";

import type { ReactNode } from "react";

export function Skeleton({ height = 16, width = "100%" }: { height?: number; width?: string }) {
  return <div className="skeleton" style={{ height, width }} aria-hidden="true" />;
}

/** Skeleton shaped like a list of rows, for tables/member lists. */
export function SkeletonRows({ rows = 3 }: { rows?: number }) {
  return (
    <div role="status" aria-label="Loading">
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="mb-4">
          <Skeleton height={14} width="35%" />
          <div className="mt-2">
            <Skeleton height={12} width="60%" />
          </div>
        </div>
      ))}
    </div>
  );
}

export function EmptyState({
  message,
  action,
}: {
  message: string;
  action?: ReactNode;
}) {
  return (
    <div className="has-text-centered py-5">
      <p className="has-text-secondary mb-3">{message}</p>
      {action}
    </div>
  );
}

/**
 * Error state — short, human-readable, in the Error token, with a Retry action.
 * One failing section must never crash the rest of the page.
 */
export function ErrorState({
  message,
  onRetry,
}: {
  message: string;
  onRetry?: () => void;
}) {
  return (
    <div className="py-4">
      <p style={{ color: "var(--color-error)" }} className="mb-3">
        {message}
      </p>
      {onRetry && (
        <button type="button" className="button is-small" onClick={onRetry}>
          Retry
        </button>
      )}
    </div>
  );
}

/** Inline form-level error notice. */
export function FormError({ message }: { message: string | null }) {
  if (!message) return null;
  return (
    <p className="mb-4" style={{ color: "var(--color-error)", fontSize: 14 }} role="alert">
      {message}
    </p>
  );
}
