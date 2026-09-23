import Link from "next/link";
import { SECURITY_HEAD, SECURITY_NOTE, TRUST_CARDS } from "@/lib/marketing/home";
import { Section } from "@/components/marketing/Section";
import { SectionHeading } from "@/components/marketing/SectionHeading";
import { Card } from "@/components/marketing/Card";
import { Reveal, Stagger } from "@/components/marketing/Reveal";
import { SecurityArchitecture } from "./SecurityArchitecture";
import { iconFor } from "./icons";

/**
 * "Built with trust at every step of the hiring workflow."
 *
 * THIS BAND ALREADY EXISTED AS THE TRUST SECTION, and it already carried the
 * six verified guardrails — human review, candidate consent, database
 * isolation, the audit log, encrypted credentials, graceful degradation. Adding
 * a separate security section beside it would have put two versions of the same
 * argument on one page, which is the thing this rebuild has spent several
 * modules removing.
 *
 * So this is the same band, upgraded: the architecture that was only described
 * is now shown, the six cards stay exactly as they were, and the heading takes
 * the wording the brief specifies.
 *
 * WHERE THE TECHNICAL MATERIAL WENT, still true: the previous homepage led with
 * table counts and row-level security, written for a developer reading a
 * repository rather than a recruiter deciding whether to trust the product with
 * candidate data. It is here instead, phrased as what it protects.
 *
 * Mint icon wells rather than periwinkle, so the trust band reads as its own
 * idea at a glance instead of as a third identical grid.
 *
 * A SERVER COMPONENT; only <SecurityArchitecture> ships JavaScript.
 */
export function TrustSection() {
  return (
    <Section tone="light" id="trust">
      <SectionHeading
        eyebrow={SECURITY_HEAD.eyebrow}
        title={SECURITY_HEAD.title}
        lead={SECURITY_HEAD.lead}
      />

      <Reveal>
        <SecurityArchitecture />
      </Reveal>

      <Stagger as="ul" className="mkt-cardgrid sc-cards">
        {TRUST_CARDS.map((card) => (
          <Card key={card.title} icon={iconFor(card.icon)} title={card.title} accent="mint">
            <p>{card.body}</p>
          </Card>
        ))}
      </Stagger>

      {/*
        The honesty line, pointing at the FAQ rather than restating it — so the
        two answers about certification cannot drift apart. `#faq` is a real
        fragment on this page.
      */}
      <p className="sc-note">
        {SECURITY_NOTE}{" "}
        <Link href="/#faq" className="sc-note__link">
          Read the FAQ
        </Link>
      </p>
    </Section>
  );
}
