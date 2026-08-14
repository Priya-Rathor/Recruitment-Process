
"use client";

// Route-level error boundary: a failing page shows a readable message with a
// retry rather than a blank screen or a raw stack trace.
export default function GlobalError({ reset }: { error: Error; reset: () => void }) {
  return (
    <div className="auth-layout">
      <div className="auth-card">
        <div className="card">
          <h1 className="title is-5" style={{ color: "var(--color-error)" }}>
            Something went wrong
          </h1>
          <p className="has-text-secondary mb-4" style={{ fontSize: 14 }}>
            This page couldn&apos;t load. Try again, and if it keeps happening contact your
            workspace admin.
          </p>
          <button type="button" className="button is-primary" onClick={reset}>
            Retry
          </button>
        </div>
      </div>
    </div>
  );
}
