import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { Logo } from "@/components/Logo";
import { FOOTER_BRAND, FOOTER_LEGAL } from "@/lib/marketing/footer";
import { FooterNav } from "./footer/FooterNav";
import { FooterOrb } from "./footer/FooterOrb";

/**
 * The public site footer. Rendered once, by app/(marketing)/layout.tsx, so it
 * is on every public page and on none of the authenticated app's — that
 * separation already existed and is left alone.
 *
 * -----------------------------------------------------------------------------
 * THERE IS NO CTA BAND IN HERE, AND THAT IS §28 RATHER THAN AN OMISSION
 * -----------------------------------------------------------------------------
 *
 * §5 asks for a closing "Ready to rethink your hiring workflow?" block with two
 * buttons. §28 then says not to add one if the page already ends with a strong
 * CTA. It does — and not only the homepage: the homepage, /about, /security and
 * /faq each close on a full dark `mkt-band--cta` with the same two actions.
 * Adding another would stack two near-identical CTAs at the bottom of four of
 * the site's nine page types, with the second one weaker for being generic.
 *
 * So the conversion path is ONE compact action in the brand block, which serves
 * the pages that have no closing CTA (/how-it-works, /product/*, /contact)
 * without doubling up on the ones that do. The continuity §24 asks for is
 * carried by the converging-workflow visual instead, which is the part that
 * actually ties the footer to the page above it.
 *
 * -----------------------------------------------------------------------------
 * WHAT IS NOT HERE BECAUSE IT DOES NOT EXIST
 * -----------------------------------------------------------------------------
 *
 * No social row (no verified account anywhere in this project), no Privacy,
 * Terms or Cookie links (no such pages — app/settings/privacy is an in-product
 * admin screen behind auth), no Careers, no Blog, no demo booking. The audit is
 * written out in lib/marketing/footer.ts. The status line at the bottom is the
 * honest version of that shortfall, and it has been there since Module 01.
 */
export function MarketingFooter() {
  /*
    §17 — the CURRENT year, computed per render. This is a server component, so
    it is the server's clock rather than the visitor's, and it cannot go stale
    the way a hardcoded year does on 1 January.
  */
  const year = new Date().getFullYear();

  return (
    <footer className="mkt-foot">
      {/* A soft wash at the very top edge, so the footer arrives rather than starts. */}
      <span className="mkt-foot__wash" aria-hidden="true" />

      <div className="mkt-shell">
        <div className="mkt-foot__top">
          {/* ---- Brand ------------------------------------------------- */}
          <div className="mkt-foot__brand">
            {/*
              THE FULL LOCKUP, strapline included — the footer is the one place
              on the site with the vertical room for it.
            */}
            <Logo variant="full" height={52} />

            <p className="mkt-foot__desc">{FOOTER_BRAND.description}</p>

            <Link href={FOOTER_BRAND.action.href} className="mkt-btn mkt-btn--primary mkt-foot__cta">
              {FOOTER_BRAND.action.label}
              <ArrowRight size={16} aria-hidden="true" />
            </Link>

            <FooterOrb />
          </div>

          {/* ---- Navigation -------------------------------------------- */}
          <FooterNav />
        </div>

        {/*
          §26's legal row. It sits above the copyright line rather than in a
          column: these are reference documents somebody looks up deliberately,
          not navigation, and the bottom bar is where a reader expects them.
        */}
        <nav className="mkt-foot__legal" aria-label="Legal">
          <ul>
            {FOOTER_LEGAL.map((link) => (
              <li key={link.href}>
                <Link href={link.href}>{link.label}</Link>
              </li>
            ))}
          </ul>
        </nav>

        <div className="mkt-foot__bottom">
          <span>© {year} Scoreboad. All rights reserved.</span>
          {/*
            Said here rather than only in the FAQ. Somebody who scrolled to the
            footer looking for a pricing page or a company address should find
            out honestly rather than by clicking a link that goes nowhere.
          */}
          <span className="mkt-foot__note">{FOOTER_BRAND.note}</span>
        </div>
      </div>
    </footer>
  );
}
