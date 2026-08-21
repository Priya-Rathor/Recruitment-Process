import type { Metadata } from "next";
import "./marketing.scss";
import { MarketingHeader } from "./_components/MarketingHeader";
import { MarketingFooter } from "./_components/MarketingFooter";

/**
 * The public website shell.
 *
 * A ROUTE GROUP, NOT A PATH PREFIX. `(marketing)` contributes nothing to the
 * URL, so the landing page sits at "/" where a marketing site belongs, while
 * still getting its own layout. The private app's routes are outside this group
 * and keep the root layout and AppShell they already had — adding this group
 * changed none of them.
 *
 * WHAT THIS LAYOUT MUST NEVER DO. It must not import AppShell, the nav, or
 * anything from lib/tenant.ts, and it must not construct a Supabase client. Two
 * separate reasons, both of which matter:
 *
 *   1. Any session read here makes every public page dynamic, and a marketing
 *      site that re-renders per request for anonymous traffic is a cost and a
 *      latency problem with no upside.
 *   2. A public page holding an authenticated client is exactly the shape of
 *      accident that leaks one tenant's data onto a page served from a shared
 *      cache.
 *
 * The metadata title has no product suffix because the root layout already
 * defines the template "%s · MyRecruiter Partner".
 */
export const metadata: Metadata = {
  title: {
    default: "Your AI hiring manager",
    template: "%s · MyRecruiter Partner",
  },
};

export default function MarketingLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="mkt">
      <MarketingHeader />
      {/* A named landmark, so a screen reader user can jump the header. */}
      <main id="main">{children}</main>
      <MarketingFooter />
    </div>
  );
}
