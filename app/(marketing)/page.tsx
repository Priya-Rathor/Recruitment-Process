import type { Metadata } from "next";
import Link from "next/link";
import {
  CAPABILITY_GROUPS,
  FAQS,
  HERO_STEPS,
  STATS,
  TRUST_POINTS,
} from "@/lib/marketing/content";
import { FeatureExplorer } from "./_components/FeatureExplorer";

export const metadata: Metadata = {
  // The default title from the layout is right for the home page, so this only
  // overrides the description and the canonical.
  description:
    "An AI-assisted recruitment operating system: jobs, candidates, resume parsing, AI matching, screening calls, pipeline, interviews and analytics in one workspace — with a person making every hiring decision.",
  alternates: { canonical: "/" },
};

/**
 * The landing page.
 *
 * STRUCTURE, and why it is in this order. A visitor gives a page they have
 * never seen roughly one screen before deciding to leave, so the order is:
 * what it is (hero), why believe it (stats, counted from the repo), what it
 * does (the tabbed explorer), the whole thing at a glance (the grid), why trust
 * it with candidate data (the trust band), the awkward questions (FAQ), then
 * the ask.
 *
 * WHAT IS DELIBERATELY MISSING. There is no logo wall, no testimonial and no
 * "trusted by 500 teams" band, because this product has no customers to name
 * yet. Sarvam's page can carry a Tata Capital quote because Tata Capital is
 * genuinely a customer. Inventing the equivalent here would be the one thing
 * this codebase's own rules forbid everywhere else: telling a human something
 * untrue that they will act on. The stat band does that job instead, with
 * numbers anybody can re-derive from the repository.
 */
export default function HomePage() {
  return (
    <>
      {/* ---------------------------------------------------------------- Hero */}
      <section className="mkt-hero">
        <div className="mkt-shell mkt-hero__inner">
          <p className="mkt-pill">In active development · built module by module</p>

          <h1 style={{ marginTop: "var(--space-6)" }}>
            Smarter hiring. Brighter teams.
            {/* The muted second line: the qualifier reads as a separate beat,
                so a long headline scans in two passes instead of one wall.
                Kept from the previous brand because it is the honest half of
                the promise — the headline is now the strapline, and this is
                what stops it reading as "the AI decides". */}
            <span className="mkt-hero__h1-muted">You still make the decisions.</span>
          </h1>

          <p className="mkt-hero__lead">
            One workspace for the whole hiring process — open a role, bring
            candidates in however they arrive, let AI read the resumes and run
            the first screening call, then decide with a pipeline that tells you
            what is actually stuck.
          </p>

          <div className="mkt-hero__ctas">
            <Link href="/signup" className="mkt-btn mkt-btn--invert">
              Get started
            </Link>
            <Link href="/how-it-works" className="mkt-btn mkt-btn--ghost-dark">
              See how it works
            </Link>
          </div>

          {/* A real <ol>: the arrows between steps are CSS, so the order is
              conveyed by the markup and not by a glyph a reader must infer. */}
          <ol className="mkt-steps">
            {HERO_STEPS.map((step) => (
              <li key={step}>{step}</li>
            ))}
          </ol>

          {/* A description list, because each figure genuinely is a term and
              its definition — not three divs pretending to be a table. */}
          <dl className="mkt-stats">
            {STATS.map((stat) => (
              <div key={stat.label} className="mkt-stat">
                <dt>{stat.value}</dt>
                <dd className="mkt-stat__label">{stat.label}</dd>
                <dd className="mkt-stat__note">{stat.note}</dd>
              </div>
            ))}
          </dl>
        </div>
      </section>

      {/* ------------------------------------------------- Capability explorer */}
      <section className="mkt-section" id="product">
        <div className="mkt-shell">
          <div className="mkt-head">
            <p className="mkt-eyebrow">The platform</p>
            <h2>Source. Understand. Screen. Decide.</h2>
            <p className="mkt-lead">
              Twenty modules that read the same records, so a candidate parsed in
              one place is already matched, screened and tracked in the next.
              Pick a stage to see what it actually does.
            </p>
          </div>

          <FeatureExplorer />
        </div>
      </section>

      {/* ------------------------------------------------------- Full overview */}
      <section className="mkt-section mkt-section--tint">
        <div className="mkt-shell">
          <div className="mkt-head">
            <p className="mkt-eyebrow">End to end</p>
            <h2>One connected system, not a suite of tools.</h2>
            <p className="mkt-lead">
              Every stage below writes to the same records and shares the same
              audit log, the same tenant isolation and the same AI review
              pipeline.
            </p>
          </div>

          <div className="mkt-grid">
            {CAPABILITY_GROUPS.map((group) => (
              <Link key={group.slug} href={`/product/${group.slug}`} className="mkt-card">
                <p className="mkt-eyebrow">{group.eyebrow}</p>
                <h3>{group.heading}</h3>
                <p>{group.problem}</p>
                <p className="mkt-card__more" aria-hidden="true">
                  Explore →
                </p>
              </Link>
            ))}
          </div>
        </div>
      </section>

      {/* ---------------------------------------------------------- Trust band */}
      <section className="mkt-section mkt-section--dark" id="trust">
        <div className="mkt-shell">
          <div className="mkt-head">
            <p className="mkt-eyebrow">Trust</p>
            <h2>AI reads the resumes. A person does the hiring.</h2>
            <p className="mkt-lead">
              This matters more in recruitment than almost anywhere else: the
              output is a decision about somebody&rsquo;s livelihood. So the
              boundary between what the model suggests and what a human owns is
              built into the architecture, not written on a policy page.
            </p>
          </div>

          <div className="mkt-trust">
            {TRUST_POINTS.map((point) => (
              <div key={point.title} className="mkt-trust__card">
                <h3>{point.title}</h3>
                <p>{point.body}</p>
                <ul>
                  {point.points.map((line) => (
                    <li key={line}>{line}</li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ---------------------------------------------------------------- FAQ */}
      <section className="mkt-section" id="faq">
        <div className="mkt-shell">
          <div className="mkt-head">
            <p className="mkt-eyebrow">Questions</p>
            <h2>Frequently asked questions.</h2>
          </div>

          {/* Native <details>: keyboard accessible, findable by the browser's
              in-page search, and open-by-default-closed with no JavaScript. */}
          <div className="mkt-faq">
            {FAQS.map((faq) => (
              <details key={faq.q} className="mkt-faq__item">
                <summary className="mkt-faq__q">{faq.q}</summary>
                <p className="mkt-faq__a">{faq.a}</p>
              </details>
            ))}
          </div>
        </div>
      </section>

      {/* ------------------------------------------------------------ Close */}
      <section className="mkt-section mkt-section--tint">
        <div className="mkt-shell mkt-cta">
          <h2>Start with one role.</h2>
          <p className="mkt-lead">
            Create a workspace, open a job, and drop a folder of resumes on it.
            The parsing, matching and screening are there when you want them —
            and the manual workflow works without them.
          </p>
          <div className="mkt-hero__ctas">
            <Link href="/signup" className="mkt-btn mkt-btn--primary">
              Create an account
            </Link>
            <Link href="/how-it-works" className="mkt-btn mkt-btn--ghost">
              Read the full flow
            </Link>
          </div>
        </div>
      </section>
    </>
  );
}
