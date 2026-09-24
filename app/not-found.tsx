import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { Logo } from "@/components/Logo";
import { NOT_FOUND, RECOVERY_LINKS } from "@/lib/marketing/errors";
// The marketing stylesheet, because this page is NOT inside (marketing).
// See the note below on why it renders in the root layout.
import "./(marketing)/marketing.scss";

/**
 * The global 404.
 *
 * -----------------------------------------------------------------------------
 * WHERE THIS RENDERS, AND WHY IT BRINGS ITS OWN STYLESHEET
 * -----------------------------------------------------------------------------
 *
 * Next 16's `app/not-found.tsx` handles every unmatched URL for the whole
 * application, and it renders inside the ROOT layout — not inside
 * `app/(marketing)/layout.tsx`. A route group cannot match a path that matches
 * nothing, so there is no way to put the global 404 inside the marketing shell.
 *
 * Two consequences, both deliberate rather than overlooked:
 *
 *   1. `marketing.scss` is imported here, since the layout that normally loads
 *      it is not in this tree. Next dedupes the import, so a visitor who
 *      arrives from a marketing page does not download it twice.
 *   2. THERE IS NO NAVBAR AND NO FOOTER. They belong to the marketing layout.
 *      Rather than reconstructing that shell around an error page — which would
 *      mean this file quietly owning a second copy of the site chrome — the
 *      recovery links below ARE the navigation. A 404 wants one obvious way out
 *      and a few plausible destinations, not the full site index.
 *
 * -----------------------------------------------------------------------------
 * NO `metadata` EXPORT, AND THAT IS A FRAMEWORK LIMIT WORTH RECORDING
 * -----------------------------------------------------------------------------
 *
 * `not-found.tsx` does not support a metadata export in this version — only the
 * experimental `global-not-found.tsx` does, and enabling that means an
 * experimental flag in the same `next.config.ts` that carries the production
 * security headers, plus re-importing fonts and globals by hand. That is a poor
 * trade for a `<title>` on a page Next already marks `noindex`. So the title
 * comes from the root layout, and the page says what it is in its own H1.
 *
 * RENDERING A <title> HERE WAS TRIED AND REVERTED. React 19 hoists a <title>
 * from anywhere in the tree, so it is a tempting one-liner — but Next's
 * metadata system has already emitted one, and the result was TWO <title>
 * elements with the layout's generic marketing title first. Browsers use the
 * first, so the page kept the wrong title AND gained invalid markup. Measured,
 * not assumed.
 *
 * SEO: Next injects `<meta name="robots" content="noindex">` on a 404 response
 * automatically, and `app/sitemap.ts` lists only real routes — so nothing here
 * needed changing to keep this page out of the index.
 *
 * A SERVER COMPONENT. The whole page is markup and CSS; nothing here ships
 * JavaScript, which matters most on the page a crawler or a mistyped link hits.
 */
export default function NotFound() {
  return (
    <div className="mkt nf">
      <div className="mkt-shell nf__inner">
        <Link href="/" className="nf__logo" aria-label="Scoreboad, back to the home page">
          <Logo variant="compact" height={30} />
        </Link>

        <div className="nf__grid">
          <div className="nf__copy">
            <p className="nf__eyebrow">{NOT_FOUND.eyebrow}</p>
            <h1 className="nf__title">{NOT_FOUND.title}</h1>
            <p className="nf__lead">{NOT_FOUND.lead}</p>

            <div className="nf__actions">
              <Link href={NOT_FOUND.primary.href} className="mkt-btn mkt-btn--primary">
                {NOT_FOUND.primary.label}
                <ArrowRight size={17} aria-hidden="true" />
              </Link>
            </div>

            <nav className="nf__recovery" aria-label="Other places to go">
              <p className="nf__recoverytitle">Or pick up where you meant to be</p>
              <ul>
                {RECOVERY_LINKS.map((link) => (
                  <li key={link.href}>
                    <Link href={link.href}>
                      {link.label}
                      <ArrowRight size={14} aria-hidden="true" />
                    </Link>
                  </li>
                ))}
              </ul>
            </nav>
          </div>

          {/*
            §3's visual. Five real workflow stages around the mark, with the
            fourth detached and reconnecting.

            `aria-hidden`, and §17 is explicit about why that is safe here: the
            error is stated in the H1 and the paragraph under it. The diagram is
            a mood, not information — a screen reader user who heard five stage
            names and "disconnected" would be told the product was broken, which
            is the opposite of what happened.

            NO BROKEN ROBOT, no warning triangle, no glitch. The thing that went
            wrong is a URL.
          */}
          <div className="nf__diagram" aria-hidden="true">
            <span className="nf__glow" />
            <span className="nf__mark">
              <Logo variant="mark" height={40} />
            </span>

            <ul className="nf__stages">
              {NOT_FOUND.stages.map((stage, index) => (
                <li
                  key={stage}
                  className="nf__stage"
                  data-detached={index === NOT_FOUND.detached || undefined}
                  style={{ "--i": index } as React.CSSProperties}
                >
                  {stage}
                </li>
              ))}
            </ul>
          </div>
        </div>
      </div>
    </div>
  );
}
