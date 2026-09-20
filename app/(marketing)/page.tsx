import type { Metadata } from "next";
import { Hero } from "./_components/home/Hero";
import { Workspace } from "./_components/home/Workspace";
import { HiringWorkflow } from "./_components/home/HiringWorkflow";
import { AiFeatures } from "./_components/home/AiFeatures";
import { HumanAi } from "./_components/home/HumanAi";
import { PipelinePreview } from "./_components/home/PipelinePreview";
import { BrandStatement } from "./_components/home/BrandStatement";
import { TrustSection } from "./_components/home/TrustSection";
import { Faq } from "./_components/home/Faq";
import { FinalCta } from "./_components/home/FinalCta";

export const metadata: Metadata = {
  title: "Find the Right People Faster",
  description:
    "Scoreboad is an AI-powered recruitment platform that helps teams screen, " +
    "evaluate, interview, and manage candidates from one connected workspace.",
  alternates: { canonical: "/" },
  openGraph: {
    title: "Scoreboad — Find the Right People Faster",
    description:
      "Scoreboad is an AI-powered recruitment platform that helps teams screen, " +
      "evaluate, interview, and manage candidates from one connected workspace.",
    url: "/",
    siteName: "Scoreboad",
    type: "website",
  },
};

/**
 * The landing page.
 *
 * THE ORDER IS THE ARGUMENT, and it is a different argument from the page this
 * replaces. That one opened with what the system IS — module counts, table
 * counts, the AI safety model — which is what a developer reading a repository
 * wants. This one opens with what a hiring team GETS, and earns the right to
 * talk about architecture only after showing the product:
 *
 *   1. Hero + the product itself          what it is, and what it looks like
 *   2. One workspace                      the six things it covers
 *   3. From application to hire           how those six connect
 *   4. AI that handles the busy work      where the leverage is
 *   5. AI does the work, you decide       the objection, answered
 *   6. The pipeline at a glance           the product again, in use
 *   7. People x Intelligence x Opportunity  a beat
 *   8. Built for modern hiring teams      why trust it with candidate data
 *   9. FAQ                                the awkward questions
 *  10. Build your next team               the ask
 *
 * THE COLOUR RHYTHM IS DELIBERATE: three deep bands (hero, Human + AI, the
 * closing CTA) against seven bright ones. That lands near the 30/70 split the
 * brief asks for, and it is what makes the bright product sections read as
 * bright — brightness is a relationship, not a value.
 *
 * WHAT IS STILL DELIBERATELY MISSING. No logo wall, no testimonial, no "trusted
 * by 500 teams". This product has no customers to name yet, and inventing the
 * equivalent would be the one thing this codebase's rules forbid everywhere
 * else: telling somebody something untrue that they will act on. The honest
 * substitute is the badge in the hero saying where the product actually stands.
 *
 * The technical material the old page led with is not deleted — it moved into
 * the trust band, phrased as what it protects, with /how-it-works still
 * carrying the full detail.
 */
export default function HomePage() {
  return (
    <>
      <Hero />
      <Workspace />
      <HiringWorkflow />
      <AiFeatures />
      <HumanAi />
      <PipelinePreview />
      <BrandStatement />
      <TrustSection />
      <Faq />
      <FinalCta />
    </>
  );
}
