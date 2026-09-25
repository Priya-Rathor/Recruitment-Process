import { ImageResponse } from "next/og";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { SITE_DESCRIPTION, SITE_NAME } from "@/lib/marketing/seo";

/**
 * The social preview card, generated at build time.
 *
 * -----------------------------------------------------------------------------
 * WHY THIS EXISTS: EVERY SHARE WAS IMAGELESS
 * -----------------------------------------------------------------------------
 *
 * `buildMetadata()` has been emitting `twitter:card = summary_large_image`
 * since Module 03 — a card type whose whole purpose is a large image — while no
 * `og:image` was ever set anywhere on the site. Verified by crawling all
 * seventeen public routes: not one carried one. Every link to Scoreboad posted
 * anywhere rendered as a bare title and a line of grey text.
 *
 * -----------------------------------------------------------------------------
 * GENERATED, NOT DRAWN
 * -----------------------------------------------------------------------------
 *
 * There is no 1200x630 asset in this repository and no designer to make one —
 * the brand files are a 489x180 lockup, a 499x120 compact lockup and a 256x256
 * mark. §12 forbids inventing a URL for an asset that does not exist, so the
 * card is composed here from the mark that DOES exist plus the site's own
 * title and description constants.
 *
 * `next/og` ships inside Next; this adds no dependency. The route is statically
 * optimised — it uses no request-time API, so it is rendered once at build and
 * cached, not generated per request.
 *
 * ROOT SEGMENT, so it applies to every page. One card for the whole site is the
 * right call here rather than a per-page image: the pages differ in subject but
 * not in what a social preview needs to say, and a per-route generator would be
 * six more things to keep truthful.
 *
 * COLOURS ARE LITERALS, not tokens. This renders in a satori canvas with no
 * stylesheet — `var(--mkt-dark)` would resolve to nothing. They are the brand's
 * own values, and the one that matters is the ink on the accent: deep space,
 * never white.
 */

export const alt = `${SITE_NAME} — AI-powered recruitment platform`;
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default async function OpengraphImage() {
  /*
    The mark, inlined as a data URI. Read from disk at build time rather than
    fetched over HTTP: a generator that depends on its own site being up is a
    generator that fails exactly when a deployment is being created.
  */
  const mark = await readFile(join(process.cwd(), "public/brand/mark.png"));
  const markSrc = `data:image/png;base64,${mark.toString("base64")}`;

  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          padding: "72px 80px",
          background: "#0a1128",
          // The periwinkle aura, as a radial gradient rather than an image.
          backgroundImage:
            "radial-gradient(900px 500px at 78% 12%, rgba(139,158,255,0.30) 0%, rgba(139,158,255,0.07) 45%, rgba(10,17,40,0) 72%)",
          color: "#ffffff",
          fontFamily: "sans-serif",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 20 }}>
          {/*
            A plain <img>, not next/image: this renders in satori, which has no
            Next runtime and no image optimiser. `alt=""` because the wordmark
            beside it already names the brand, and an OG canvas has no
            accessibility tree in any case.
          */}
          <img src={markSrc} width={64} height={64} alt="" />
          <span style={{ fontSize: 34, fontWeight: 700, letterSpacing: "-0.02em" }}>
            {SITE_NAME}
          </span>
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>
          <span
            style={{
              fontSize: 64,
              fontWeight: 700,
              lineHeight: 1.1,
              letterSpacing: "-0.03em",
              maxWidth: 900,
            }}
          >
            AI-powered recruitment, connected in one workspace.
          </span>

          {/* #a6b1d9 on #0a1128 is 8.82:1 — the site's own muted ink. */}
          <span style={{ fontSize: 26, lineHeight: 1.45, color: "#a6b1d9", maxWidth: 860 }}>
            {SITE_DESCRIPTION}
          </span>
        </div>

        {/* The accent rule, echoing the site's periwinkle edge. */}
        <div style={{ display: "flex", width: 160, height: 6, background: "#8b9eff", borderRadius: 3 }} />
      </div>
    ),
    size
  );
}
