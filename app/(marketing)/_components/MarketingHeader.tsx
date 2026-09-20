"use client";

// =============================================================================
// The public site header — a floating glass navbar.
//
// A CLIENT COMPONENT, and only because of the mobile menu: the open/closed
// state and the Escape handler cannot live on the server. Everything it renders
// is static, so nothing session-shaped crosses the boundary.
//
// WHY THE LINKS ARE WHAT THEY ARE. The brief asked for Products, Solutions,
// Pricing and Resources. None of those routes exists, and the same brief
// requires no broken links and no invented functionality — creating four empty
// pages to satisfy a nav is both. So the requested SHAPE is mapped onto real
// destinations (see HOME_NAV_LINKS), and the gap is reported rather than papered
// over. Pricing is the notable omission: the FAQ on the page below says pricing
// is not published yet, so a Pricing link would lead somewhere that contradicts
// it.
//
// The logo is the COMPACT lockup, and the mark alone below 30rem — see the
// note in marketing.scss. A raster lockup cannot drop half of itself, so both
// are rendered and CSS chooses, which is also what avoids a layout shift on
// first paint.
// =============================================================================

import { useEffect, useState } from "react";
import Link from "next/link";
import { Menu, X } from "lucide-react";
import { Logo } from "@/components/Logo";
import { HOME_NAV_LINKS } from "@/lib/marketing/home";

export function MarketingHeader() {
  const [open, setOpen] = useState(false);

  /*
    Escape closes the menu, and an open menu locks the page behind it.

    Both are what a reader expects of a full-screen overlay, and neither is
    free: without the scroll lock the page scrolls underneath the menu, which on
    iOS leaves the reader somewhere else entirely when it closes.
  */
  useEffect(() => {
    if (!open) return;

    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };

    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    document.addEventListener("keydown", onKey);

    return () => {
      document.body.style.overflow = previous;
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <header className="mkt-nav">
      <div className="mkt-nav__bar">
        <Link href="/" aria-label="Scoreboad — home" className="mkt-nav__brand">
          <span className="mkt-brand__wide">
            <Logo variant="compact" height={26} priority />
          </span>
          <span className="mkt-brand__narrow">
            <Logo variant="mark" height={26} priority />
          </span>
        </Link>

        <nav className="mkt-nav__links" aria-label="Sections">
          {HOME_NAV_LINKS.map((link) => (
            <Link key={link.href} href={link.href}>
              {link.label}
            </Link>
          ))}
        </nav>

        <div className="mkt-nav__actions">
          <Link href="/login" className="mkt-nav__signin">
            Sign In
          </Link>
          <Link href="/signup" className="mkt-btn mkt-btn--primary mkt-btn--sm">
            Get Started
          </Link>
        </div>

        <button
          type="button"
          className="mkt-nav__burger"
          aria-expanded={open}
          aria-controls="mkt-mobile-menu"
          aria-label={open ? "Close menu" : "Open menu"}
          onClick={() => setOpen((value) => !value)}
        >
          {open ? <X size={20} aria-hidden="true" /> : <Menu size={20} aria-hidden="true" />}
        </button>
      </div>

      {open && (
        <div className="mkt-nav__sheet" id="mkt-mobile-menu">
          <nav aria-label="Sections">
            {HOME_NAV_LINKS.map((link) => (
              <Link
                key={link.href}
                href={link.href}
                // Closed here rather than in an effect watching the pathname:
                // these are mostly in-page fragments, so the pathname does not
                // change and an effect would never fire.
                onClick={() => setOpen(false)}
              >
                {link.label}
              </Link>
            ))}
          </nav>

          <div className="mkt-nav__sheetactions">
            <Link href="/login" className="mkt-btn mkt-btn--glass" onClick={() => setOpen(false)}>
              Sign In
            </Link>
            <Link href="/signup" className="mkt-btn mkt-btn--primary" onClick={() => setOpen(false)}>
              Get Started
            </Link>
          </div>
        </div>
      )}
    </header>
  );
}
