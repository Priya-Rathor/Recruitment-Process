"use client";

// =============================================================================
// The public site header — a floating glass navbar with mega menus.
//
// THE VISUAL IDENTITY IS UNCHANGED ON PURPOSE. Same sticky floating pill, same
// height, same translucent navy fill and blur, same border, same logo
// treatment, same right-hand pair of actions. What changed is the NAVIGATION
// INSIDE it: five flat links became three grouped menus over the same real
// pages, plus the ones the site had but never surfaced.
//
// WHAT IT RENDERS COMES FROM lib/marketing/navigation.ts, which declares the
// whole long-term architecture and marks each destination live or planned. Only
// live items reach the DOM, so the structure can be committed now without
// shipping a link to a page nobody has written.
//
// A CLIENT COMPONENT, and only for the menus: open/closed state, the Escape
// handler and the hover intent cannot live on the server. Everything it renders
// is static, and nothing session-shaped crosses the boundary.
//
// WHY A DISCLOSURE PATTERN RATHER THAN role="menu". role="menu" is for
// application menus — it swallows Tab, demands arrow-key roving focus, and
// makes a screen reader announce a site nav as a command menu. A site
// navigation is a set of expandable groups of links, which is exactly what
// button[aria-expanded] + a labelled list is for. So: Tab moves through links
// as it does everywhere else, Escape closes, and a screen reader hears
// "Products, collapsed, button".
//
// The logo is the COMPACT lockup, and the mark alone below 30rem — see the
// note in marketing.scss. A raster lockup cannot drop half of itself, so both
// are rendered and CSS chooses, which is also what avoids a layout shift on
// first paint.
// =============================================================================

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { ChevronDown, Menu, X } from "lucide-react";
import { Logo } from "@/components/Logo";
import { ThemeToggle } from "@/components/marketing/ThemeToggle";
import { isEntryActive, liveNavigation, type NavEntry } from "@/lib/marketing/navigation";

/** Computed once at module load: the data is static, so this never re-runs. */
const ENTRIES = liveNavigation();

/**
 * How long the panel stays open after the pointer leaves it.
 *
 * NOT A FLOURISH. The pointer travels diagonally from "Products" down to the
 * third column of its panel, and on the way it crosses the gap between the bar
 * and the panel. Closing instantly makes the menu impossible to use with a
 * mouse — you aim at a link and it vanishes under the cursor. 140ms is long
 * enough to cross the gap and short enough that leaving deliberately still
 * feels immediate.
 */
const CLOSE_DELAY_MS = 140;

export function MarketingHeader() {
  const pathname = usePathname();

  /** The label of the open mega menu, or null. One at a time, by construction. */
  const [openMenu, setOpenMenu] = useState<string | null>(null);
  const [sheetOpen, setSheetOpen] = useState(false);

  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const barRef = useRef<HTMLDivElement>(null);

  const cancelClose = useCallback(() => {
    if (closeTimer.current) {
      clearTimeout(closeTimer.current);
      closeTimer.current = null;
    }
  }, []);

  const closeSoon = useCallback(() => {
    cancelClose();
    closeTimer.current = setTimeout(() => setOpenMenu(null), CLOSE_DELAY_MS);
  }, [cancelClose]);

  const closeNow = useCallback(() => {
    cancelClose();
    setOpenMenu(null);
  }, [cancelClose]);

  // A pending close must not fire after unmount.
  useEffect(() => cancelClose, [cancelClose]);

  /*
    A route change closes everything.

    ADJUSTED DURING RENDER, NOT IN AN EFFECT. React's own guidance for "reset
    state when something changes" is this compare-and-set, and the lint rule
    `react-hooks/set-state-in-effect` rejects the effect version — rightly: an
    effect would paint the open menu over the new page for one frame first.

    It is a safety net rather than the main mechanism. Most of these links are
    in-page fragments, where the pathname does NOT change, so every link also
    closes on click; this catches the browser Back button and the links
    elsewhere on the page.
  */
  const [lastPath, setLastPath] = useState(pathname);
  if (lastPath !== pathname) {
    setLastPath(pathname);
    setOpenMenu(null);
    setSheetOpen(false);
  }

  /*
    Escape closes whichever surface is open, and an open mobile sheet locks the
    page behind it.

    The scroll lock is not optional: without it the page scrolls underneath the
    sheet, which on iOS leaves the reader somewhere else entirely when it
    closes.
  */
  useEffect(() => {
    if (!sheetOpen && !openMenu) return;

    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      setOpenMenu(null);
      setSheetOpen(false);
    };

    document.addEventListener("keydown", onKey);

    if (!sheetOpen) return () => document.removeEventListener("keydown", onKey);

    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    return () => {
      document.body.style.overflow = previous;
      document.removeEventListener("keydown", onKey);
    };
  }, [sheetOpen, openMenu]);

  /*
    A click anywhere outside the bar closes an open mega menu.

    Without this the panel survives a click on the page behind it, which is the
    single most common complaint about mega menus. Pointerdown rather than
    click, so it beats any navigation the click itself starts.
  */
  useEffect(() => {
    if (!openMenu) return;

    const onDown = (event: PointerEvent) => {
      if (barRef.current?.contains(event.target as Node)) return;
      closeNow();
    };

    document.addEventListener("pointerdown", onDown);
    return () => document.removeEventListener("pointerdown", onDown);
  }, [openMenu, closeNow]);

  /**
   * Hover opens — but only on a device that actually has a pointer.
   *
   * On a touchscreen, `mouseenter` fires as a synthesised event just before the
   * tap, so a hover-to-open menu opens and then the tap lands on whatever moved
   * underneath it. Gating on `(hover: hover)` means touch users get the plain
   * press-to-open behaviour the button already has.
   */
  const hoverOpen = (label: string) => {
    if (!window.matchMedia("(hover: hover) and (pointer: fine)").matches) return;
    cancelClose();
    setOpenMenu(label);
  };

  const hoverClose = () => {
    if (!window.matchMedia("(hover: hover) and (pointer: fine)").matches) return;
    closeSoon();
  };

  return (
    <header className="mkt-nav">
      <div
        className="mkt-nav__bar"
        ref={barRef}
        /*
          The panel is a DOM descendant of the bar even though it is painted
          below it, so `mouseleave` — which respects the tree, not the geometry
          — does not fire while the pointer is inside an open panel. That is
          what makes one handler here enough.
        */
        onMouseLeave={hoverClose}
        /*
          Focus leaving the bar entirely closes the panel. Tabbing from the last
          link of the Products panel to the "Who It's For" trigger keeps focus
          inside the bar, so the panel stays open until focus genuinely leaves —
          which is the behaviour a keyboard user expects and the reason this is
          not a blur handler on each trigger.
        */
        onBlur={(event) => {
          if (event.currentTarget.contains(event.relatedTarget as Node | null)) return;
          closeNow();
        }}
      >
        <Link href="/" aria-label="Scoreboad — home" className="mkt-nav__brand">
          {/*
            Both lockups are rendered and CSS shows the one for the resolved
            theme. Choosing in JavaScript would render the wrong one on the
            server for every dark-theme visitor and swap it after hydration —
            a logo that visibly changes as the page loads.
          */}
          <span className="mkt-brand__wide">
            <Logo variant="compact-light" height={26} priority className="mkt-logo--light-ground" />
            <Logo variant="compact" height={26} priority className="mkt-logo--dark-ground" />
          </span>
          <span className="mkt-brand__narrow">
            <Logo variant="mark" height={26} priority />
          </span>
        </Link>

        {/*
          aria-label="Main" rather than "Sections": this is now the site's
          primary navigation landmark, and the footer's is labelled separately
          so a screen reader's landmark list distinguishes them.
        */}
        <nav className="mkt-nav__nav" aria-label="Main">
          <ul className="mkt-nav__links">
            {ENTRIES.map((entry) => (
              <NavItem
                key={entry.label}
                entry={entry}
                pathname={pathname}
                open={openMenu === entry.label}
                onToggle={() => setOpenMenu((current) => (current === entry.label ? null : entry.label))}
                onHoverOpen={() => hoverOpen(entry.label)}
                onNavigate={closeNow}
              />
            ))}
          </ul>
        </nav>

        <div className="mkt-nav__actions">
          <ThemeToggle />
          <Link href="/login" className="mkt-nav__signin">
            Sign In
          </Link>
          {/*
            The CTA names the outcome rather than the mechanic. "Get Started"
            could begin anything; "Start free" says what the click costs, which
            is the question a first-time visitor is actually asking. It is also
            true — signup takes no card.
          */}
          <Link href="/signup" className="mkt-btn mkt-btn--primary mkt-btn--sm">
            Start free
          </Link>
        </div>

        <button
          type="button"
          className="mkt-nav__burger"
          aria-expanded={sheetOpen}
          aria-controls="mkt-mobile-menu"
          aria-label={sheetOpen ? "Close menu" : "Open menu"}
          onClick={() => setSheetOpen((value) => !value)}
        >
          {sheetOpen ? <X size={20} aria-hidden="true" /> : <Menu size={20} aria-hidden="true" />}
        </button>
      </div>

      {sheetOpen && (
        <MobileSheet pathname={pathname} onNavigate={() => setSheetOpen(false)} />
      )}
    </header>
  );
}

// -----------------------------------------------------------------------------
// Desktop
// -----------------------------------------------------------------------------

function NavItem({
  entry,
  pathname,
  open,
  onToggle,
  onHoverOpen,
  onNavigate,
}: {
  entry: NavEntry;
  pathname: string;
  open: boolean;
  onToggle: () => void;
  onHoverOpen: () => void;
  onNavigate: () => void;
}) {
  const active = isEntryActive(entry, pathname);

  if (entry.kind === "link") {
    return (
      <li>
        <Link
          href={entry.href}
          className="mkt-nav__link"
          aria-current={active ? "page" : undefined}
          data-active={active || undefined}
        >
          {entry.label}
        </Link>
      </li>
    );
  }

  const panelId = `mkt-mega-${entry.label.toLowerCase().replace(/[^a-z]+/g, "-")}`;

  return (
    <li className="mkt-nav__item" onMouseEnter={onHoverOpen}>
      <button
        type="button"
        className="mkt-nav__link mkt-nav__trigger"
        aria-expanded={open}
        aria-controls={panelId}
        data-active={active || undefined}
        onClick={onToggle}
      >
        {entry.label}
        <ChevronDown size={14} aria-hidden="true" className="mkt-nav__chev" />
      </button>

      {/*
        RENDERED ONLY WHEN OPEN, rather than hidden with CSS. A permanently
        mounted panel puts every one of its links in the tab order and in the
        accessibility tree while invisible, which is how a keyboard user ends up
        tabbing through eleven links that are not on screen.
      */}
      {open && (
        <div className="mkt-mega" id={panelId}>
          <div className="mkt-mega__panel" data-cols={entry.groups.length}>
            {entry.groups.map((group) => (
              <div key={group.title} className="mkt-mega__col">
                <p className="mkt-mega__title">{group.title}</p>
                <ul>
                  {group.items.map((item) => (
                    <li key={item.href}>
                      <Link
                        href={item.href}
                        className="mkt-mega__link"
                        data-active={
                          pathname === item.href.split("#")[0] && pathname !== "/" ? true : undefined
                        }
                        onClick={onNavigate}
                      >
                        <span className="mkt-mega__label">{item.label}</span>
                        {item.description && (
                          <span className="mkt-mega__desc">{item.description}</span>
                        )}
                      </Link>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </div>
      )}
    </li>
  );
}

// -----------------------------------------------------------------------------
// Mobile
//
// THE SAME ARCHITECTURE, AS AN ACCORDION. Not a reduced menu: a phone visitor
// who cannot reach the screening page from the nav is a phone visitor who
// leaves. The only thing dropped is the one-line description, which doubles the
// height of every row and says nothing the label does not.
// -----------------------------------------------------------------------------

function MobileSheet({ pathname, onNavigate }: { pathname: string; onNavigate: () => void }) {
  /*
    The section covering the current page starts open, everything else closed.
    Opening all of them makes the sheet longer than the phone and buries the
    Sign In button below three scrolls; opening none of them makes the reader
    hunt for where they already are.
  */
  const [expanded, setExpanded] = useState<string | null>(
    () => ENTRIES.find((entry) => isEntryActive(entry, pathname))?.label ?? null
  );

  return (
    <div className="mkt-nav__sheet" id="mkt-mobile-menu">
      <nav aria-label="Main">
        {ENTRIES.map((entry) => {
          if (entry.kind === "link") {
            return (
              <Link
                key={entry.href}
                href={entry.href}
                className="mkt-sheet__row"
                onClick={onNavigate}
              >
                {entry.label}
              </Link>
            );
          }

          const open = expanded === entry.label;
          const sectionId = `mkt-sheet-${entry.label.toLowerCase().replace(/[^a-z]+/g, "-")}`;

          return (
            <div key={entry.label} className="mkt-sheet__group">
              <button
                type="button"
                className="mkt-sheet__row mkt-sheet__toggle"
                aria-expanded={open}
                aria-controls={sectionId}
                onClick={() => setExpanded((current) => (current === entry.label ? null : entry.label))}
              >
                {entry.label}
                <ChevronDown
                  size={16}
                  aria-hidden="true"
                  className="mkt-sheet__chev"
                  data-open={open || undefined}
                />
              </button>

              {open && (
                <div className="mkt-sheet__panel" id={sectionId}>
                  {entry.groups.map((group) => (
                    <div key={group.title}>
                      {/* The heading is dropped when there is only one group:
                          "By team" above the only four items in the menu is a
                          label for nothing. */}
                      {entry.groups.length > 1 && (
                        <p className="mkt-mega__title">{group.title}</p>
                      )}
                      {group.items.map((item) => (
                        <Link
                          key={item.href}
                          href={item.href}
                          className="mkt-sheet__sublink"
                          onClick={onNavigate}
                        >
                          {item.label}
                        </Link>
                      ))}
                    </div>
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </nav>

      <div className="mkt-sheet__theme">
        <span className="mkt-sheet__themelabel" aria-hidden="true">Theme</span>
        <ThemeToggle />
      </div>

      <div className="mkt-nav__sheetactions">
        <Link href="/login" className="mkt-btn mkt-btn--glass" onClick={onNavigate}>
          Sign In
        </Link>
        <Link href="/signup" className="mkt-btn mkt-btn--primary" onClick={onNavigate}>
          Start free
        </Link>
      </div>
    </div>
  );
}
