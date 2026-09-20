import Link from "next/link";
import { Logo } from "@/components/Logo";
import { HOME_FOOTER_SECTIONS } from "@/lib/marketing/home";

/**
 * The public site footer.
 *
 * THE FULL LOCKUP, strapline included — the footer is the one place on the site
 * with the vertical room for it. At 52px the strapline renders around 3px and
 * reads as texture under the name; the description line below carries the
 * actual message.
 *
 * WHY THERE ARE THREE COLUMNS AND NOT FOUR. The brief asked for Product,
 * Company (About / Contact / Security), Resources (Documentation / FAQ / Blog)
 * and Legal (Privacy / Terms). Of those eleven links, two exist. Shipping nine
 * links to pages that do not exist would produce exactly the broken links the
 * brief forbids, and creating nine placeholder pages so a footer looks full is
 * the invented functionality it also forbids.
 *
 * So the columns carry the destinations that are real, and the shortfall is
 * reported rather than hidden. When those pages are written, adding them here is
 * a data change in lib/marketing/home.ts — and lib/marketing/home.test.ts will
 * fail until each one actually resolves.
 */
export function MarketingFooter() {
  const year = new Date().getFullYear();

  return (
    <footer className="mkt-foot">
      <div className="mkt-shell">
        <div className="mkt-foot__top">
          <div className="mkt-foot__brand">
            <Logo variant="full" height={52} />
            <p className="mkt-foot__desc">AI-powered recruitment for modern teams.</p>
          </div>

          {HOME_FOOTER_SECTIONS.map((section) => (
            <nav key={section.title} aria-label={section.title} className="mkt-foot__col">
              <h2 className="mkt-foot__coltitle">{section.title}</h2>
              <ul>
                {section.links.map((link) => (
                  <li key={link.href}>
                    <Link href={link.href}>{link.label}</Link>
                  </li>
                ))}
              </ul>
            </nav>
          ))}
        </div>

        <div className="mkt-foot__bottom">
          <span>© {year} Scoreboad. All rights reserved.</span>
          {/*
            Said here rather than only in the FAQ. Somebody who scrolled to the
            footer looking for a pricing page or a company address should find
            out honestly rather than by clicking a link that goes nowhere.
          */}
          <span className="mkt-foot__note">In active development · pricing not yet published</span>
        </div>
      </div>
    </footer>
  );
}
