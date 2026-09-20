import type { Metadata } from "next";
import { buildMetadata } from "@/lib/marketing/seo";
import Link from "next/link";
import { notFound } from "next/navigation";
import { CAPABILITY_GROUPS, getGroup } from "@/lib/marketing/content";

/**
 * The six product pages, from one template.
 *
 * ONE ROUTE, NOT SIX FILES. The alternative — app/(marketing)/product/source,
 * /understand, /screen and so on — is six near-identical page components, which
 * means a layout change is six edits and a seventh page written next month
 * quietly diverges from the other six. The content lives in
 * lib/marketing/content.ts and this file is the layout for all of them.
 *
 * STATICALLY GENERATED. generateStaticParams enumerates the six slugs at build
 * time, so these are prerendered HTML rather than rendered per request. The
 * `dynamicParams = false` below is the important half: without it, a request
 * for /product/anything-else would be rendered on demand, and the 404 would
 * cost a server render. With it, Next serves a 404 for anything not in the six.
 */
export function generateStaticParams() {
  return CAPABILITY_GROUPS.map((group) => ({ slug: group.slug }));
}

export const dynamicParams = false;

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const group = getGroup(slug);
  if (!group) return {};

  // The root layout's template appends "· Scoreboad" to the title; the helper
  // builds the canonical, the Open Graph block and the Twitter card from the
  // same three values, so the six product pages cannot drift from each other.
  return buildMetadata({
    title: group.tab,
    description: group.summary,
    path: `/product/${group.slug}`,
  });
}

export default async function ProductPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const group = getGroup(slug);
  if (!group) notFound();

  const related = group.connectsTo
    .map((s) => getGroup(s))
    .filter((g): g is NonNullable<typeof g> => Boolean(g));

  return (
    <>
      {/* ------------------------------------------------------ Page header */}
      <section className="mkt-hero">
        <div className="mkt-shell mkt-hero__inner">
          <nav className="mkt-crumb" aria-label="Breadcrumb">
            <Link href="/">Home</Link>
            <span aria-hidden="true">/</span>
            <span>{group.tab}</span>
          </nav>

          <p className="mkt-eyebrow">{group.eyebrow}</p>
          <h1 style={{ fontSize: "var(--mkt-h2)" }}>{group.heading}</h1>
          <p className="mkt-hero__lead">{group.summary}</p>

          <dl className="mkt-meta">
            <div className="mkt-meta__item">
              <dt>Who it is for</dt>
              <dd>{group.audience}</dd>
            </div>
            <div className="mkt-meta__item">
              <dt>The problem</dt>
              <dd>{group.problem}</dd>
            </div>
          </dl>
        </div>
      </section>

      {/* ------------------------------------------------------ What it does */}
      <section className="mkt-section">
        <div className="mkt-shell">
          <div className="mkt-head">
            <p className="mkt-eyebrow">What it does</p>
            <h2>The short version.</h2>
          </div>

          <ul className="mkt-caps" style={{ maxWidth: "62rem" }}>
            {group.capabilities.map((cap) => (
              <li key={cap.label} className="mkt-cap">
                <strong>{cap.label}</strong>
                <span>{cap.detail}</span>
              </li>
            ))}
          </ul>
        </div>
      </section>

      {/* --------------------------------------------------- Modules in detail */}
      <section className="mkt-section mkt-section--tint">
        <div className="mkt-shell">
          <div className="mkt-head">
            <p className="mkt-eyebrow">In detail</p>
            <h2>What is actually in here.</h2>
            <p className="mkt-lead">
              The modules behind this stage. Each one is specified and built
              against a written brief before it ships.
            </p>
          </div>

          <ul className="mkt-modules">
            {group.modules.map((module) => (
              <li key={module.name} className="mkt-module">
                <strong>{module.name}</strong>
                <span>{module.what}</span>
              </li>
            ))}
          </ul>
        </div>
      </section>

      {/* ------------------------------------------------------- AI boundary */}
      <section className="mkt-section">
        <div className="mkt-shell">
          <div className="mkt-head">
            <p className="mkt-eyebrow">The AI boundary</p>
            <h2>
              {group.aiBoundary
                ? "What the model offers, and what you own."
                : "No AI in this stage."}
            </h2>
          </div>

          {group.aiBoundary ? (
            <div className="mkt-boundary" style={{ maxWidth: "62rem" }}>
              <div className="mkt-boundary__half">
                <h3>AI proposes</h3>
                <p>{group.aiBoundary.proposes}</p>
              </div>
              <div className="mkt-boundary__half mkt-boundary__half--human">
                <h3>A person confirms</h3>
                <p>{group.aiBoundary.confirms}</p>
              </div>
            </div>
          ) : (
            <p className="mkt-lead" style={{ marginTop: 0 }}>
              This stage is deterministic. Saying so matters: a product that
              implies every surface is AI-driven is harder to trust than one that
              tells you exactly where the model is and is not involved.
            </p>
          )}
        </div>
      </section>

      {/* ---------------------------------------------------------- Connects */}
      <section className="mkt-section mkt-section--tint">
        <div className="mkt-shell">
          <div className="mkt-head">
            <p className="mkt-eyebrow">Connects to</p>
            <h2>Where this sits in the flow.</h2>
          </div>

          <div className="mkt-grid">
            {related.map((rel) => (
              <Link key={rel.slug} href={`/product/${rel.slug}`} className="mkt-card">
                <p className="mkt-eyebrow">{rel.eyebrow}</p>
                <h3>{rel.heading}</h3>
                <p>{rel.problem}</p>
                <p className="mkt-card__more" aria-hidden="true">
                  Explore →
                </p>
              </Link>
            ))}
            <Link href="/how-it-works" className="mkt-card">
              <p className="mkt-eyebrow">End to end</p>
              <h3>The whole hiring flow, in order.</h3>
              <p>
                Every stage from a client requirement to a collected onboarding
                document, and what each role actually does.
              </p>
              <p className="mkt-card__more" aria-hidden="true">
                Read it →
              </p>
            </Link>
          </div>
        </div>
      </section>

      {/* -------------------------------------------------------------- Close */}
      <section className="mkt-section mkt-section--dark">
        <div className="mkt-shell mkt-cta">
          <h2>Try it on one role.</h2>
          <p className="mkt-lead">
            Create a workspace and open a job. Nothing here requires you to
            migrate anything first.
          </p>
          <div className="mkt-hero__ctas">
            <Link href="/signup" className="mkt-btn mkt-btn--invert">
              Get started
            </Link>
            <Link href="/" className="mkt-btn mkt-btn--ghost-dark">
              Back to overview
            </Link>
          </div>
        </div>
      </section>
    </>
  );
}
