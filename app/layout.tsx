import type { Metadata } from "next";
import { Inter, Bricolage_Grotesque } from "next/font/google";
import "./globals.scss";

/**
 * TWO typefaces, on purpose.
 *
 * The UI audit found a single family (Inter) used for page headings, table
 * cells, buttons and captions alike. That uniformity is what makes an interface
 * read as scaffolded rather than designed — nothing in the type itself tells
 * the eye what is a heading and what is data.
 *
 * Bricolage Grotesque carries the headings: a grotesk with enough character to
 * be recognisable at 22-32px, and tight enough at display sizes to hold a page
 * title. Inter keeps everything a user reads closely — body text, table cells,
 * form labels, numbers — because it was drawn for exactly that and stays
 * legible at 12-13px where a display face would not.
 *
 * Both are variable fonts loaded through next/font, so they are self-hosted and
 * subset at build time. No layout shift, no third-party request.
 */
const inter = Inter({
  variable: "--font-inter",
  subsets: ["latin"],
  display: "swap",
});

const display = Bricolage_Grotesque({
  variable: "--font-display",
  subsets: ["latin"],
  display: "swap",
  weight: ["600", "700"],
});

export const metadata: Metadata = {
  // A template, so every page appends the product name instead of each one
  // spelling it out. The 20-odd pages that hardcoded "· Recruitment OS" have
  // been renamed, but new pages now only need their own title.
  title: {
    default: "MyRecruiter Partner — Your AI Hiring Manager",
    template: "%s · MyRecruiter Partner",
  },
  description: "Your AI hiring manager: sourcing, screening and scheduling in one workspace.",
  // app/icon.png and app/apple-icon.png are picked up automatically by the App
  // Router; declared here only so the manifest name matches the brand.
  applicationName: "MyRecruiter Partner",
};

// Explicit props type rather than Next's generated `LayoutProps` global, so
// `tsc --noEmit` typechecks without first running a build to emit .next/types.
export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${inter.variable} ${display.variable}`}>
      <body>{children}</body>
    </html>
  );
}
