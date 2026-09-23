import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight } from "lucide-react";
import {
  SECURITY_ACCESS,
  SECURITY_AI,
  SECURITY_ARCHITECTURE,
  SECURITY_AUDIT,
  SECURITY_CONTENTS,
  SECURITY_DATA,
  SECURITY_ISOLATION,
  SECURITY_PAGE_HERO,
  SECURITY_PILLARS,
  SECURITY_PRINCIPLES,
  SECURITY_PRIVACY,
  SECURITY_STATUS,
} from "@/lib/marketing/security";
import { buildMetadata } from "@/lib/marketing/seo";
import { Breadcrumbs } from "@/components/marketing/Breadcrumbs";
import { Section } from "@/components/marketing/Section";
import { SectionHeading } from "@/components/marketing/SectionHeading";
import { Reveal, Stagger } from "@/components/marketing/Reveal";
import { iconFor } from "../_components/home/icons";
import { SecurityOrb } from "../_components/security/SecurityOrb";
import { ArchitectureStack } from "../_components/security/ArchitectureStack";

/**
 * §22 — built by the shared helper, so the canonical, Open Graph and Twitter
 * blocks are constructed exactly as every other public page's are.
 *
 * THE DESCRIPTION MAKES NO CLAIM THE PAGE DOES NOT. It says what the page
 * covers rather than asserting a security posture, because a meta description
 * is the one piece of copy that gets quoted somewhere nobody can see the
 * caveats beside it.
 */
export const metadata: Metadata = buildMetadata({
  title: "Security — Secure AI Recruitment Software",
  description:
    "How Scoreboad approaches security: access control, workspace isolation, " +
    "candidate data handling, AI validation and human review across the " +
    "hiring process — with the gaps named rather than left out.",
  path: "/security",
});

/**
 * The Security page.
 *
 * EVERY CLAIM HERE IS CLASSIFIED IN `lib/marketing/security.ts`, whose header
 * records what was verified in the source, what is partial or absent, and the
 * one thing (blanket encryption) deliberately left unsaid because this project
 * has not verified it.
 *
 * ONE STICKY SECTION, the architecture stack. §26 asks for exactly that and no
 * more, and this page is otherwise read top to bottom.
 *
 * ENTIRELY SERVER-RENDERED except <ArchitectureStack>, which holds the current
 * layer, and <Reveal>. The hero diagram is CSS on server-rendered markup.
 */
export default function SecurityPage() {
  return (
    <>
      {/* ---- Hero --------------------------------------------------------- */}
      <section
        className="mkt-band mkt-band--dark sec-hero"
        aria-labelledby="security-heading"
      >
        <div className="mkt-shell">
          <Breadcrumbs
            items={[
              { label: "Home", href: "/" },
              { label: "Security", href: "/security" },
            ]}
          />

          <div className="sec-hero__grid">
            <div className="sec-hero__copy">
              <h1 id="security-heading" className="sec-hero__title">
                {SECURITY_PAGE_HERO.title}
              </h1>
              <p className="sec-hero__lead">{SECURITY_PAGE_HERO.lead}</p>

              {/*
                THE DIAGRAM'S TEXT EQUIVALENT (§28), and a real list rather than
                a caption: the drawing beside it is aria-hidden, so this is what
                a screen reader and a crawler actually receive. It is visible to
                everyone because it is worth reading on its own.
              */}
              <ol className="sec-hero__flow">
                {SECURITY_PAGE_HERO.flow.map((beat) => (
                  <li key={beat.label}>
                    <span className="sec-hero__flowlabel">{beat.label}</span>
                    <span className="sec-hero__flownote">{beat.note}</span>
                  </li>
                ))}
              </ol>
            </div>

            <SecurityOrb />
          </div>
        </div>
      </section>

      {/*
        ---- §25 · Contents ------------------------------------------------

        A STICKY STRIP RATHER THAN A SIDE RAIL, and this is a deliberate
        deviation from the brief's "sticky side navigation on desktop".

        This site's rhythm is full-bleed bands that alternate dark and light —
        the design system since Module 01. A persistent side rail would either
        sit over a dark band wearing light-band colours, or force every section
        into a narrow column beside it, which is precisely the width the
        architecture diagram needs. A strip gives the same affordance at every
        breakpoint, scrolls horizontally on a phone, and cannot collide with the
        one pinned visual further down.
      */}
      <nav className="sec-toc" aria-label="On this page">
        <div className="mkt-shell">
          <ul className="sec-toc__list">
            {SECURITY_CONTENTS.map((entry) => (
              <li key={entry.id}>
                <a href={`#${entry.id}`}>{entry.label}</a>
              </li>
            ))}
          </ul>
        </div>
      </nav>

      {/* ---- §5 · Overview ------------------------------------------------- */}
      <Section tone="light" id="overview">
        <SectionHeading
          eyebrow="Overview"
          title="Security across the hiring lifecycle."
          lead="Five areas, each one backed by a mechanism in the product rather than a posture."
        />

        <Stagger as="ul" className="sec-pillars" max={5}>
          {SECURITY_PILLARS.map((pillar) => {
            const Icon = iconFor(pillar.icon);
            return (
              <article key={pillar.key} className="sec-pillar">
                <span className="sec-pillar__icon" aria-hidden="true">
                  <Icon size={19} strokeWidth={1.6} />
                </span>
                <h3>{pillar.label}</h3>
                {/*
                  The question is the card's subtitle, and it is the thing a
                  reader is actually holding when they arrive at a security
                  page. The body answers it.
                */}
                <p className="sec-pillar__q">{pillar.question}</p>
                <p className="sec-pillar__body">{pillar.body}</p>
              </article>
            );
          })}
        </Stagger>
      </Section>

      {/* ---- §6 · Architecture --------------------------------------------- */}
      <Section tone="dark" id="architecture">
        <SectionHeading
          eyebrow="Architecture"
          title="What a request passes through."
          lead="Eight layers, in order. Each one names the mechanism that performs it."
          tone="dark"
        />

        <ArchitectureStack />

        {/*
          THE WHOLE STACK AS PROSE, for anyone who never reaches the pinned
          version — no JavaScript, reduced motion, a text browser, or a crawler.
          `is-sr-only` rather than absent: the diagram above is interactive and
          this is the same content, so showing both would be reading the page
          twice.
        */}
        <div className="is-sr-only">
          <h3>The architecture in full</h3>
          <dl>
            {SECURITY_ARCHITECTURE.map((item) => (
              <div key={item.key}>
                <dt>{item.label}</dt>
                <dd>{item.detail}</dd>
              </div>
            ))}
          </dl>
        </div>
      </Section>

      {/* ---- §7 · Access control -------------------------------------------- */}
      <Section tone="light" id="access">
        <SectionHeading
          eyebrow="Access control"
          title={SECURITY_ACCESS.title}
          lead={SECURITY_ACCESS.lead}
        />

        <Reveal className="sec-access">
          <ol className="sec-access__layers">
            {SECURITY_ACCESS.layers.map((layer, index) => (
              <li key={layer.label} className="sec-access__layer">
                <span className="sec-access__num" aria-hidden="true">
                  {String(index + 1).padStart(2, "0")}
                </span>
                <h3>{layer.label}</h3>
                <p>{layer.body}</p>
              </li>
            ))}
          </ol>

          <div className="sec-roles">
            <h3 className="sec-roles__title">The four roles</h3>
            <ul className="sec-roles__list">
              {SECURITY_ACCESS.roles.map((role) => (
                <li key={role}>{role}</li>
              ))}
            </ul>
          </div>
        </Reveal>
      </Section>

      {/* ---- §8 · Isolation --------------------------------------------------- */}
      <Section tone="dark" id="isolation">
        <SectionHeading
          eyebrow="Data isolation"
          title={SECURITY_ISOLATION.title}
          lead={SECURITY_ISOLATION.lead}
          tone="dark"
        />

        <Reveal className="sec-iso">
          {/*
            Two workspaces with the same record types and a seam between them.
            The point of drawing both is that the picture is about the BOUNDARY,
            and a single box cannot show a boundary.
          */}
          <div className="sec-iso__pair">
            {["Workspace A", "Workspace B"].map((name) => (
              <div key={name} className="sec-iso__box">
                <p className="sec-iso__name">{name}</p>
                <ul className="sec-iso__records">
                  {SECURITY_ISOLATION.records.map((record) => (
                    <li key={record}>{record}</li>
                  ))}
                </ul>
              </div>
            ))}

            <span className="sec-iso__seam" aria-hidden="true">
              <span className="sec-iso__seamlabel">No path across</span>
            </span>
          </div>

          <ul className="sec-iso__points">
            {SECURITY_ISOLATION.points.map((point) => (
              <li key={point.label}>
                <h3>{point.label}</h3>
                <p>{point.body}</p>
              </li>
            ))}
          </ul>
        </Reveal>
      </Section>

      {/* ---- §9, §12–14 · Data handling ---------------------------------------- */}
      <Section tone="light" id="data">
        <SectionHeading
          eyebrow="Data handling"
          title={SECURITY_DATA.title}
          lead={SECURITY_DATA.lead}
        />

        <Stagger as="ul" className="sec-data" max={4}>
          {SECURITY_DATA.groups.map((group) => {
            const Icon = iconFor(group.icon);
            return (
              <article key={group.label} className="sec-datacard">
                <h3>
                  <span className="sec-datacard__icon" aria-hidden="true">
                    <Icon size={17} strokeWidth={1.6} />
                  </span>
                  {group.label}
                </h3>
                <ul>
                  {group.points.map((point) => (
                    <li key={point}>{point}</li>
                  ))}
                </ul>
              </article>
            );
          })}
        </Stagger>
      </Section>

      {/* ---- §10 + §11 · AI and human review ------------------------------------ */}
      <Section tone="dark" id="ai">
        <SectionHeading
          eyebrow="AI and human review"
          title={SECURITY_AI.title}
          lead={SECURITY_AI.lead}
          tone="dark"
        />

        <Reveal className="sec-ai">
          {/*
            The chain, as an ordered list because the order IS the control. Each
            step is tagged with who performs it, in words — the tint only ranks.
          */}
          <ol className="sec-chain">
            {SECURITY_AI.chain.map((link, index) => (
              <li key={link.label} className="sec-chain__step" data-by={link.by}>
                <span className="sec-chain__num" aria-hidden="true">
                  {index + 1}
                </span>
                <span className="sec-chain__label">{link.label}</span>
                <span className="sec-chain__note">{link.note}</span>
                <span className="sec-chain__by">{BY_LABEL[link.by]}</span>
              </li>
            ))}
          </ol>

          <ul className="sec-ai__bounds">
            {SECURITY_AI.bounds.map((bound) => (
              <li key={bound.label}>
                <h3>{bound.label}</h3>
                <p>{bound.body}</p>
              </li>
            ))}
          </ul>

          <p className="sec-ai__note">{SECURITY_AI.note}</p>
        </Reveal>
      </Section>

      {/* ---- §15 · Auditability --------------------------------------------------- */}
      <Section tone="light" id="audit">
        <SectionHeading
          eyebrow="Auditability"
          title={SECURITY_AUDIT.title}
          lead={SECURITY_AUDIT.lead}
        />

        <Reveal className="sec-audit">
          <dl className="sec-audit__record">
            {SECURITY_AUDIT.record.map((row) => (
              <div key={row.label}>
                <dt>{row.label}</dt>
                <dd>{row.value}</dd>
              </div>
            ))}
          </dl>

          <ul className="sec-audit__points">
            {SECURITY_AUDIT.points.map((point) => (
              <li key={point}>{point}</li>
            ))}
          </ul>

          <p className="sec-audit__note">{SECURITY_AUDIT.note}</p>
        </Reveal>
      </Section>

      {/* ---- §16 · Privacy --------------------------------------------------------- */}
      <Section tone="light" flush id="privacy">
        <SectionHeading
          eyebrow="Privacy"
          title={SECURITY_PRIVACY.title}
          lead={SECURITY_PRIVACY.lead}
        />

        <Stagger as="ul" className="sec-privacy" max={3}>
          {SECURITY_PRIVACY.points.map((point) => (
            <article key={point.label} className="sec-privacycard">
              <h3>{point.label}</h3>
              <p>{point.body}</p>
            </article>
          ))}
        </Stagger>

        <Reveal>
          <p className="sec-privacy__note">{SECURITY_PRIVACY.note}</p>
        </Reveal>
      </Section>

      {/* ---- §17 · Principles ------------------------------------------------------- */}
      <Section tone="dark" id="principles">
        <SectionHeading
          eyebrow="Principles"
          title="Six things this product does."
          lead="Each one restates a mechanism described above, so no principle here can be true on this page and unsupported further up it."
          tone="dark"
        />

        <Stagger as="ul" className="sec-principles" max={6}>
          {SECURITY_PRINCIPLES.map((principle) => {
            const Icon = iconFor(principle.icon);
            return (
              <article key={principle.title} className="sec-principle">
                <span className="sec-principle__icon" aria-hidden="true">
                  <Icon size={18} strokeWidth={1.6} />
                </span>
                <h3>{principle.title}</h3>
                <p>{principle.body}</p>
              </article>
            );
          })}
        </Stagger>
      </Section>

      {/* ---- §18, §19, §20 · What is not here ---------------------------------------- */}
      <Section tone="light" id="status">
        <SectionHeading
          eyebrow="Status"
          title={SECURITY_STATUS.title}
          lead={SECURITY_STATUS.lead}
        />

        <Stagger as="ul" className="sec-absent" max={6}>
          {SECURITY_STATUS.absent.map((item) => (
            <article key={item.label} className="sec-absentcard">
              <h3>{item.label}</h3>
              <p>{item.body}</p>
            </article>
          ))}
        </Stagger>

        {/*
          §20 — documentation, and every destination is a route this site
          actually serves. There is no docs site, no trust portal and no
          security questionnaire to link to, so none is implied.
        */}
        <Reveal className="sec-docs">
          <h3 className="sec-docs__title">{SECURITY_STATUS.docs.title}</h3>
          <ul className="sec-docs__list">
            {SECURITY_STATUS.docs.links.map((link) => (
              <li key={link.href}>
                <Link href={link.href}>
                  {link.label}
                  <ArrowRight size={15} aria-hidden="true" />
                </Link>
                <span>{link.note}</span>
              </li>
            ))}
          </ul>
        </Reveal>
      </Section>

      {/* ---- Close ------------------------------------------------------------------- */}
      <section className="mkt-band mkt-band--dark mkt-band--cta">
        <div className="mkt-shell sec-cta">
          <h2>See the workflow these controls are built around.</h2>
          <p className="mkt-bandlead">
            The walkthrough covers the whole flow, end to end, including where a
            person has to sign off.
          </p>

          <div className="sec-cta__buttons">
            <Link href="/how-it-works" className="mkt-btn mkt-btn--primary">
              Explore the platform
              <ArrowRight size={17} aria-hidden="true" />
            </Link>
            <Link href="/signup" className="mkt-btn mkt-btn--glass">
              Create an account
            </Link>
          </div>
        </div>
      </section>
    </>
  );
}

/** Who performs each step of the AI chain, in words rather than in colour. */
const BY_LABEL: Record<string, string> = {
  data: "Input",
  ai: "AI",
  code: "Code",
  human: "Person",
};
