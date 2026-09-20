// =============================================================================
// The landing page's content.
//
// ITS OWN MODULE, not appended to content.ts, for two reasons: content.ts is
// shared by /how-it-works and /product/*, and its test asserts things about
// those pages that the landing page does not share; and keeping the homepage's
// copy in one file makes it obvious what a marketing edit may touch.
//
// THE RULE THAT SHAPED EVERY STRING HERE: describe only what is built. Each
// entry carries a comment naming the module or lib/ path that implements it, so
// the next person to edit a line can verify it rather than trust it. Where a
// capability is real but narrower than the marketing word for it, the narrower
// wording wins — an overclaim on this page is a promise the product has to keep
// on the first call.
//
// Icons are named as strings and resolved in the component, so this stays a
// plain data module with no React import and no client boundary.
// =============================================================================
import { CAPABILITY_GROUPS } from "@/lib/marketing/content";

export type HomeCard = {
  title: string;
  body: string;
  /** A lucide-react icon name. Line icons only — see ICONS in the component. */
  icon: string;
};

// -----------------------------------------------------------------------------
// Hero
// -----------------------------------------------------------------------------

export const HERO = {
  /** Split so the second line can carry the brand gradient on its own. */
  headlineLead: "Find the Right People",
  headlineAccent: "Faster with AI",
  lead:
    "From screening to hiring, Scoreboad helps you build high-performing teams " +
    "with the power of AI.",
  /*
    Kept from the previous homepage, and kept deliberately.

    This product has no customers to name, so there is no logo wall and no
    testimonial. Saying where it actually stands is the honest substitute, and
    it is the line a founder evaluating a young product wants to see first.
  */
  badge: "In active development · built module by module",
} as const;

// -----------------------------------------------------------------------------
// The bright product visual
// -----------------------------------------------------------------------------

/**
 * The dashboard mock's content.
 *
 * ILLUSTRATIVE FIGURES, and the component labels them as such rather than
 * presenting them as a live readout. They are shaped like a small team's real
 * numbers — a pipeline of 248 with 12 interviews is plausible; 50,000
 * candidates would be a claim about scale nobody has tested.
 *
 * The sidebar items are the REAL top-level routes of the application, in the
 * real order, so the picture is a picture of this product rather than of a
 * generic SaaS dashboard.
 */
export const DASHBOARD = {
  nav: ["Dashboard", "Jobs", "Candidates", "Applications", "Pipeline", "Interviews"],
  tiles: [
    { label: "Total candidates", value: "248", delta: "+18 this week", good: true },
    { label: "Interviews", value: "12", delta: "4 awaiting feedback", good: false },
    { label: "Shortlisted", value: "31", delta: "+6 this week", good: true },
    { label: "Time to hire", value: "24d", delta: "3d faster", good: true },
  ],
  /** The funnel, as shares of the top of the pipeline. */
  funnel: [
    { stage: "Applied", value: 248, pct: 100 },
    { stage: "Screening", value: 126, pct: 51 },
    { stage: "Shortlisted", value: 31, pct: 13 },
    { stage: "Interview", value: 12, pct: 5 },
    { stage: "Offer", value: 4, pct: 2 },
  ],
} as const;

/**
 * The second product view — a candidate table.
 *
 * Columns are the ones the real Applications list carries, and "Next action" is
 * genuinely computed in the product (lib/evaluation/nextAction.ts) rather than
 * invented for the picture.
 */
export const PIPELINE_PREVIEW = {
  columns: ["Candidate", "Role", "Stage", "Match", "Next action"],
  rows: [
    { name: "A. Sharma", role: "Senior Backend Engineer", stage: "Interview", score: 91, next: "Collect feedback" },
    { name: "M. Iyer", role: "Senior Backend Engineer", stage: "Screening", score: 84, next: "Review call summary" },
    { name: "R. Nair", role: "Product Designer", stage: "Shortlisted", score: 78, next: "Schedule round 1" },
    { name: "S. Bose", role: "Data Analyst", stage: "Applied", score: 66, next: "Screen resume" },
  ],
} as const;

// -----------------------------------------------------------------------------
// One workspace — six cards, one per capability group
// -----------------------------------------------------------------------------

/**
 * Six cards, deliberately one per capability group in content.ts, so this
 * section and the /product/* routes cannot drift apart.
 */
export const WORKSPACE_CARDS: HomeCard[] = [
  {
    title: "Job creation",
    // Module 3 — jobs, with per-job hiring stages and screening questions.
    body: "Open a role with its own hiring stages, requirements and screening questions.",
    icon: "Briefcase",
  },
  {
    title: "Candidate management",
    // Module 4 — one candidate record, many applications; dedup on contact.
    body: "One record per person, carrying their resumes, contact history and every application they hold.",
    icon: "Users",
  },
  {
    title: "AI screening",
    // Module 6/7 — parseResume + matchCandidateToJob, both reviewable.
    body: "Resumes parsed and scored against the role, with the reasoning shown beside the score.",
    icon: "ScanSearch",
  },
  {
    title: "Interviews",
    // Module 11 — scheduling, the calendar adapter, structured feedback.
    body: "Schedule rounds, send invites through the connected calendar, and collect structured feedback.",
    icon: "CalendarCheck",
  },
  {
    title: "Candidate evaluation",
    // Module 10 — the evaluation panel: score, screening, feedback, verdict.
    body: "Screening results, interview feedback and match score on one panel per application.",
    icon: "ClipboardCheck",
  },
  {
    title: "Hiring workflow",
    // Module 10/13 — the pipeline board and the automation engine.
    body: "A pipeline that shows what has moved, what is stuck, and what is waiting on somebody.",
    icon: "Workflow",
  },
];

// -----------------------------------------------------------------------------
// From application to hire
// -----------------------------------------------------------------------------

export const WORKFLOW_STEPS: { step: string; title: string; body: string }[] = [
  { step: "01", title: "Create a job", body: "Requirements, stages and screening questions in one place." },
  { step: "02", title: "Find candidates", body: "Bulk resume intake, a public application form, or added by hand." },
  { step: "03", title: "AI screening", body: "Resumes read, structured and scored against the role." },
  { step: "04", title: "Interview", body: "Rounds scheduled, invites sent, feedback captured." },
  { step: "05", title: "Evaluate", body: "Every signal on one panel, for a person to weigh." },
  { step: "06", title: "Hire", body: "Offer, onboarding checklist, documents collected." },
];

// -----------------------------------------------------------------------------
// AI that handles the busy work
// -----------------------------------------------------------------------------

/**
 * Eight cards, each mapping to a named function in lib/ai/ or a built
 * integration. The comment on each says which.
 *
 * TWO WORDINGS ARE NARROWER THAN THE BRIEF ASKED FOR, on purpose:
 *
 *   - Interview SCHEDULING is not in this list. It is a real feature, but no
 *     model is involved, and listing it under an AI headline would imply one.
 *     It appears in the workspace section instead, where it belongs.
 *   - "Candidate messaging" says templates and rules rather than "automated
 *     communication", because the part that drafts freely — the WhatsApp
 *     auto-reply agent — is off by default and gated behind a master switch.
 */
export const AI_CARDS: HomeCard[] = [
  {
    title: "AI resume screening",
    // lib/ai/parseResume.ts — proposes fields; a human review screen applies them.
    body:
      "Resumes are read and structured automatically, then held for review before " +
      "anything is written to a candidate.",
    icon: "FileSearch",
  },
  {
    title: "AI candidate matching",
    // lib/ai/matchCandidateToJob.ts, beside the deterministic matcher.
    body:
      "Each application is scored against the role's real requirements, with the " +
      "strengths and gaps listed beside the number.",
    icon: "Target",
  },
  {
    title: "AI voice screening",
    // lib/integrations/bolna — disconnected by default, hard attempt cap.
    body:
      "Structured first-round calls whose answers land on the candidate's record. " +
      "Disconnected by default, and every call opens with a disclosure.",
    icon: "PhoneCall",
  },
  {
    title: "Screening summaries",
    // lib/ai/generateScreeningSummary.ts — figures checked against the source.
    body:
      "A readable account of what a screening call covered, with every figure " +
      "checked in code against the recorded answers.",
    icon: "FileText",
  },
  {
    title: "Interview briefs",
    // lib/ai/generateInterviewBrief.ts
    body:
      "What to probe in the next round, drawn from the resume and the rounds " +
      "already completed.",
    icon: "NotebookPen",
  },
  {
    title: "Candidate evaluation",
    // lib/ai/generateApplicationSummary.ts — numeric guard on every figure.
    body:
      "One paragraph on where an application stands, derived strictly from its " +
      "own recorded fields.",
    icon: "Gauge",
  },
  {
    title: "Candidate messaging",
    // lib/communications — approved templates on pipeline events, opt-out gate.
    body:
      "Approved templates that send on pipeline events over email and WhatsApp, " +
      "with opt-outs honoured automatically.",
    icon: "MessagesSquare",
  },
  {
    title: "Pipeline automation",
    // lib/automations — conditions, actions, and an approval step.
    body:
      "Rules that move, assign, notify or message when something happens, with an " +
      "approval step for anything consequential.",
    icon: "Zap",
  },
];

// -----------------------------------------------------------------------------
// Human + AI
// -----------------------------------------------------------------------------

/**
 * The section this product's architecture supports most directly. The
 * Raw Data -> AI -> Validation -> Human Review -> Business Action sequence is a
 * real constraint in the codebase, not a positioning line.
 */
export const AI_SIDE: { title: string; body: string }[] = [
  { title: "AI analyzes", body: "Reads resumes, scores matches, summarizes calls." },
  { title: "AI organizes", body: "Keeps the pipeline current and surfaces what is stuck." },
  { title: "AI assists", body: "Drafts messages and briefs inside approved wording." },
];

export const HUMAN_SIDE: { title: string; body: string }[] = [
  { title: "You review", body: "Every AI output lands on a screen before it counts." },
  { title: "You decide", body: "Stage moves, offers and rejections are yours alone." },
  { title: "You hire", body: "The judgement stays with the person making it." },
];

// -----------------------------------------------------------------------------
// Trust
// -----------------------------------------------------------------------------

/**
 * ONLY IMPLEMENTED CAPABILITIES. No certification is claimed anywhere, and the
 * FAQ says plainly that none is held. Every line points at something real.
 */
export const TRUST_CARDS: HomeCard[] = [
  {
    title: "Human review, by construction",
    // The platform rule: AI never writes to a trusted table directly.
    body:
      "AI output is validated and shown to a person before it reaches a trusted " +
      "record. There is no path that skips that step.",
    icon: "UserCheck",
  },
  {
    title: "Candidate consent",
    // Module 8's disclosure + lib/communications/optout.ts.
    body:
      "Screening calls open with a disclosure that cannot be switched off, and " +
      "every automatic message carries a working opt-out.",
    icon: "ShieldCheck",
  },
  {
    title: "Isolation in the database",
    // Row-level security on every table, tenant resolved from the session.
    body:
      "Each organization's rows are separated by row-level security in PostgreSQL " +
      "rather than by a filter in the application.",
    icon: "Database",
  },
  {
    title: "An append-only audit log",
    // Module 14 — activity_events, including who switched automations on.
    body:
      "Who changed what, and when — including who enabled an automation and who " +
      "overrode a candidate's opt-out.",
    icon: "ScrollText",
  },
  {
    title: "Encrypted integrations",
    // lib/integrations/crypto.ts — AES-GCM, column-level REVOKE.
    body:
      "Provider credentials are encrypted at rest and readable only through a " +
      "privileged server path.",
    icon: "KeyRound",
  },
  {
    title: "Degrades instead of breaking",
    // AiResult is a result type, not an exception: the manual path survives.
    body:
      "If an AI provider is unavailable the manual workflow keeps running. You " +
      "lose the assistance, not the ability to recruit.",
    icon: "Activity",
  },
];

// -----------------------------------------------------------------------------
// FAQ
// -----------------------------------------------------------------------------

/**
 * Reworded for recruiters and hiring managers; every answer still matches the
 * application.
 *
 * THE CERTIFICATION QUESTION IS KEPT. It is the first thing a procurement team
 * asks, and answering it honestly is worth more than omitting it and being
 * asked anyway.
 */
export const HOME_FAQS: { q: string; a: string }[] = [
  {
    q: "What is Scoreboad?",
    a:
      "One workspace for hiring: jobs, candidates, applications, resume screening, " +
      "first-round calls, interviews, evaluation, onboarding and analytics — with AI " +
      "assisting at each step instead of sitting in a separate tab.",
  },
  {
    q: "How does Scoreboad use AI?",
    a:
      "For the repetitive reading and writing: parsing resumes, scoring them against " +
      "a role, summarizing screening calls, drafting briefs and messages. Each one is " +
      "a named function with a defined input and a validated output, not an open-ended " +
      "chatbot.",
  },
  {
    q: "Does AI make the final hiring decision?",
    a:
      "No, by design. AI parses, matches, summarizes and drafts. A person reviews that " +
      "output and makes every consequential decision, and AI output is never written " +
      "straight to a trusted record.",
  },
  {
    q: "How does candidate screening work?",
    a:
      "A resume is parsed into structured fields and scored against the role's " +
      "requirements, with the reasoning shown beside the score. Optionally a structured " +
      "first-round voice call runs and its answers are captured on the candidate's " +
      "record. A recruiter reviews both.",
  },
  {
    q: "Can recruiters review and override AI results?",
    a:
      "Yes, and that is the normal path rather than an escape hatch. Parsed fields are " +
      "proposed, not applied; scores are advisory; generated text is editable before it " +
      "goes anywhere.",
  },
  {
    q: "How does Scoreboad handle candidate information?",
    a:
      "Each organization's data is isolated by row-level security in the database. Files " +
      "sit in private storage behind short-lived signed links, recipients are masked in " +
      "logs, and an append-only audit log records who changed what.",
  },
  {
    q: "Do candidates need an account?",
    a:
      "No. Applying, taking a screening call, opening a coding round and unsubscribing " +
      "all work without a login, authorised by signed links instead.",
  },
  {
    q: "What happens if an AI service is unavailable?",
    a:
      "The manual workflow keeps working. AI failure is treated as an expected condition " +
      "throughout rather than an outage — you lose the assistance, not the ability to " +
      "recruit.",
  },
  {
    q: "Do you hold SOC 2 or ISO 27001 certification?",
    a:
      "Not today, and we would rather say so than imply otherwise. The architecture is " +
      "built to the practices those audits look for — tenant isolation at the database " +
      "layer, encrypted credentials, an append-only audit log and least-privilege " +
      "access — but no certification has been completed.",
  },
];

// -----------------------------------------------------------------------------
// Navigation and footer
// -----------------------------------------------------------------------------

/**
 * THE BRIEF ASKED FOR MORE NAVIGATION THAN THE SITE HAS PAGES.
 *
 * Requested: Products, Solutions, Pricing, Resources in the navbar; About,
 * Contact, Security, Documentation, FAQ, Blog, Privacy and Terms in the footer.
 * None of those routes exists. The same brief also requires no broken links and
 * no invented functionality, and empty pages created to satisfy a nav are both.
 *
 * So the requested SHAPE is mapped onto real destinations, and the gap is
 * reported rather than papered over. Pricing is the notable omission: the FAQ
 * says pricing is not published yet, so a Pricing link would lead to a page
 * contradicting the answer two sections below it.
 *
 * lib/marketing/home.test.ts asserts every href here resolves to a real route.
 */
export const HOME_NAV_LINKS: { label: string; href: string }[] = [
  { label: "Product", href: "/#product" },
  { label: "How it works", href: "/how-it-works" },
  { label: "AI", href: "/#ai" },
  { label: "Trust", href: "/#trust" },
  { label: "FAQ", href: "/#faq" },
];

export const HOME_FOOTER_SECTIONS: {
  title: string;
  links: { label: string; href: string }[];
}[] = [
  {
    title: "Product",
    links: CAPABILITY_GROUPS.map((group) => ({
      label: group.tab,
      href: `/product/${group.slug}`,
    })),
  },
  {
    title: "How it works",
    links: [
      { label: "The full flow", href: "/how-it-works" },
      { label: "AI safety model", href: "/how-it-works#ai-safety" },
      { label: "Trust and security", href: "/#trust" },
    ],
  },
  {
    title: "Get started",
    links: [
      { label: "Sign in", href: "/login" },
      { label: "Create an account", href: "/signup" },
      { label: "Questions", href: "/#faq" },
    ],
  },
];

/** The brand phrase. Rendered with the × as separate, dimmed glyphs. */
export const BRAND_STATEMENT = ["People", "Intelligence", "Opportunity"] as const;
