import type { Metadata } from "next";
import { PRIVACY_DOC } from "@/lib/marketing/legal";
import { buildMetadata } from "@/lib/marketing/seo";
import { LegalDocument } from "../_components/legal/LegalDocument";

/**
 * §22 and §23 — its own canonical, built by the shared helper like every other
 * public page. The description summarises the document and carries no marketing
 * language: a legal page that reaches for keywords is the one kind of page
 * where doing so actively costs trust.
 */
export const metadata: Metadata = buildMetadata({
  title: "Privacy Policy",
  description:
    "How Scoreboad handles candidate and account information: what " +
    "is collected, how AI processes it, who else it reaches, how " +
    "long it is kept, and what is not in place yet.",
  path: "/privacy",
});

/**
 * All three legal routes render through <LegalDocument>; the content lives in
 * lib/marketing/legal.ts, whose header records what was verified and what is
 * still an open placeholder.
 */
export default function PrivacyPage() {
  return <LegalDocument doc={PRIVACY_DOC} />;
}
