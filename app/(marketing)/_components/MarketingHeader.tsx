import Link from "next/link";
import { NAV_LINKS } from "@/lib/marketing/content";
import { MarketingWordmark } from "./MarketingWordmark";

/**
 * The public site header.
 *
 * DELIBERATELY A SERVER COMPONENT WITH NO SESSION READ.
 *
 * The obvious feature here is "show 'Go to dashboard' if the visitor is already
 * signed in". It is not worth what it costs: reading the session makes this
 * component dynamic, which makes every page that renders it dynamic, which
 * turns a fully static marketing site into a per-request render — and it puts a
 * session read on the one surface anonymous traffic hits hardest.
 *
 * It is also unnecessary, because the redirect already exists. A signed-in
 * visitor who clicks "Sign in" hits /login, and updateSession() bounces
 * /login to /dashboard for an authenticated user. One click, no session read on
 * a public page, and the static render survives.
 */
export function MarketingHeader() {
  return (
    <header className="mkt-header">
      <div className="mkt-shell mkt-header__inner">
        <Link
          href="/"
          aria-label="MyRecruiter Partner — home"
          style={{ textDecoration: "none", display: "inline-flex" }}
        >
          {/* The dark-surface lockup, not the app's compact one — see the note
              in MarketingWordmark for why the raster wordmark cannot be used
              on the navy header. */}
          <MarketingWordmark height={30} />
        </Link>

        <nav className="mkt-header__nav" aria-label="Product">
          {NAV_LINKS.map((link) => (
            <Link key={link.href} href={link.href}>
              {link.label}
            </Link>
          ))}
        </nav>

        <div className="mkt-header__actions">
          <Link href="/login" className="mkt-header__signin">
            Sign in
          </Link>
          <Link href="/signup" className="mkt-btn mkt-btn--invert">
            Get started
          </Link>
        </div>
      </div>
    </header>
  );
}
