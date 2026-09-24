"use client";

// =============================================================================
// THE LAST RESORT — the root layout itself failed.
//
// §10: "make it extremely lightweight. Do not depend on components that may
// fail to load." This file replaces the root layout when it renders, which
// means it must supply its own <html> and <body> — and it means every import it
// makes is an import that could be the very thing that just broke.
//
// So it imports NOTHING. No stylesheet (globals.scss may be what failed), no
// font (next/font runs in the layout this is replacing), no Logo, no icon set,
// no design tokens. Every value below is a literal, and they are literals on
// purpose rather than through carelessness: `var(--mkt-dark)` resolves to
// nothing if the stylesheet never loaded, and the result is black text on a
// transparent background — an error page that is itself broken.
//
// The hexes are the brand's, copied deliberately: #0A1128 is deep space and
// #8B9EFF is the periwinkle. They are duplicated here and nowhere else.
//
// IN PRACTICE THIS ALMOST NEVER RENDERS. The marketing boundary and the app
// boundary catch everything inside their trees; this only fires if the root
// layout throws. That is exactly why it has to work with nothing.
// =============================================================================

import { useEffect } from "react";

export default function GlobalError({
  error,
  retry,
}: {
  error: Error & { digest?: string };
  retry: () => void;
}) {
  /*
    The ONE import this file makes, and it is React itself — which must already
    be working for this component to be rendering at all, so it adds no new way
    to fail.

    Worth the line: if the root layout throws, this is the most important error
    on the site and the only place it can be captured. It goes to the server
    log and nowhere near the screen.
  */
  useEffect(() => {
    console.error("[global] root layout failed:", error.digest ?? error.message);
  }, [error]);

  return (
    <html lang="en">
      <body
        style={{
          margin: 0,
          minHeight: "100vh",
          display: "grid",
          placeItems: "center",
          padding: "2rem",
          background: "#0a1128",
          color: "#ffffff",
          // A system stack, because the webfont lives in the layout this
          // replaced and asking for it here would render invisible text.
          fontFamily:
            "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif",
          textAlign: "center",
        }}
      >
        <main style={{ maxWidth: "32rem" }}>
          <h1 style={{ fontSize: "1.5rem", fontWeight: 700, margin: "0 0 0.75rem" }}>
            Scoreboad couldn&apos;t load.
          </h1>

          {/*
            #a6b1d9 on #0a1128 is 8.82:1 — the same muted ink the site uses, and
            checked rather than eyeballed, because this is the one page that
            cannot inherit a token.
          */}
          <p style={{ margin: "0 0 1.5rem", lineHeight: 1.6, color: "#a6b1d9" }}>
            Something went wrong while starting the page. Trying again usually
            works.
          </p>

          {/*
            No error text, no digest, no stack — same rule as every other error
            surface here. Whoever triggered this learns that it failed and
            nothing else.
          */}
          <button
            type="button"
            onClick={() => retry()}
            style={{
              font: "inherit",
              fontWeight: 600,
              cursor: "pointer",
              padding: "0.6rem 1.25rem",
              borderRadius: "12px",
              border: "none",
              background: "#8b9eff",
              // Deep space on periwinkle, never white: white on #8b9eff is
              // 2.49:1. The one rule this file must not get wrong.
              color: "#0a1128",
            }}
          >
            Try again
          </button>
        </main>
      </body>
    </html>
  );
}
