
"use client";

// Route-level error boundary for the AUTHENTICATED APP: a failing page shows a
// readable message with a retry rather than a blank screen or a raw stack
// trace. The public site has its own at app/(marketing)/error.tsx, which is
// branded and keeps the site chrome; the nearest boundary wins, so this one now
// only covers the application.
//
// `retry`, NOT `reset`. Next 16.3 made `retry` stable and its docs say to
// prefer it: `reset()` re-renders the same children without re-fetching, so on
// a page that failed while loading data the button re-ran straight back into
// the same error. That was a real no-op on every data-backed screen in the app.
//
// The `error` prop is deliberately not rendered — no message, no digest, no
// stack reaches the browser.
export default function AppError({ retry }: { error: Error; retry: () => void }) {
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
          <button type="button" className="button is-primary" onClick={() => retry()}>
            Retry
          </button>
        </div>
      </div>
    </div>
  );
}
