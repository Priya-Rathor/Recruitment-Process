// =============================================================================
// The FAQ.
//
// -----------------------------------------------------------------------------
// ONE CANONICAL FAQ, AND THE HOMEPAGE'S NINE ARE PART OF IT RATHER THAN A COPY
// -----------------------------------------------------------------------------
//
// The homepage has carried an FAQ section since Module 01, linked from the
// navigation, the footer and the trust section. This module does not replace it
// and does not restate it: the nine questions it renders are imported from
// HOME_FAQS and given a category and links here, so there is exactly one place
// each of those answers is written. Rewording one on the homepage rewords it
// here, and `faq.test.ts` fails if a question is renamed out from under its
// metadata.
//
// The remaining questions are new and exist only on /faq.
//
// -----------------------------------------------------------------------------
// WHAT IS NOT ANSWERED HERE, AND WHY THAT IS THE POINT
// -----------------------------------------------------------------------------
//
// Several obvious FAQ questions have no honest answer in this product, so they
// are asked and answered honestly rather than dropped:
//
//   * "Does Scoreboad do AI interviews?" — NO. It runs AI screening CALLS.
//     Module 07 established the distinction and the site has kept it since; an
//     FAQ is exactly where a visitor would expect the loose version.
//   * "Can I drag a candidate between stages?" — NO, deliberately.
//   * "Is there a free trial?" — there is no trial because there are no plans.
//   * "Can I talk to someone?" — there is no inbox. /contact says so too.
//   * Certification — none held.
//
// NO ANSWER CLAIMS ENCRYPTION AT REST OR IN TRANSIT. /security records why:
// Supabase and Vercel both provide and document it, but this project has
// verified neither, and the only cipher in our own source is the integration
// credential store. The security answers here stay inside that boundary.
// =============================================================================

import { HOME_FAQS } from "@/lib/marketing/home";

export type FaqCategoryKey =
  | "general"
  | "ai"
  | "candidates"
  | "interviews"
  | "workflow"
  | "security"
  | "pricing";

export type FaqLink = { label: string; href: string };

export type FaqItem = {
  /** Stable anchor, so a single answer can be linked to directly. */
  id: string;
  category: FaqCategoryKey;
  q: string;
  a: string;
  /**
   * A real product sequence, rendered as a small chain inside the open answer.
   *
   * ONLY REAL STAGES. Step 6 allows a miniature product visual and forbids
   * fabricating UI to get one, so this is deliberately not a picture of a
   * screen — it is the same sequence of named steps the rest of the site uses,
   * drawn as text. Nothing here implies a control that does not exist.
   */
  flow?: string[];
  links?: FaqLink[];
};

export const FAQ_CATEGORIES: { key: FaqCategoryKey; label: string }[] = [
  { key: "general", label: "General" },
  { key: "ai", label: "AI recruitment" },
  { key: "candidates", label: "Candidates" },
  { key: "interviews", label: "Screening and interviews" },
  { key: "workflow", label: "Hiring workflow" },
  { key: "security", label: "Security" },
  { key: "pricing", label: "Pricing and getting started" },
];

/**
 * The homepage nine, placed into categories and given links.
 *
 * Keyed by the question text, which is what makes a rename detectable: a key
 * that no longer matches leaves an entry without metadata, and the test asserts
 * every HOME_FAQS question still has some.
 */
const HOME_META: Record<
  string,
  { id: string; category: FaqCategoryKey; flow?: string[]; links?: FaqLink[] }
> = {
  "What is Scoreboad?": {
    id: "what-is-scoreboad",
    category: "general",
    links: [
      { label: "See the full hiring workflow", href: "/how-it-works" },
      { label: "Read about how Scoreboad is built", href: "/about" },
    ],
  },
  "How does Scoreboad use AI?": {
    id: "how-ai-is-used",
    category: "ai",
    links: [{ label: "Read the AI safety model", href: "/how-it-works#ai-safety" }],
  },
  "Does AI make the final hiring decision?": {
    id: "does-ai-decide",
    category: "ai",
    flow: ["AI output", "Validated in code", "Reviewed by a person", "Decision"],
    links: [
      { label: "Read the AI safety model", href: "/how-it-works#ai-safety" },
      { label: "See how AI output is controlled", href: "/security#ai" },
    ],
  },
  "How does candidate screening work?": {
    id: "how-screening-works",
    category: "candidates",
    flow: ["Resume", "Parsed into fields", "Scored against the role", "Recruiter reviews"],
    links: [
      { label: "Explore AI resume screening", href: "/product/understand" },
      { label: "Explore screening calls", href: "/product/screen" },
    ],
  },
  "Can recruiters review and override AI results?": {
    id: "can-recruiters-override",
    category: "ai",
    links: [{ label: "Explore candidate evaluation", href: "/product/decide" }],
  },
  "How does Scoreboad handle candidate information?": {
    id: "candidate-information",
    category: "security",
    links: [{ label: "Read how isolation and access control work", href: "/security" }],
  },
  "Do candidates need an account?": {
    id: "candidate-accounts",
    category: "candidates",
    links: [{ label: "Explore how applications arrive", href: "/product/source" }],
  },
  "What happens if an AI service is unavailable?": {
    id: "ai-unavailable",
    category: "ai",
  },
  "Do you hold SOC 2 or ISO 27001 certification?": {
    id: "certification",
    category: "security",
    links: [{ label: "Read what Scoreboad does not have", href: "/security#status" }],
  },
};

/** Turn a homepage entry into a full FAQ item without restating its answer. */
function fromHome(faq: { q: string; a: string }): FaqItem {
  const meta = HOME_META[faq.q];
  return {
    // A missing key would be a rename. The fallbacks keep the page rendering
    // rather than crashing on it; the test is what actually catches it.
    id: meta?.id ?? faq.q.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, ""),
    category: meta?.category ?? "general",
    q: faq.q,
    a: faq.a,
    flow: meta?.flow,
    links: meta?.links,
  };
}

/** The questions that exist only on this page. */
const EXTRA_FAQS: FaqItem[] = [
  // ---- General ------------------------------------------------------------
  {
    id: "who-is-it-for",
    category: "general",
    q: "Who is Scoreboad for?",
    a:
      "Teams who run their own hiring and want it in one place rather than across " +
      "a spreadsheet, an inbox and a calendar. Access is organised as four roles — " +
      "Owner, Admin, Recruiter and Viewer — so the same workspace suits one person " +
      "hiring occasionally and a small team hiring continuously.",
    links: [{ label: "Read how access control works", href: "/security#access" }],
  },
  {
    id: "fit-existing-workflow",
    category: "general",
    q: "How does Scoreboad fit into an existing hiring workflow?",
    a:
      "A job carries its own stages and screening questions, so the pipeline is " +
      "shaped to how you already hire rather than the other way round. " +
      "Applications can arrive through a shared link, a bulk upload or by hand, " +
      "which means you can start with one role without migrating anything.",
    links: [{ label: "See the full hiring workflow", href: "/how-it-works" }],
  },
  {
    id: "replace-recruiters",
    category: "general",
    q: "Does Scoreboad replace recruiters?",
    a:
      "No. It removes the reading and the retyping — parsing resumes, taking " +
      "first-round calls, keeping records current — and leaves the judgement " +
      "where it was. Every consequential decision is made by a person and " +
      "recorded against them.",
  },

  // ---- AI -----------------------------------------------------------------
  {
    id: "what-ai-receives",
    category: "ai",
    q: "What does the AI actually have access to?",
    a:
      "Structured input for one named task, and nothing else. The model holds no " +
      "database connection and no tools, it cannot look anything up, and its " +
      "output is narrowed by a validation function before any part of the product " +
      "uses it. There is no open prompt box anywhere in Scoreboad.",
    links: [{ label: "Read how AI output is handled", href: "/security#ai" }],
  },
  {
    id: "ai-bias",
    category: "ai",
    q: "Is the AI checked for bias?",
    a:
      "No, and Scoreboad does not claim to reduce bias. No model here has been " +
      "audited for it, so no part of the product treats a model's output as a " +
      "finding — a person reads it beside the material it came from before it " +
      "counts for anything. Saying otherwise would be a claim nobody has tested.",
  },

  // ---- Candidates ---------------------------------------------------------
  {
    id: "how-applications-arrive",
    category: "candidates",
    q: "How do applications reach Scoreboad?",
    a:
      "Through a shared application link or QR code, by uploading resumes in bulk, " +
      "or by adding somebody by hand. A link is a signature rather than a stored " +
      "token, so one version bump revokes every link and code a form has issued " +
      "without invalidating anything else.",
    links: [{ label: "Explore how applications arrive", href: "/product/source" }],
  },
  {
    id: "candidate-record",
    category: "candidates",
    q: "What is kept on a candidate's record?",
    a:
      "One record per person, carrying every application they have made, their " +
      "resumes, any screening report, interview rounds and feedback, the " +
      "evaluation panel and a dated activity history. The point is that nobody " +
      "has to reconstruct a candidate's history from an inbox.",
    links: [{ label: "Explore the candidate workspace", href: "/product/understand" }],
  },
  {
    id: "evaluation",
    category: "candidates",
    q: "How does candidate evaluation work?",
    a:
      "Interview feedback is collected in a fixed shape rather than as free " +
      "comments, so rounds can be compared. The evaluation panel puts the match " +
      "score, the screening report and every round's scores on one screen for a " +
      "person to weigh — it does not produce a verdict of its own.",
    links: [{ label: "Explore candidate evaluation", href: "/product/decide" }],
  },

  // ---- Screening and interviews ------------------------------------------
  {
    id: "ai-interviews",
    category: "interviews",
    q: "Does Scoreboad conduct AI interviews?",
    a:
      "No — and the distinction is worth being exact about, because the phrase is " +
      "used loosely. Scoreboad runs an automated first-round screening CALL that " +
      "asks a fixed set of questions and returns a structured report. Interviews " +
      "themselves are conducted by your team; Scoreboad schedules them, collects " +
      "the feedback and keeps it on the candidate's record.",
    flow: ["Screening call", "Transcript", "Structured report", "Recruiter reviews"],
    links: [{ label: "Explore AI screening calls", href: "/product/screen" }],
  },
  {
    id: "screening-call",
    category: "interviews",
    q: "What happens on a screening call?",
    a:
      "The call opens by saying it is automated and may be recorded, works through " +
      "the questions set for that job, and produces a report of structured fields " +
      "with a transcript beside it. Fields the model was unsure about are flagged " +
      "so a recruiter checks those first, and a correction is stored alongside " +
      "what the AI originally said rather than replacing it.",
    flow: ["Consent disclosure", "Questions", "Transcript", "Report", "Review"],
    links: [{ label: "Explore AI screening calls", href: "/product/screen" }],
  },
  {
    id: "call-consent",
    category: "interviews",
    q: "Are candidates told the call is automated?",
    a:
      "Yes, in the opening line, and that disclosure cannot be reordered or " +
      "switched off. Recording somebody without telling them is unlawful in many " +
      "places, so it is built as a constraint rather than left as a setting " +
      "somebody could turn off.",
  },
  {
    id: "interview-scheduling",
    category: "interviews",
    q: "Can Scoreboad schedule interviews?",
    a:
      "Yes, when a calendar is connected — the integration creates the invite and " +
      "the meeting link. Without it the interview still exists as a round on the " +
      "application with its feedback attached; you just arrange the time yourself.",
    links: [{ label: "See which integrations exist", href: "/#integrations" }],
  },

  // ---- Hiring workflow ----------------------------------------------------
  {
    id: "pipeline",
    category: "workflow",
    q: "How does the hiring pipeline work?",
    a:
      "Each application sits at a stage — Applied, Shortlisted, AI Screening Call, " +
      "Phone Interview, Video Interview, Written Assessment, Director Round — and " +
      "moves through them until it is Hired, Rejected or Withdrawn. Every board is " +
      "per job, and time in stage is tracked against a target you set.",
    flow: ["Applied", "Shortlisted", "Screening", "Interview", "Decision"],
    links: [{ label: "Explore the hiring pipeline", href: "/product/decide" }],
  },
  {
    id: "drag-and-drop",
    category: "workflow",
    q: "Can I drag a candidate between stages?",
    a:
      "No, and that is deliberate rather than missing. A stage change is made from " +
      "a menu on the card, which is keyboard-accessible, works on a phone and " +
      "cannot fire from a mis-drag. Moving someone through a hiring pipeline " +
      "should take a deliberate action.",
  },
  {
    id: "automation",
    category: "workflow",
    q: "Can parts of the hiring workflow be automated?",
    a:
      "Yes, from a fixed catalogue rather than a free-form builder. A rule listens " +
      "for something that happened — an application entering a stage, a screening " +
      "call completing, an application sitting too long — and runs a named action " +
      "such as starting a screening call, moving a stage, notifying the assigned " +
      "recruiter or sending a templated message. Both lists are closed, so a rule " +
      "can only do things the product knows how to do.",
    links: [{ label: "Explore recruitment automation", href: "/product/operate" }],
  },
  {
    id: "activity-log",
    category: "workflow",
    q: "Can I see who changed what?",
    a:
      "Yes. Eighty-six catalogued event types record the person, the record, the " +
      "change and the time, and they render as sentences rather than raw data. " +
      "Events that change who can do what are restricted to Owners and Admins by " +
      "the same database policy that protects everything else.",
    links: [{ label: "Read about auditability", href: "/security#audit" }],
  },

  // ---- Security -----------------------------------------------------------
  {
    id: "access-control",
    category: "security",
    q: "How is access to candidate data controlled?",
    a:
      "Four roles, checked in three places: the interface, the API and the " +
      "database. The database check is the one that counts — hiding a control is " +
      "cosmetic, and a rule that exists only in application code is not a rule. " +
      "A record belonging to another workspace returns not found rather than " +
      "forbidden, so nobody can use the difference to work out what exists.",
    links: [{ label: "Read how access control works", href: "/security#access" }],
  },
  {
    id: "data-protection",
    category: "security",
    q: "How is candidate information protected?",
    a:
      "Every row belongs to one workspace and row-level policies decide what a " +
      "query returns. Uploaded files sit in private storage and are read through " +
      "short-lived signed links after the caller's workspace is checked. Message " +
      "recipients are masked in the log itself, IP addresses are stored only as a " +
      "keyed hash, and integration credentials are encrypted. Scoreboad does not " +
      "claim a blanket encryption standard beyond that, because it has not " +
      "verified one.",
    links: [{ label: "Read the full security page", href: "/security" }],
  },

  // ---- Pricing and getting started ---------------------------------------
  {
    id: "cost",
    category: "pricing",
    q: "How much does Scoreboad cost?",
    a:
      "Nothing today, because there is nothing in the product that could take a " +
      "payment. There is no billing, no plans and no card step. Pricing is " +
      "unpublished because it is undecided, not because it is being withheld " +
      "until you ask — when it exists it will be published as figures.",
    links: [{ label: "See what Scoreboad costs today", href: "/#pricing" }],
  },
  {
    id: "free-trial",
    category: "pricing",
    q: "Is there a free trial?",
    a:
      "No — not because it is restricted, but because there is nothing to trial " +
      "against. No subscription is running, so nothing expires and nothing needs " +
      "cancelling. There are no plan limits either, because there are no plans.",
  },
  {
    id: "getting-started",
    category: "pricing",
    q: "How do I get started?",
    a:
      "Create an account with an email and password or with Google, name your " +
      "organisation and invite whoever is hiring with you, then open your first " +
      "job and share its application link. The rest of the workflow follows from " +
      "that job.",
    flow: ["Create an account", "Set up the workspace", "Open a job"],
    links: [{ label: "Create an account", href: "/signup" }],
  },
  {
    id: "talk-to-someone",
    category: "pricing",
    q: "Can I talk to someone about Scoreboad?",
    a:
      "Not yet, and it is better to say so here than to let you find out at the " +
      "end of a form. There is no sales inbox, no demo booking and no scheduling " +
      "tool connected, so an account is the fastest way to see whether the " +
      "product fits. The contact page explains what does exist.",
    links: [{ label: "See what contact options exist", href: "/contact" }],
  },
];

/**
 * Every question, homepage ones first so the most common land at the top of
 * their categories.
 */
export const FAQ_ITEMS: FaqItem[] = [...HOME_FAQS.map(fromHome), ...EXTRA_FAQS];

/** The categories that actually have questions — Step 5 forbids empty ones. */
export function faqCategoriesInUse(): { key: FaqCategoryKey; label: string }[] {
  const used = new Set(FAQ_ITEMS.map((item) => item.category));
  return FAQ_CATEGORIES.filter((category) => used.has(category.key));
}

/** Items for a category, in declaration order. */
export function faqItemsFor(category: FaqCategoryKey): FaqItem[] {
  return FAQ_ITEMS.filter((item) => item.category === category);
}

export const FAQ_HERO = {
  title: "Frequently asked questions about Scoreboad.",
  lead:
    "Everything you need to know about AI-powered recruitment, candidate " +
    "screening, interviews, hiring workflows and the Scoreboad platform — " +
    "including the questions with an awkward answer.",
} as const;

export const FAQ_CTA = {
  title: "Still have questions?",
  body:
    "The walkthrough covers the whole hiring workflow end to end, and an account " +
    "costs nothing to open.",
  primary: { label: "Create an account", href: "/signup" },
  secondary: { label: "See the full walkthrough", href: "/how-it-works" },
} as const;
