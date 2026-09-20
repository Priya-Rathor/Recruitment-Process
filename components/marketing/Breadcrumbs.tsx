import Link from "next/link";
import { breadcrumbJsonLd } from "@/lib/marketing/seo";

export type Crumb = { label: string; href: string };

/**
 * A breadcrumb trail, with its structured data.
 *
 * THE JSON-LD IS EMITTED HERE, BESIDE THE MARKUP, on purpose. Breadcrumb
 * structured data that disagrees with the visible trail is the most common way
 * a site earns a manual action for structured-data mismatch — and it happens
 * because the two are written in different files by different people. Built
 * from one array, they cannot disagree.
 *
 * The LAST crumb is the current page and is not a link: linking a page to
 * itself is a dead control, and `aria-current="page"` is what tells a screen
 * reader where it is.
 */
export function Breadcrumbs({ items }: { items: Crumb[] }) {
  if (items.length === 0) return null;

  return (
    <>
      <nav aria-label="Breadcrumb" className="mkt-crumbs">
        <ol>
          {items.map((item, index) => {
            const last = index === items.length - 1;
            return (
              <li key={item.href}>
                {last ? (
                  <span aria-current="page">{item.label}</span>
                ) : (
                  <Link href={item.href}>{item.label}</Link>
                )}
                {!last && (
                  <span className="mkt-crumbs__sep" aria-hidden="true">
                    /
                  </span>
                )}
              </li>
            );
          })}
        </ol>
      </nav>

      <script
        type="application/ld+json"
        // The content is built from the same `items` the trail renders, so
        // there is nothing user-supplied in it to escape.
        dangerouslySetInnerHTML={{ __html: JSON.stringify(breadcrumbJsonLd(items)) }}
      />
    </>
  );
}
