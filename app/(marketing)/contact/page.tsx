import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight } from "lucide-react";
import {
  CONTACT_CTA,
  CONTACT_HERO,
  CONTACT_NEXT,
  CONTACT_PRODUCT,
  CONTACT_TRUST,
} from "@/lib/marketing/contact";
import { buildMetadata } from "@/lib/marketing/seo";
import { Breadcrumbs } from "@/components/marketing/Breadcrumbs";
import { Section } from "@/components/marketing/Section";
import { SectionHeading } from "@/components/marketing/SectionHeading";
import { Reveal, Stagger } from "@/components/marketing/Reveal";
import { ContactOrb } from "../_components/contact/ContactOrb";
import { ContactForm } from "../_components/contact/ContactForm";

/**
 * §18 — built by the shared helper, like every other public page.
 *
 * THE DESCRIPTION DOES NOT SAY "talk to the team". §18's suggested wording
 * promises a conversation with somebody, and there is nobody staffing an inbox;
 * a meta description is the one line that gets quoted where none of the page's
 * caveats are visible, so it says what the page actually offers.
 */
export const metadata: Metadata = buildMetadata({
  title: "Contact — AI Recruitment Platform",
  description:
    "How to start with Scoreboad: open a free account and walk through " +
    "AI-powered candidate screening, interviews, evaluation and connected " +
    "hiring workflows. No card, and no demo booking to wait on.",
  path: "/contact",
});

/**
 * The Contact page.
 *
 * THE PAGE'S HONEST SHAPE, decided in §1's inspection and recorded in
 * lib/marketing/contact.ts: there is no contact backend, no booking system and
 * no published address anywhere in this project, and the tenant-scoped email
 * adapter cannot serve a visitor who has no organization. §4 says that where
 * signup is the real conversion path it is the primary action — it is, so it is.
 *
 * The form is built in full and never claims to send. Its notice sits above the
 * fields rather than after them.
 *
 * SERVER-RENDERED except <ContactForm>, which holds the field values.
 */
export default function ContactPage() {
  return (
    <>
      {/* ---- Hero + form (§6, §26: two columns on desktop) ----------------- */}
      <section
        className="mkt-band mkt-band--dark ct-hero"
        aria-labelledby="contact-heading"
      >
        <div className="mkt-shell">
          <Breadcrumbs
            items={[
              { label: "Home", href: "/" },
              { label: "Contact", href: "/contact" },
            ]}
          />

          <div className="ct-hero__grid">
            {/* ---- Left: the dark visual side --------------------------- */}
            <div className="ct-hero__copy">
              <h1 id="contact-heading" className="ct-hero__title">
                {CONTACT_HERO.title}
              </h1>
              <p className="ct-hero__lead">{CONTACT_HERO.lead}</p>

              {/*
                §4 — THE ONE PRIMARY ACTION, above the fold and above the form,
                because it is the thing that actually works. The secondary is a
                read rather than a second conversion.
              */}
              <div className="ct-hero__actions">
                <Link href={CONTACT_CTA.primary.href} className="mkt-btn mkt-btn--primary">
                  {CONTACT_CTA.primary.label}
                  <ArrowRight size={17} aria-hidden="true" />
                </Link>
                <Link href={CONTACT_CTA.secondary.href} className="mkt-btn mkt-btn--glass">
                  {CONTACT_CTA.secondary.label}
                </Link>
              </div>

              {/* The visual's text equivalent — a real list, not a caption. */}
              <ol className="ct-hero__flow">
                {CONTACT_HERO.flow.map((beat) => (
                  <li key={beat.label}>
                    <span className="ct-hero__flowlabel">{beat.label}</span>
                    <span className="ct-hero__flownote">{beat.note}</span>
                  </li>
                ))}
              </ol>

              <ContactOrb />
            </div>

            {/* ---- Right: the bright form surface ----------------------- */}
            <div className="ct-hero__form">
              <h2 className="ct-formhead">Tell us about your hiring</h2>
              <ContactForm />
            </div>
          </div>
        </div>
      </section>

      {/* ---- §14 · What happens next ---------------------------------------- */}
      <Section tone="light" id="next">
        <SectionHeading
          eyebrow="What happens next"
          title="Three steps, and you do all of them yourself."
          lead="This is the real sequence — there is no sales process in between, and nobody is waiting to schedule a call."
        />

        <Stagger as="ol" className="ct-next" max={3}>
          {CONTACT_NEXT.map((step) => (
            <div key={step.num} className="ct-step">
              <span className="ct-step__num" aria-hidden="true">
                {step.num}
              </span>
              <h3>{step.label}</h3>
              <p>{step.body}</p>
            </div>
          ))}
        </Stagger>
      </Section>

      {/* ---- §13 · Product context ------------------------------------------- */}
      <Section tone="light" flush id="product">
        <SectionHeading
          eyebrow="The product"
          title="What you would be evaluating."
          lead="Each of these is a page about one part of the workflow, rather than a second copy of the homepage."
        />

        <Stagger as="ul" className="ct-product" max={6}>
          {CONTACT_PRODUCT.map((item) => (
            <Link key={item.href} href={item.href} className="ct-productcard">
              <h3>
                {item.label}
                <ArrowRight size={15} aria-hidden="true" />
              </h3>
              <p>{item.note}</p>
            </Link>
          ))}
        </Stagger>
      </Section>

      {/* ---- §21 · Trust ------------------------------------------------------- */}
      <Section tone="dark" id="trust">
        <SectionHeading
          eyebrow="Before you start"
          title="Three things that are true today."
          lead="Each one is a mechanism described in full on the security page, not a claim written for this one."
          tone="dark"
        />

        <Reveal>
          <ul className="ct-trust">
            {CONTACT_TRUST.map((point) => (
              <li key={point}>{point}</li>
            ))}
          </ul>

          <p className="ct-trust__more">
            <Link href="/security">Read how access, isolation and AI review work</Link>
          </p>
        </Reveal>
      </Section>
    </>
  );
}
