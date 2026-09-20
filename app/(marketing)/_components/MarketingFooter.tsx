import Link from "next/link";
import { FOOTER_SECTIONS } from "@/lib/marketing/content";
import { MarketingWordmark } from "./MarketingWordmark";

/**
 * The public site footer.
 *
 * The legal column is intentionally absent rather than stubbed. Linking
 * "Privacy" and "Terms" to pages that do not exist yet would ship four 404s
 * into the footer of every page — and a privacy link that 404s is worse than no
 * link at all, because a visitor reads it as a policy that was withdrawn.
 * Phase 11 of the module brief adds those pages; the column goes in with them.
 */
export function MarketingFooter() {
  const year = new Date().getFullYear();

  return (
    <footer className="mkt-footer">
      <div className="mkt-shell">
        <div className="mkt-footer__top">
          <div>
            <MarketingWordmark height={28} />
            <p className="mkt-footer__tagline">
              An AI-assisted recruitment operating system. Jobs, candidates,
              screening, interviews and analytics in one workspace — with a
              person making every hiring decision.
            </p>
          </div>

          {FOOTER_SECTIONS.map((section) => (
            <div key={section.title} className="mkt-footer__col">
              <h3>{section.title}</h3>
              <ul>
                {section.links.map((link) => (
                  <li key={link.href}>
                    <Link href={link.href}>{link.label}</Link>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>

        <div className="mkt-footer__bottom">
          <span>© {year} Scoreboad</span>
          <span>
            In active development. Pricing is not published yet — talk to us
            about where it stands for your use case.
          </span>
        </div>
      </div>
    </footer>
  );
}
