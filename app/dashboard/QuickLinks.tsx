// =============================================================================
// Quick links.
//
// Was a stack of plain text links with nothing but line-spacing between them —
// no icons, no hover, no signal that they navigate. It read as an afterthought.
//
// Now: 40px rows, leading icons taken from the NAV BAR so an icon means the same
// thing in both places, a hairline divider between rows, a hover tint, and a
// trailing chevron so it is obvious each row goes somewhere.
//
// Renamed "Go to" -> "Jump to". "Go to" on its own is a sentence fragment
// waiting for an object; as a card heading it reads unfinished.
// =============================================================================
import Link from "next/link";
import {
  Briefcase,
  Calendar,
  ChevronRight,
  Kanban,
  Users,
  type LucideIcon,
} from "lucide-react";

type QuickLink = {
  label: string;
  href: string;
  icon: LucideIcon;
};

/** Same icons as the nav bar, deliberately — one icon, one meaning. */
const LINKS: QuickLink[] = [
  { label: "Jobs", href: "/jobs", icon: Briefcase },
  { label: "Candidates", href: "/candidates", icon: Users },
  { label: "Pipeline", href: "/pipeline", icon: Kanban },
  { label: "Interviews", href: "/interviews", icon: Calendar },
];

export function QuickLinks() {
  return (
    <div className="card dash-card">
      <h2 className="dash-card__title">Jump to</h2>

      <nav className="quick-links" aria-label="Quick links">
        {LINKS.map((link) => {
          const Icon = link.icon;

          return (
            <Link key={link.href} href={link.href} className="quick-links__row">
              <Icon size={16} aria-hidden="true" className="quick-links__icon" />
              <span className="quick-links__label">{link.label}</span>
              <ChevronRight size={16} aria-hidden="true" className="quick-links__chevron" />
            </Link>
          );
        })}
      </nav>
    </div>
  );
}
