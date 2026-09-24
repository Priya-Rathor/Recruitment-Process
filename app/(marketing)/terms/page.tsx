import type { Metadata } from "next";
import { TERMS_DOC } from "@/lib/marketing/legal";
import { buildMetadata } from "@/lib/marketing/seo";
import { LegalDocument } from "../_components/legal/LegalDocument";

/**
 * §22 and §23 — its own canonical, built by the shared helper like every other
 * public page. The description summarises the document and carries no marketing
 * language: a legal page that reaches for keywords is the one kind of page
 * where doing so actively costs trust.
 */
export const metadata: Metadata = buildMetadata({
  title: "Terms of Service",
  description:
    "The terms on which Scoreboad is made available: accounts and " +
    "roles, acceptable use, candidate information, AI-generated " +
    "output, availability and fees.",
  path: "/terms",
});

/**
 * All three legal routes render through <LegalDocument>; the content lives in
 * lib/marketing/legal.ts, whose header records what was verified and what is
 * still an open placeholder.
 */
export default function TermsPage() {
  return <LegalDocument doc={TERMS_DOC} />;
}
