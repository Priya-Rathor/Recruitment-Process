import Link from "next/link";
import { ArrowRight } from "lucide-react";
import {
  RESOURCES_COMING,
  RESOURCES_HEAD,
  RESOURCE_FEATURED,
  RESOURCE_GROUPS,
} from "@/lib/marketing/home";
import { Section } from "@/components/marketing/Section";
import { SectionHeading } from "@/components/marketing/SectionHeading";
import { ResourceCard } from "@/components/marketing/ResourceCard";
import { Reveal, Stagger } from "@/components/marketing/Reveal";
import { Logo } from "@/components/Logo";

/**
 * "Resources for better hiring."
 *
 * THE SITE HAS NO BLOG, NO GUIDES AND NO DOCS — §1's inspection found no
 * content directory, no CMS and ten public URLs. The easy move was an empty
 * state. This is the better one: the site DOES have real reading material, it
 * is simply not in a blog. A fifteen-stage walkthrough, six capability pages,
 * the AI safety model and a FAQ that answers the unflattering questions are
 * all published and all crawlable.
 *
 * So the section indexes what exists and names what does not — the "coming"
 * line carries no links at all, because a route that does not exist does not
 * get one, and a greyed-out card still invites the click.
 *
 * NO FILTER. §7 allows one "if enough real resources exist"; nine items across
 * three groups is enough to justify headings and not enough to justify a
 * control. Headings are better for a crawler anyway, and the section stays
 * entirely server-rendered — which is what §9 means by lighter than the
 * storytelling bands.
 *
 * A DEEP BAND, for §6's dark editorial surface, and because it sits between
 * two light ones.
 */
export function Resources() {
  return (
    <Section tone="dark" id="resources">
      <SectionHeading
        eyebrow={RESOURCES_HEAD.eyebrow}
        title={RESOURCES_HEAD.title}
        lead={RESOURCES_HEAD.lead}
        tone="dark"
      />

      {/* ---- The featured resource ------------------------------------- */}
      <Reveal>
        <Link href={RESOURCE_FEATURED.href} className="rs-hero">
          {/*
            The brand mark as the editorial visual — no stock photography and
            no generated illustration, which §6 rules out and which this site
            has avoided throughout. It is `aria-hidden` because the card's
            accessible name is its title.
          */}
          <span className="rs-hero__art" aria-hidden="true">
            <span className="rs-hero__glow" />
            <Logo variant="mark" height={56} />
          </span>

          <span className="rs-hero__body">
            <span className="rs-hero__kind">{RESOURCE_FEATURED.kind}</span>
            <span className="rs-hero__title">{RESOURCE_FEATURED.title}</span>
            <span className="rs-hero__desc">{RESOURCE_FEATURED.description}</span>
            <span className="rs-hero__meta">
              {/*
                A real fact about the page — fifteen stages — rather than an
                invented reading time. §5 bans fabricated dates, reading times
                and authors; the honest substitute is something countable.
              */}
              {RESOURCE_FEATURED.meta}
            </span>
            <span className="rs-hero__more" aria-hidden="true">
              Take the tour
              <ArrowRight size={16} />
            </span>
          </span>
        </Link>
      </Reveal>

      {/* ---- The groups -------------------------------------------------- */}
      {RESOURCE_GROUPS.map((group) => (
        <section key={group.heading} className="rs-group">
          <div className="rs-group__head">
            <h3 className="rs-group__title">{group.heading}</h3>
            <p className="rs-group__note">{group.note}</p>
          </div>

          <Stagger as="ul" className="rs-grid" max={3}>
            {group.items.map((item) => (
              <ResourceCard key={item.href} resource={item} />
            ))}
          </Stagger>
        </section>
      ))}

      {/*
        WHAT DOES NOT EXIST YET, as a sentence with no links in it.

        Naming the gap is not a weakness here: a reader who came looking for a
        blog finds out in one line instead of hunting, and the site has been
        this direct about its limits everywhere else.
      */}
      <p className="rs-coming">
        Still to come: {RESOURCES_COMING.join(", ")}. None of them exist yet, so
        none of them are linked.
      </p>
    </Section>
  );
}
