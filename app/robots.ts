import type { MetadataRoute } from "next";
import { SITE_URL } from "@/lib/marketing/seo";

/**
 * robots.txt, generated rather than written by hand.
 *
 * WHAT IS DISALLOWED AND WHY. Everything under the application is behind
 * authentication and returns a redirect to /login for an anonymous crawler, so
 * none of it can be indexed anyway. Listing it is still worth doing: it stops
 * a crawler spending its budget discovering that, and it stops signed-in-state
 * URLs leaking into a site: search if the auth edge is ever misconfigured.
 *
 * THE CANDIDATE-FACING SIGNED LINKS ARE THE IMPORTANT ONES. /apply, /coding and
 * /unsubscribe are PUBLIC by design — a candidate has no login — and they are
 * addressed by an unguessable signed token. They must never be indexed: a
 * crawler that followed one would be opening somebody's application form, and a
 * search result for it would expose that the link exists.
 *
 * This is a crawl directive, not a security control. The tokens are what make
 * those routes safe; this only keeps them out of an index.
 */
export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: "*",
        allow: "/",
        disallow: [
          "/api/",
          // Candidate-facing, token-authorised, and never for an index.
          "/apply/",
          "/coding/",
          "/unsubscribe",
          // The application. Redirects anonymous callers anyway.
          "/dashboard",
          "/jobs",
          "/candidates",
          "/applications",
          "/pipeline",
          "/interviews",
          "/messages",
          "/clients",
          "/hires",
          "/analytics",
          "/audit-log",
          "/notifications",
          "/settings",
          "/team",
          "/onboarding",
          "/organizations",
          "/screening-calls",
          "/automations",
          // Auth surfaces. /login and /signup stay crawlable: they are real
          // entry points a search result should be able to land on.
          "/reset-password",
          "/forgot-password",
          "/invite",
        ],
      },
    ],
    sitemap: `${SITE_URL}/sitemap.xml`,
    host: SITE_URL,
  };
}
