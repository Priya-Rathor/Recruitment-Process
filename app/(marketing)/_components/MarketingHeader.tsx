import Link from "next/link";
import { NAV_LINKS } from "@/lib/marketing/content";
import { Logo } from "@/components/Logo";

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
          aria-label="Scoreboad — home"
          style={{ textDecoration: "none", display: "inline-flex" }}
        >
          {/*
            THE REAL LOCKUP, not a text wordmark.

            This used to be a text wordmark beside the monogram, because the
            retired raster was painted for a light ground and its dark half
            vanished on the dark header. The Scoreboad lockup is
            light-on-transparent, so the artwork itself goes here.

            COMPACT rather than full, and that is a size decision rather than a
            preference: the full lockup is 2.72:1 including the strapline, which
            occupies about 5% of its height. In a 30px sticky header that is a
            1.5px strapline — not small, invisible. The footer and the auth pages
            have the room and get the full lockup with the strapline showing.
          */}
          <span className="mkt-brand__wide">
            <Logo variant="compact" height={30} priority />
          </span>
          <span className="mkt-brand__narrow">
            <Logo variant="mark" height={30} priority />
          </span>
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
