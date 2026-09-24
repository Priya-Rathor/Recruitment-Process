"use client";

// =============================================================================
// THE PUBLIC SITE'S ERROR BOUNDARY.
//
// WHY A SECOND ONE (§23). `app/error.tsx` already exists and is styled as the
// application: a Bulma card on the auth layout, worded for somebody signed in
// ("contact your workspace admin"). That is right for the dashboard and wrong
// for a visitor who has never seen the product. Because the nearest boundary in
// the segment tree wins, adding this one gives the public site a branded
// failure state and leaves the app's own untouched — which is exactly the split
// §23 asks for, achieved by file placement rather than by a flag.
//
// IT RENDERS INSIDE THE MARKETING LAYOUT, so the navbar and footer are still
// there and the reader can leave by any route on the site. That is the main
// reason this belongs here and not at the root.
//
// NOTHING ABOUT THE ERROR REACHES THE SCREEN (§8, §18). The `error` prop is
// deliberately not rendered, not stringified and not put in a `title`
// attribute: a message, a digest or a stack would tell whoever triggered the
// fault about our internals. It is logged instead, where only we can read it.
// =============================================================================

import { useEffect } from "react";
import Link from "next/link";
import { ArrowRight, RotateCcw } from "lucide-react";
import { PUBLIC_ERROR } from "@/lib/marketing/errors";

export default function MarketingError({
  error,
  retry,
}: {
  error: Error & { digest?: string };
  /*
    `retry`, NOT `reset` — Next 16.3 made this prop stable and its own
    documentation says to prefer it: `reset()` only clears the boundary and
    re-renders the same children, so a page that failed while loading data
    fails again identically. `retry()` re-fetches the segment, which is what a
    button labelled "Try again" promises.
  */
  retry: () => void;
}) {
  useEffect(() => {
    /*
      The only place the real error goes. On Vercel this lands in the function
      log; `digest` is the id that ties this render to that entry, which is how
      a report of "it broke" becomes findable without showing anybody anything.
    */
    console.error("[marketing] render failed:", error.digest ?? error.message);
  }, [error]);

  return (
    <section className="mkt-band mkt-band--dark nf nf--error" aria-labelledby="error-heading">
      <div className="mkt-shell nf__inner">
        <div className="nf__copy nf__copy--center">
          <p className="nf__eyebrow">{PUBLIC_ERROR.eyebrow}</p>
          <h1 id="error-heading" className="nf__title">
            {PUBLIC_ERROR.title}
          </h1>
          <p className="nf__lead">{PUBLIC_ERROR.lead}</p>

          <div className="nf__actions nf__actions--center">
            {/*
              A real <button>, because it performs an action rather than
              navigating — and the link beside it is a real <a>, because it
              does. §17's "proper button/link semantics" is this distinction and
              nothing more.
            */}
            <button type="button" className="mkt-btn mkt-btn--primary" onClick={() => retry()}>
              <RotateCcw size={16} aria-hidden="true" />
              {PUBLIC_ERROR.retry}
            </button>

            {/*
              KEPT VISIBLE WHETHER OR NOT THE RETRY WORKS (§9). If retrying
              fails the boundary simply renders again, with this link still
              here — so nobody is left on a page whose only control does
              nothing.
            */}
            <Link href={PUBLIC_ERROR.home.href} className="mkt-btn mkt-btn--glass">
              {PUBLIC_ERROR.home.label}
              <ArrowRight size={16} aria-hidden="true" />
            </Link>
          </div>
        </div>
      </div>
    </section>
  );
}
