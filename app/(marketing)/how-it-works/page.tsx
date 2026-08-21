import type { Metadata } from "next";
import Link from "next/link";
import {
  END_TO_END_FLOW,
  ROLE_FLOWS,
  TRUST_POINTS,
  getGroup,
} from "@/lib/marketing/content";

export const metadata: Metadata = {
  title: "How it works",
  description:
    "The full hiring flow, from a client requirement to a collected onboarding document — and exactly where AI assists and where a person decides.",
  alternates: { canonical: "/how-it-works" },
};

/**
 * The how-it-works page.
 *
 * THE DIAGRAM IS AN ORDERED LIST, NOT AN IMAGE. Fifteen stages rendered as a
 * picture would be an image of text: unreadable at phone width, invisible to a
 * screen reader, unsearchable, and untranslatable. The numbered rail and the
 * connecting line are CSS on a real <ol>, so the order is in the markup and the
 * visual is decoration on top of it.
 *
 * Each stage links to the product page for its stage group, which is what makes
 * this page a hub rather than a dead end.
 */
export default function HowItWorksPage() {
  return (
    <>
      <section className="mkt-hero">
        <div className="mkt-shell mkt-hero__inner">
          <nav className="mkt-crumb" aria-label="Breadcrumb">
            <Link href="/">Home</Link>
            <span aria-hidden="true">/</span>
            <span>How it works</span>
          </nav>

          <p className="mkt-eyebrow">End to end</p>
          <h1 style={{ fontSize: "var(--mkt-h2)" }}>
            From a client requirement to somebody&rsquo;s first day.
          </h1>
          <p className="mkt-hero__lead">
            Fifteen stages, one set of records. Every step below is a real
            surface in the product, and every AI step has a human review in front
            of the business action it leads to.
          </p>
        </div>
      </section>

      {/* --------------------------------------------------------- The flow */}
      <section className="mkt-section">
        <div className="mkt-shell">
          <div className="mkt-head">
            <p className="mkt-eyebrow">The flow</p>
            <h2>What happens, in order.</h2>
          </div>

          <ol className="mkt-flow">
            {END_TO_END_FLOW.map((step) => {
              const group = getGroup(step.group);
              return (
                <li key={step.stage} className="mkt-flow__item">
                  <p className="mkt-flow__stage">{step.stage}</p>
                  <p className="mkt-flow__detail">
                    {step.detail}{" "}
                    {group ? (
                      <Link
                        href={`/product/${group.slug}`}
                        style={{ color: "var(--color-primary)", fontWeight: 600 }}
                      >
                        {group.tab}
                      </Link>
                    ) : null}
                  </p>
                </li>
              );
            })}
          </ol>
        </div>
      </section>

      {/* --------------------------------------------------------- By role */}
      <section className="mkt-section mkt-section--tint">
        <div className="mkt-shell">
          <div className="mkt-head">
            <p className="mkt-eyebrow">By role</p>
            <h2>The same system, four different jobs.</h2>
            <p className="mkt-lead">
              A hiring manager does not want a recruiting tool, and a candidate
              never signed up for one. Both still have to be served.
            </p>
          </div>

          <div className="mkt-grid">
            {ROLE_FLOWS.map((flow) => (
              <div key={flow.role} className="mkt-role">
                <h3>{flow.role}</h3>
                <p>{flow.summary}</p>
                <ol>
                  {flow.steps.map((step) => (
                    <li key={step}>{step}</li>
                  ))}
                </ol>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ------------------------------------------------------- AI safety */}
      <section className="mkt-section mkt-section--dark" id="ai-safety">
        <div className="mkt-shell">
          <div className="mkt-head">
            <p className="mkt-eyebrow">The AI safety model</p>
            <h2>Where the model stops.</h2>
            <p className="mkt-lead">
              The pipeline runs in one direction and never skips a step: raw
              data, then AI, then a structured output, then validation, then
              human review, and only then a business action.
            </p>
          </div>

          {/* The pipeline itself, as text rather than a graphic — it is six
              words and an arrow, which does not need an SVG. */}
          <p
            style={{
              fontFamily: "var(--font-heading)",
              fontSize: "clamp(0.9375rem, 2vw, 1.25rem)",
              lineHeight: 1.9,
              color: "var(--mkt-on-dark)",
              marginBottom: "clamp(2.5rem, 5vw, 3.5rem)",
              maxWidth: "52rem",
            }}
          >
            Raw data <span style={{ color: "var(--mkt-accent-on-dark)" }}>→</span> AI{" "}
            <span style={{ color: "var(--mkt-accent-on-dark)" }}>→</span> structured output{" "}
            <span style={{ color: "var(--mkt-accent-on-dark)" }}>→</span> validation{" "}
            <span style={{ color: "var(--mkt-accent-on-dark)" }}>→</span>{" "}
            <strong>human review</strong>{" "}
            <span style={{ color: "var(--mkt-accent-on-dark)" }}>→</span> business action
          </p>

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

      {/* ----------------------------------------------------------- Close */}
      <section className="mkt-section">
        <div className="mkt-shell mkt-cta">
          <h2>Open one role and see.</h2>
          <p className="mkt-lead">
            The manual workflow works on its own. The AI is assistance you switch
            on, not a dependency you inherit.
          </p>
          <div className="mkt-hero__ctas">
            <Link href="/signup" className="mkt-btn mkt-btn--primary">
              Create an account
            </Link>
            <Link href="/" className="mkt-btn mkt-btn--ghost">
              Back to overview
            </Link>
          </div>
        </div>
      </section>
    </>
  );
}
