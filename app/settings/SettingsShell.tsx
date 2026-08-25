import Link from "next/link";
import type { ReactNode } from "react";
import { ArrowLeft } from "lucide-react";
import { AppShell } from "@/components/AppShell";

/*
  THE SIDEBAR IS GONE.

  Settings used to be a permanent left nav beside a detail panel. Twelve rows of
  similar-length text, always on screen, competing with the page you actually
  opened — and the deeper the section list grew, the more of the panel it ate.

  The replacement is a categorised grid at /settings and this shell, which now
  does one job: frame a single settings page and give it an explicit way back.
  The navigation is a place you go, not furniture you carry.

  WHAT DID NOT CHANGE: every individual settings page's content, its role checks,
  and RestrictedPanel. The `current` prop is gone because there is no longer an
  active row to mark; `title` already names the page.

  The catalogue moved to ./catalog.ts so the grid and the role gating read one
  list. `visibleSections` is re-exported for anything still importing it from
  here.
*/
export { visibleLinks as visibleSections, firstVisibleHref } from "./catalog";

/*
  NO `role` PROP.

  The old shell needed it to decide which sidebar rows to draw. With the sidebar
  gone the frame has no role-dependent output at all — every page still does its
  own check and renders RestrictedPanel itself, which is where that decision
  belongs. Keeping the prop "for later" would have meant a permanently unused
  argument on fifteen call sites; it can come back the day something here needs it.
*/
export function SettingsShell({
  title,
  description,
  back,
  children,
}: {
  title: string;
  description?: string;
  /**
   * Where "back" goes. Defaults to the landing grid.
   *
   * Overridden by a page nested one level deeper — the Voice Agent Console lives
   * under Integrations, and sending it to /settings would skip the page it
   * actually belongs to. Without this the console needed its own second back
   * link, which meant two stacked arrows saying different things.
   */
  back?: { href: string; label: string };
  children: ReactNode;
}) {
  const target = back ?? { href: "/settings", label: "Settings" };

  return (
    <AppShell>
      {/*
        The back link IS the navigation now, so it comes first and it is a real
        link with a visible focus state — not a chevron glued to the heading.
      */}
      <Link className="settings-back" href={target.href}>
        <ArrowLeft size={14} aria-hidden="true" />
        {target.label}
      </Link>

      <div className="settings-page">
        <div className="mb-5">
          <h1 className="title is-4 mb-1">{title}</h1>
          {description && (
            <p className="has-text-secondary" style={{ fontSize: 13 }}>
              {description}
            </p>
          )}
        </div>
        {children}
      </div>
    </AppShell>
  );
}

/** The shared "your role can't open this" panel. Unchanged. */
export function RestrictedPanel({ what }: { what: string }) {
  return (
    <div className="card">
      <h2 className="title is-5">You can&apos;t manage {what}</h2>
      <p className="has-text-secondary mb-4" style={{ fontSize: 14 }}>
        Only an Owner or Admin can change this. You can still see the settings that affect your own
        work.
      </p>
      <Link className="button is-small is-outlined-primary" href="/settings">
        Back to settings
      </Link>
    </div>
  );
}
