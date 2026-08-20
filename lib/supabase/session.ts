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
];

function matches(pathname: string, paths: string[]) {
  return paths.some((p) => pathname === p || pathname.startsWith(`${p}/`));
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

  const isPublic = matches(pathname, PUBLIC_PATHS);

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
