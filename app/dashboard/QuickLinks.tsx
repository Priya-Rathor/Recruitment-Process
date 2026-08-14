// Quick links into the modules the spec names: Jobs, Candidates, Pipeline,
// Interviews. Those routes belong to Modules 3, 4, 10 and 11 — until each ships,
// its link is shown disabled with the module noted, rather than as a live link
// that would 404.
import Link from "next/link";

type QuickLink = {
  label: string;
  href: string;
  /** Set while the owning module doesn't exist; flip to false on retrofit. */
  pendingModule: number | null;
};

const LINKS: QuickLink[] = [
  { label: "Jobs", href: "/jobs", pendingModule: null },
  { label: "Candidates", href: "/candidates", pendingModule: null },
  { label: "Pipeline", href: "/pipeline", pendingModule: 10 },
  { label: "Interviews", href: "/interviews", pendingModule: 11 },
  { label: "Team", href: "/team/invite", pendingModule: null },
];

export function QuickLinks() {
  return (
    <div className="card">
      <h2 className="title is-5">Go to</h2>
      <ul>
        {LINKS.map((link) => (
          <li key={link.href} className="py-2">
            {link.pendingModule === null ? (
              <Link href={link.href} style={{ fontSize: 14, fontWeight: 600 }}>
                {link.label}
              </Link>
            ) : (
              <span
                className="is-flex is-justify-content-space-between is-align-items-center"
                style={{ fontSize: 14 }}
              >
                <span className="has-text-secondary">{link.label}</span>
                <span className="tag is-light" style={{ fontSize: 11 }}>
                  Module {link.pendingModule}
                </span>
              </span>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
