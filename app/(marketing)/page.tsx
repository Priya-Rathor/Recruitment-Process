import type { Metadata } from "next";
import {
  SITE_DESCRIPTION,
  SITE_TITLE,
  buildMetadata,
  faqJsonLd,
  organizationJsonLd,
  softwareJsonLd,
} from "@/lib/marketing/seo";
import { HOME_FAQS } from "@/lib/marketing/home";
import { Hero } from "./_components/home/Hero";
import { Problem } from "./_components/home/Problem";
import { Solution } from "./_components/home/Solution";
import { PlatformOverview } from "./_components/home/PlatformOverview";
import { HiringWorkflow } from "./_components/home/HiringWorkflow";
import { AiFeatures } from "./_components/home/AiFeatures";
import { VoiceInterview } from "./_components/home/VoiceInterview";
import { HumanAi } from "./_components/home/HumanAi";
import { CandidateWorkspace } from "./_components/home/CandidateWorkspace";
import { HiringPipeline } from "./_components/home/HiringPipeline";
import { CandidateApplications } from "./_components/home/CandidateApplications";
import { RecruitmentAutomation } from "./_components/home/RecruitmentAutomation";
import { Integrations } from "./_components/home/Integrations";
import { Analytics } from "./_components/home/Analytics";
import { BrandStatement } from "./_components/home/BrandStatement";
import { TrustSection } from "./_components/home/TrustSection";
import { Faq } from "./_components/home/Faq";
import { FinalCta } from "./_components/home/FinalCta";

/*
  ABSOLUTE title, so this one page escapes the "%s · Scoreboad" template, which
  would put the brand last on the page where it should be first.

  IT IS SITE_TITLE, NOT A SECOND STRING WRITTEN HERE. This page was overriding
  the title with "Scoreboad — Find the Right People Faster" — the H1 reused as
  a title tag. That is a worse title for the one page that has to rank for the
  category: it repeats the headline a searcher can already see in the snippet
  and never says what the product IS. The canonical title lives in
  lib/marketing/seo.ts and every other page's brand suffix already comes from
  the same constant, so there is exactly one place to change it.

  Everything else comes from the shared helper, so the canonical, the Open
  Graph block and the Twitter card are built the same way as every other public
  page rather than by hand here.
*/
export const metadata: Metadata = {
  ...buildMetadata({
    title: "AI-Powered Recruitment Platform",
    description: SITE_DESCRIPTION,
    path: "/",
  }),
  title: { absolute: SITE_TITLE },
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
 *   2. The challenge                      what goes wrong without it
 *   3. The solution                       the same pieces, connected
 *   4. The Scoreboad platform             the six things it covers, as screens
 *   5. From application to hire           how those six connect
 *   6. AI-powered recruitment             how screening actually works
 *   7. AI screening calls                 the first conversation, demonstrated
 *   8. AI does the work, you decide       the objection, answered
 *   9. Candidate workspace                one candidate, six real views
 *  10. Hiring pipeline                    a board one candidate crosses
 *  11. Candidate applications             how a candidate gets in at all
 *  12. Recruitment automation             one rule, running, with a gate
 *  13. Integrations                       five connections, each one off by default
 *  14. Analytics                          the product's own charts, on the marketing page
 *  15. People x Intelligence x Opportunity  a beat
 *  16. Built for modern hiring teams      why trust it with candidate data
 *  17. FAQ                                the awkward questions
 *  18. Build your next team               the ask
 *
 * STEPS 2 AND 3 WERE THE MISSING FIRST HALF OF THE ARGUMENT. The page used to
 * open with the hero's promise and go straight to a list of capabilities — the
 * answer to a question it had never asked. The challenge band asks it.
 *
 * STEP 4 USED TO BE THAT LIST OF CAPABILITIES — six cards, each an icon, a
 * heading and a paragraph. It is now six views of one product frame, with the
 * same six pieces of copy as captions. Nothing was cut; the grid that showed
 * nothing became the screen that shows it.
 *
 * THE COLOUR RHYTHM IS DELIBERATE: six deep bands (hero, the solution, the
 * screening call, Human + AI, the pipeline, the closing CTA) against seven
 * bright ones.
 * The screening-call band and Human + AI are adjacent AND both deep, which is
 * intended: the call story ends on a recruiter reading the report, and Human +
 * AI is the argument for why it ends there. They read as one movement. That holds the 30/70 split,
 * and it is what makes the bright product sections read as bright — brightness
 * is a relationship, not a value.
 *
 * The solution band is deep on purpose rather than for rhythm: the challenge
 * band above it is the pale, ordinary ground where the scattered pieces sit,
 * and the turn into brand navy IS the transformation the section is describing.
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
      {/*
        STRUCTURED DATA, and every block describes something this page actually
        renders.

        The FAQ block is built from HOME_FAQS — the same array the FAQ section
        below displays — so the markup and the page cannot disagree. Structured
        data claiming questions a visitor cannot see is what a manual action is
        issued for, and it happens because the two are usually written in
        different files.

        No `offers` and no `aggregateRating`: pricing is not published and there
        are no reviews. Both can be added the day those things are true.
      */}
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          __html: JSON.stringify([
            organizationJsonLd(),
            softwareJsonLd(),
            faqJsonLd(HOME_FAQS),
          ]),
        }}
      />

      <Hero />
      <Problem />
      <Solution />
      <PlatformOverview />
      <HiringWorkflow />
      <AiFeatures />
      <VoiceInterview />
      <HumanAi />
      <CandidateWorkspace />
      <HiringPipeline />
      <CandidateApplications />
      <RecruitmentAutomation />
      <Integrations />
      <Analytics />
      <BrandStatement />
      <TrustSection />
      <Faq />
      <FinalCta />
    </>
  );
}
