import Link from "next/link";
import { ArrowRight } from "lucide-react";
import type { Resource } from "@/lib/marketing/home";

// =============================================================================
// A RESOURCE CARD.
//
// IN components/marketing/ RATHER THAN THE HOME FOLDER, because §21 asks for
// components a blog can reuse and this is the one that qualifies: it takes a
// title, a description, a category and an href, and knows nothing about the
// homepage. A /blog index or a /resources page can render the same card over
// article front-matter the day either exists.
//
// A SERVER COMPONENT, and a plain <a>. It navigates, so it is a link — which
// is also what makes it work with middle-click, with a keyboard, and in a
// screen reader's link list.
//
// THE WHOLE CARD IS THE LINK, and the accessible name is the title rather
// than the trailing "Read" — `aria-hidden` on that flourish is what stops a
// screen reader announcing five links all called "Read".
// =============================================================================

export function ResourceCard({ resource }: { resource: Resource }) {
  return (
    <article className="rs-card">
      <Link href={resource.href} className="rs-card__link">
        <span className="rs-card__kind">{resource.kind}</span>
        {/*
          h4 because these sit under a category h3, which sits under the
          section's h2. The outline never skips a level.
        */}
        <h4 className="rs-card__title">{resource.title}</h4>
        <p className="rs-card__desc">{resource.description}</p>
        <span className="rs-card__more" aria-hidden="true">
          Read
          <ArrowRight size={14} />
        </span>
      </Link>
    </article>
  );
}
