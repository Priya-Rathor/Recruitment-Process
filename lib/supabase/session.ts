import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { requireSupabaseConfig } from "./env";

/**
 * Routes reachable without a session. Everything else requires authentication.
 * Deny-by-default: a new module's routes are protected the moment they exist,
 * without anyone remembering to add them here.
 */
const PUBLIC_PATHS = [
  "/login",
  "/signup",
  "/forgot-password",
  "/reset-password",
  "/invite",
  /**
   * Module 15's unsubscribe page.
   *
   * A CANDIDATE IS NOT A USER OF THIS PRODUCT. They have no login, so an
   * unsubscribe link that required a session would be a link nobody who receives
   * it can use — and an automated recruitment email whose unsubscribe does not work
   * is exactly what CAN-SPAM and PECR forbid.
   *
   * The page is authorised by its own signed token instead (an HMAC over the
   * candidate id and channel; see lib/communications/optout.ts), so it can only opt
   * ONE candidate out of ONE channel, cannot be pointed at anybody else by editing
   * the id, and cannot re-subscribe anyone.
   */
  "/unsubscribe",
  /**
   * Module 20's live coding round.
   *
   * SAME REASONING AS /unsubscribe, one step further. A candidate has no login,
   * so a coding page behind a session would be a page the person it was built
   * for cannot open — they scanned a QR code on a Google Meet screen share with
   * their phone, and that phone has never seen this product.
   *
   * The page authorises itself with its own signed token instead (an HMAC over
   * the coding session id; see lib/coding/token.ts), so it can only ever open
   * ONE session, cannot be pointed at another by editing the URL, and stops
   * working the moment an interviewer cancels the round. The URL carries no
   * candidate, application, interview or organization id.
   */
  "/coding",
  /**
   * Module 23's public job application form.
   *
   * SAME REASONING AGAIN, and this one is the widest of the three: the page is
   * opened by somebody who has never had any relationship with this product at
   * all — they were sent a link on WhatsApp or scanned a QR code on a poster.
   * A login would make applying for the job impossible.
   *
   * Authorised by its own signed token (an HMAC over the form id AND the form's
   * current token_version; see lib/forms/token.ts), so it can only ever open ONE
   * form, cannot be pointed at another by editing the URL, stops working the
   * moment the form is disabled or the link is regenerated, and carries no
   * organization, job or candidate id.
   *
   * CHECK THE NEAR MISS BEFORE TOUCHING THIS ENTRY. matches() frees the entry
   * and everything beneath it: "/apply" does NOT free "/applications" (the
   * internal pipeline list), because that string neither equals "/apply" nor
   * begins with "/apply/". An entry of "/app" would publish the entire product.
   * publicPaths.test.ts pins both.
   */
  "/apply",
  /**
   * Module 21's public product website.
   *
   * THIS IS THE FIRST ENTRY THAT IS PUBLIC BECAUSE IT IS MARKETING, not because
   * a candidate holds a signed token. Everything above is a page one specific
   * person was sent a link to; these are pages anybody may read, including
   * search engine crawlers.
   *
   * WHY "/" IS SAFE TO LIST HERE. matches() below treats an entry as "this exact
   * path, or anything beneath it", and for "/" the second half compiles to
   * startsWith("//") — which no normalised pathname satisfies. So "/" grants the
   * landing page and nothing else. It does NOT open the whole app, which is the
   * one thing a reader of this list will worry about.
   *
   * "/product" and "/how-it-works" ARE prefix entries, so they free everything
   * beneath them. That is intended — /product/source, /product/screen and the
   * rest are all public — and it is safe only because no private route begins
   * with either string. Before adding a route to this block, check that: an
   * entry of "/job" here would silently publish /jobs.
   */
  "/",
  "/product",
  "/how-it-works",
  /*
    The About page. Deny-by-default caught this one too: the route rendered
    perfectly and every anonymous visitor got a 307 to /login, which is the
    same bug the crawler files had below and just as invisible from the code.

    THE NEAR MISS, checked as the block above demands: no private route begins
    with "/about", so freeing the subtree frees nothing else. publicPaths.test
    pins that.
  */
  "/about",
  /*
    The Security page. Same reasoning and the same near-miss check as /about:
    no private route begins with "/security" — the in-product screen is
    /settings/security, which does not share this prefix. publicPaths.test
    pins both directions.
  */
  "/security",
  /*
    The Contact page. Near miss checked as this block requires: no private
    route begins with "/contact" — there is no /contacts list in this product,
    and if one is ever added this entry has to be revisited before it ships.
  */
  "/contact",
  /*
    THE CRAWLER FILES, and they were a REAL BUG rather than a precaution.

    `app/robots.ts` and `app/sitemap.ts` generate /robots.txt and /sitemap.xml,
    and both are routes like any other — so deny-by-default caught them and
    served Googlebot a 307 to /login. Neither file was readable by anything
    that was not signed in, which is every crawler there is. Verified by
    `curl /robots.txt` returning the login redirect.

    The proxy matcher excludes favicon.ico and image extensions, but not .txt
    or .xml, so the exclusion had to be here.

    SAFE AS PREFIX ENTRIES because matches() frees an entry and anything
    beneath it: "/robots.txt" frees exactly "/robots.txt" and a "/robots.txt/…"
    subtree that does not exist. Neither string is a prefix of a private route —
    publicPaths.test.ts pins that.
  */
  "/robots.txt",
  "/sitemap.xml",
];

/**
 * An entry matches its own path, or any path beneath it.
 *
 * The `${p}/` form is what stops "/invite" from also matching "/invitees", so
 * an entry can only ever free a real subtree. publicPaths.test.ts pins this,
 * including the "/" case and the near-miss names of real private routes.
 */
function matches(pathname: string, paths: string[]) {
  return paths.some((p) => pathname === p || pathname.startsWith(`${p}/`));
}

/**
 * Is this path reachable without a session?
 *
 * EXPORTED SO IT CAN BE TESTED. The allowlist stopped being a convenience list
 * the moment a marketing site was added to it — a wrong entry here does not
 * break a page, it publishes one. updateSession() calls this rather than
 * matches() directly, so the test exercises the same code path the edge does
 * instead of a copy of the rule that could drift from it.
 */
export function isPublicPath(pathname: string) {
  return matches(pathname, PUBLIC_PATHS);
}

/**
 * Refreshes the Supabase auth session on every request AND enforces
 * authentication at the edge. Called from proxy.ts (Next 16's replacement for
 * the middleware convention). Tenant/role authorization itself lives in
 * lib/tenant.ts + RLS — this only answers "is there a session?".
 */
export async function updateSession(request: NextRequest) {
  let supabaseResponse = NextResponse.next({ request });

  const { url, key } = requireSupabaseConfig();

  const supabase = createServerClient(
    url,
    key,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
          supabaseResponse = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(name, value, options)
          );
        },
      },
    }
  );

  // Do not remove — this refreshes the token and must run before any
  // Server Component reads the session.
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { pathname } = request.nextUrl;

  // API routes authenticate themselves and must return JSON 401s, not HTML
  // redirects — let them through to their own requireCurrentUser() checks.
  if (pathname.startsWith("/api/") || pathname.startsWith("/auth/")) {
    return supabaseResponse;
  }

  const isPublic = isPublicPath(pathname);

  if (!user && !isPublic) {
    const loginUrl = request.nextUrl.clone();
    loginUrl.pathname = "/login";
    loginUrl.search = "";
    // Preserve where they were headed so login can send them back.
    if (pathname !== "/") loginUrl.searchParams.set("next", pathname);
    return NextResponse.redirect(loginUrl);
  }

  if (user && (pathname === "/login" || pathname === "/signup")) {
    const homeUrl = request.nextUrl.clone();
    homeUrl.pathname = "/dashboard";
    homeUrl.search = "";
    return NextResponse.redirect(homeUrl);
  }

  // Note: "signed in but has no organization yet -> /onboarding" is handled by
  // requireMembershipOrRedirect() in the pages, NOT here. Next's own guidance
  // is that proxy should stay an optimistic check and not do data fetching —
  // that test needs a database round trip, so it belongs in the page layer.
  return supabaseResponse;
}
