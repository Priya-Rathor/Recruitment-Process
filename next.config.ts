import type { NextConfig } from "next";

/**
 * SECURITY HEADERS.
 *
 * This file was empty until the first deployment, which is the point at which
 * an empty one stops being harmless: every header below only matters once the
 * app is served over the public internet, and `docs/KNOWN_ISSUES.md` carried
 * "no security headers" as a P1 precisely because nothing here was set.
 *
 * WHAT IS DELIBERATELY NOT HERE: a Content-Security-Policy.
 *
 * A wrong CSP does not fail a build or a test — it breaks the running app in
 * production, silently, in whichever corner used the thing the policy forgot.
 * This product inlines styles throughout (the design system uses inline `style`
 * objects in almost every component), loads fonts through next/font, and runs a
 * CodeMirror editor. A policy strict enough to be worth having would need
 * `unsafe-inline` for styles, a nonce pipeline for scripts, and a pass over
 * every external origin — real work with a real test plan, not a line added on
 * the way to a deploy. It stays an open item rather than becoming a policy that
 * is either broken or so loose it is theatre.
 *
 * Each header below is one this app can adopt without behavioural risk, and the
 * reason it is safe is stated rather than assumed.
 */
const securityHeaders = [
  {
    /**
     * Nothing in this product renders inside a frame and nothing embeds it —
     * there is no `<iframe>` in app/ or components/, and no partner surface
     * that would need one. DENY is therefore free, and it closes clickjacking
     * on an authenticated app whose pages carry candidate phone numbers,
     * salary expectations and hiring decisions.
     *
     * Kept alongside the modern equivalent (`frame-ancestors`, which would live
     * in a CSP) because a meaningful share of traffic still comes from browsers
     * that honour this and not that.
     */
    key: "X-Frame-Options",
    value: "DENY",
  },
  {
    /**
     * Stops a browser second-guessing a Content-Type. This matters most on the
     * one route that returns a file it did not author: the QR image endpoints
     * and any signed-URL redirect to a candidate's uploaded CV. A sniffed
     * "image" that a browser decides is HTML executes in this origin.
     */
    key: "X-Content-Type-Options",
    value: "nosniff",
  },
  {
    /**
     * Send the full URL only to ourselves. Candidate-facing links are signed
     * tokens IN THE PATH — /apply/{token}, /coding/{token}, /unsubscribe?… —
     * and the default referrer policy would hand that token to every external
     * host the page links out to. The token is the credential, so leaking it in
     * a Referer header is leaking the authorisation itself.
     */
    key: "Referrer-Policy",
    value: "strict-origin-when-cross-origin",
  },
  {
    /**
     * Two years, subdomains included. Safe here because this app has no
     * plaintext HTTP surface to preserve — Vercel serves HTTPS and redirects
     * HTTP — and a session cookie is the thing being protected.
     *
     * `preload` is NOT set. Submitting to the preload list is effectively
     * irreversible for the apex domain and every subdomain under it, which is a
     * decision for whoever owns the domain rather than a default.
     */
    key: "Strict-Transport-Security",
    value: "max-age=63072000; includeSubDomains",
  },
  {
    /**
     * This product asks for no device permissions at all. Denying them
     * explicitly means a future dependency cannot quietly start asking, and
     * the browser refuses rather than prompting a recruiter mid-call.
     */
    key: "Permissions-Policy",
    value: "camera=(), microphone=(), geolocation=(), payment=(), usb=()",
  },
];

const nextConfig: NextConfig = {
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
  },
};

export default nextConfig;
