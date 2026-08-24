import { describe, expect, it } from "vitest";
import { isPublicPath } from "./session";

/**
 * The public path allowlist is a SECURITY BOUNDARY, and this file is the thing
 * that keeps it one.
 *
 * Module 21 added a marketing site to a list that until then held only pages a
 * specific person had been sent a signed link to. That changed the cost of a
 * mistake: a wrong entry no longer breaks a page, it publishes one. The failure
 * mode is silent — the app still builds, the tests still pass, and a private
 * route is simply readable by anybody who guesses the URL.
 *
 * So the assertions below come in two halves, and the second half is the one
 * that matters:
 *
 *   1. every intended public path is reachable while anonymous
 *   2. every private route in the app is NOT — enumerated explicitly, including
 *      the names that sit one character away from a public prefix
 */
describe("isPublicPath", () => {
  // ---------------------------------------------------------------------------
  // 1. What must be public.
  // ---------------------------------------------------------------------------
  describe("public routes", () => {
    const auth = ["/login", "/signup", "/forgot-password", "/reset-password", "/invite"];
    const tokenAuthorised = ["/unsubscribe", "/coding", "/apply"];
    const marketing = [
      "/",
      "/how-it-works",
      "/product",
      "/product/source",
      "/product/understand",
      "/product/screen",
      "/product/decide",
      "/product/close",
      "/product/operate",
    ];

    it.each([...auth, ...tokenAuthorised, ...marketing])("allows %s", (path) => {
      expect(isPublicPath(path)).toBe(true);
    });

    it("allows the token-bearing sub-paths a candidate is actually sent", () => {
      // These carry an HMAC in the path, so the prefix has to free the subtree.
      expect(isPublicPath("/coding/abc123")).toBe(true);
      expect(isPublicPath("/unsubscribe/some-token")).toBe(true);
      expect(isPublicPath("/invite/token-value")).toBe(true);
      expect(isPublicPath("/apply/eyJhbGciOi.signature")).toBe(true);
    });
  });

  // ---------------------------------------------------------------------------
  // 2. What must stay private. This list is the regression guard: if somebody
  //    adds a careless allowlist entry, one of these flips and the build fails.
  // ---------------------------------------------------------------------------
  describe("private routes stay private", () => {
    // Every non-public directory in app/, as of Module 21.
    const privateRoutes = [
      "/dashboard",
      "/jobs",
      "/candidates",
      "/applications",
      "/pipeline",
      "/interviews",
      "/analytics",
      "/settings",
      "/team",
      "/clients",
      "/automations",
      "/notifications",
      "/audit-log",
      "/hires",
      "/onboarding",
      "/organizations",
      "/screening-calls",
      "/coding-sessions",
    ];

    it.each(privateRoutes)("denies %s", (path) => {
      expect(isPublicPath(path)).toBe(false);
    });

    it.each(privateRoutes)("denies a nested path under %s", (path) => {
      expect(isPublicPath(`${path}/some-id`)).toBe(false);
    });
  });

  // ---------------------------------------------------------------------------
  // 3. Over-matching. This is the trap the whole file exists for.
  // ---------------------------------------------------------------------------
  describe("prefix entries cannot be extended into a private route", () => {
    it('"/" frees the landing page ONLY, not the entire app', () => {
      // The subtle one. An entry of "/" looks like it should match everything,
      // because every path starts with a slash. It does not: the prefix arm
      // compiles to startsWith("//"), which no normalised pathname satisfies.
      // If someone "simplifies" matches() and drops the trailing slash, this
      // assertion is what catches it — and what it catches is the whole
      // application becoming publicly readable.
      expect(isPublicPath("/")).toBe(true);
      expect(isPublicPath("/dashboard")).toBe(false);
      expect(isPublicPath("/candidates/123")).toBe(false);
    });

    it("does not free a private route that merely shares a public prefix", () => {
      // /coding is public; /coding-sessions is an internal review surface.
      // A naive startsWith without the "/" would publish it.
      expect(isPublicPath("/coding-sessions")).toBe(false);
      expect(isPublicPath("/coding-sessions/42")).toBe(false);

      /*
        THE WORST NEAR MISS IN THE LIST. Module 23 added "/apply", and
        "/applications" is the internal pipeline — every candidate the
        organization is considering, with names, salaries and stage history.

        It stays private because "/applications" is not equal to "/apply" and
        does not start with "/apply/". Shortening the entry to "/app", or
        dropping the trailing slash from matches(), publishes it. This is the
        assertion that catches either.
      */
      expect(isPublicPath("/applications")).toBe(false);
      expect(isPublicPath("/applications/8f3a")).toBe(false);
      expect(isPublicPath("/applyx")).toBe(false);
    });

    it("does not free near-miss names of the marketing prefixes", () => {
      // If /product were ever shortened toward "/produc" or a route named
      // /products appeared, these are the guards.
      expect(isPublicPath("/production")).toBe(false);
      expect(isPublicPath("/how-it-works-internal")).toBe(false);
    });

    it("cannot be escaped by appending a segment to a public leaf", () => {
      // /login is exact-or-subtree; nothing private hides under it, but a
      // future /login/admin would be caught by review, not by accident.
      expect(isPublicPath("/loginx")).toBe(false);
      expect(isPublicPath("/signupx")).toBe(false);
    });

    it("is case sensitive, matching the URL paths Next actually routes", () => {
      // Worth pinning: a case-insensitive match would be a second way to
      // address every public page, which splits SEO and confuses caching.
      expect(isPublicPath("/Dashboard")).toBe(false);
      expect(isPublicPath("/PRODUCT/source")).toBe(false);
    });
  });
});
