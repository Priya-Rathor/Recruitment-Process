import { USE_CASES_HEAD, USE_CASES_NOTE } from "@/lib/marketing/home";
import { Section } from "@/components/marketing/Section";
import { SectionHeading } from "@/components/marketing/SectionHeading";
import { Reveal } from "@/components/marketing/Reveal";
import { UseCases } from "./UseCases";

/**
 * "See Scoreboad in action across the hiring workflow."
 *
 * USE CASES, NOT CUSTOMER STORIES — because there are no customers. The
 * project's own spec says it: "no customer logos, no testimonials, no invented
 * pricing tiers and no security certifications". This section says the same
 * thing in the open rather than leaving a reader to wonder why the logo wall
 * is missing.
 *
 * WHERE IT SITS. Directly before the FAQ, which is the other place on this page
 * that answers a sceptical reader plainly. Somebody who has scrolled this far
 * is deciding whether the product fits them; this is the index that answers
 * that, and the FAQ is what they read next.
 *
 * A LIGHT BAND, flush with the trust band above it. Two light bands in a row
 * are one surface — the padding between them is the rhythm — and these two
 * belong together: what the product protects, then what it is for.
 *
 * A SERVER COMPONENT; only <UseCases> ships JavaScript.
 */
export function HiringUseCases() {
  return (
    <Section tone="light" flush id="use-cases">
      <SectionHeading
        eyebrow={USE_CASES_HEAD.eyebrow}
        title={USE_CASES_HEAD.title}
        lead={USE_CASES_HEAD.lead}
      />

      <Reveal>
        <UseCases />
      </Reveal>

      {/*
        The honest note where a logo wall would be. Not in small print: a young
        product saying so plainly is more credible than a row of invented marks,
        and this page has taken that line everywhere else.
      */}
      <p className="uc-note">{USE_CASES_NOTE}</p>
    </Section>
  );
}
