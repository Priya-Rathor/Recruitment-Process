import type { Metadata, Viewport } from "next";
import { Space_Grotesk, Plus_Jakarta_Sans } from "next/font/google";
import "./globals.scss";

/**
 * TWO typefaces — FUTURE WORKFORCE.
 *
 * A FULL REPLACEMENT. Inter and Bricolage Grotesque are gone, and neither is
 * kept as a fallback: leaving Inter in the stack is exactly the leftover a theme
 * replacement is meant to eliminate, and on any machine with Inter installed it
 * would silently keep rendering the retired theme's body text.
 *
 * SPACE GROTESK carries the headings — a geometric grotesk with enough character
 * to hold a page title at 23-30px and the slightly technical cast the theme
 * asks for.
 *
 * PLUS JAKARTA SANS carries body text, AND THAT IS A SUBSTITUTION worth naming
 * rather than burying. The brief asked for Aeonik, which is a commercial licence
 * — next/font cannot fetch it and self-hosting it needs licensed files this
 * repository does not have. Plus Jakarta Sans is the closest licensable
 * neo-grotesque: the same geometric skeleton, comparable aperture, a touch
 * warmer. If real Aeonik is licensed later, it is a one-line change here plus
 * `localFont` pointing at the files — nothing downstream knows the difference,
 * because everything reads --font-body.
 *
 * Both are variable fonts through next/font, so they stay self-hosted and
 * subset at build time: no layout shift, no third-party request.
 */
const jakarta = Plus_Jakarta_Sans({
  variable: "--font-jakarta",
  subsets: ["latin"],
  display: "swap",
});

const grotesk = Space_Grotesk({
  variable: "--font-grotesk",
  subsets: ["latin"],
  display: "swap",
  weight: ["500", "600", "700"],
});

export const metadata: Metadata = {
  // A template, so every page appends the product name instead of each one
  // spelling it out. New pages only need their own title.
  title: {
    default: "Scoreboad — Smarter Hiring. Brighter Teams.",
    template: "%s · Scoreboad",
  },
  description:
    "Smarter hiring, brighter teams: AI-assisted sourcing, screening, interviews and " +
    "scheduling in one workspace.",
  /*
    THE FAVICON IS FILE-BASED, not declared here.

    app/icon.png (512x512) and app/apple-icon.png (180x180) are picked up
    automatically by the App Router's file conventions and emitted as
    <link rel="icon"> — which is why there is no `icons` key below and no
    app/favicon.ico. Adding either back would create a SECOND icon declaration,
    and whichever one the browser preferred would be the one nobody edited.

    `applicationName` is here only so an installed PWA's name matches the brand.
  */
  applicationName: "Scoreboad",
};

// DEEP SPACE, so the browser's OWN chrome takes the theme — the address bar on
// Android Chrome, the status bar on an installed PWA. Without it those surfaces
// render default light grey directly above a near-black page, which is the one
// piece of the frame the CSS tokens cannot reach and the most obvious way a
// dark theme looks unfinished.
//
// Two entries, because the theme has two modes: `media` picks the ground each
// mode actually uses. A single dark value would put a black bar above a light
// page for anyone whose OS is set to light.
//
// Exported as the static `viewport` object rather than via `generateViewport`
// (it depends on nothing in the request), and on `viewport` rather than
// `metadata` because that is where `themeColor` now lives.
export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#F7F8FF" },
    { media: "(prefers-color-scheme: dark)", color: "#0A1128" },
  ],
};

// Explicit props type rather than Next's generated `LayoutProps` global, so
// `tsc --noEmit` typechecks without first running a build to emit .next/types.
export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${jakarta.variable} ${grotesk.variable}`}>
      <body>{children}</body>
    </html>
  );
}
