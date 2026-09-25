// =============================================================================
// Public website content layer — Module 21.
//
// WHY CONTENT LIVES HERE AND NOT IN JSX.
//
// The public site has one landing page, one "how it works" page and six product
// pages, and every one of them repeats the same shapes: an eyebrow, a heading, a
// paragraph, three short capability lines. Writing that as prose inside each
// route gives you six files to edit for one copy change and no way to test that
// a page is complete.
//
// So the copy is data, typed, in one file. The routes are layout. A marketing
// edit touches this file; a design change touches the components. The test in
// content.test.ts then enforces what a human reviewer would otherwise have to
// remember: every group has an eyebrow, every capability line is short enough
// not to wrap into a fourth line, every internal link resolves to a real page.
//
// THE NO-FICTION RULE.
//
// Every capability named here maps to code that exists in this repository. The
// numbers in STATS are counted from the repo, not chosen because they sound
// impressive — see the comment on each one. There are no customer logos, no
// testimonials, no "cuts time-to-hire by 70%", and no security certifications,
// because this product has no customers to quote and holds no certifications
// yet. A marketing page that overstates the product is the same class of error
// as a dashboard reporting a fake zero: it tells a human something untrue that
// they will then act on.
// =============================================================================

/** A single short capability line — the three-per-panel list under a feature. */
export type CapabilityLine = {
  /** Kept to two visual lines on a phone. The test enforces the length. */
  label: string;
  detail: string;
};

/**
 * One capability group. These are the tabs in the feature explorer on the
 * landing page AND the six product pages, so the two can never drift apart.
 */
export type CapabilityGroup = {
  /** URL segment under /product. */
  slug: string;
  /** The tab label. One or two words — it sits in a horizontal scroller. */
  tab: string;
  /** The small label above the heading. */
  eyebrow: string;
  /** The product-page h1 and the panel h3. Written as a sentence. */
  heading: string;
  /** One paragraph. Plain language, no module numbers. */
  summary: string;
  /** Who this is for, named as a role rather than a persona invention. */
  audience: string;
  /** The problem, stated concretely enough to be recognisable. */
  problem: string;
  /** Exactly three, so every panel is the same height. */
  capabilities: [CapabilityLine, CapabilityLine, CapabilityLine];
  /** The real modules behind this group, for the product page's detail list. */
  modules: { name: string; what: string }[];
  /**
   * What the AI proposes and what a human confirms. Null where the group has
   * no AI in it at all — which is itself worth saying, rather than implying
   * every surface is AI-driven.
   */
  aiBoundary: { proposes: string; confirms: string } | null;
  /** Slugs of adjacent groups. The test asserts each one resolves. */
  connectsTo: string[];
};

/**
 * The six groups, ordered as the hiring workflow actually runs. Sourced from
 * docs/00-overview.md's end-to-end flow and the 20 module specs in
 * docs/modules/, collapsed into the stages a buyer thinks in.
 */
export const CAPABILITY_GROUPS: CapabilityGroup[] = [
  {
    slug: "source",
    tab: "Source",
    eyebrow: "Source",
    heading: "Every requirement, candidate and application in one place.",
    summary:
      "Open a role, bring candidates in the way they actually arrive — a career page, a bulk folder of resumes, a referral, a manual add — and keep every application tied to the job it was for.",
    audience: "Recruiters and agency owners running more than a handful of open roles",
    problem:
      "Requirements live in email, candidates live in a spreadsheet, and nobody can answer 'who have we already spoken to for this role?' without asking three people.",
    capabilities: [
      {
        label: "Jobs with their own hiring stages",
        detail: "Each role defines the stages it actually uses, not one global pipeline.",
      },
      {
        label: "One candidate, many applications",
        detail: "A person applies to several roles without becoming several records.",
      },
      {
        label: "Bulk resume intake",
        detail: "Drop a folder of resumes onto a job and process them file by file.",
      },
    ],
    modules: [
      { name: "Jobs", what: "Requirements, per-job hiring stages, and job health rules that flag a role going stale." },
      { name: "Candidates", what: "The person record — profile, resume history, notes, and every role they have been considered for." },
      { name: "Applications", what: "The join between a candidate and a job, carrying its own stage, timeline and evaluation." },
      { name: "Bulk resume intake", what: "Add many candidates to a job at once, with deterministic matching against people already on file." },
    ],
    aiBoundary: {
      proposes: "A job description can be turned into structured fields, and a resume into a candidate profile.",
      confirms: "A recruiter reviews the extracted fields before the job opens or the candidate record is written.",
    },
    connectsTo: ["understand", "decide"],
  },
  {
    slug: "understand",
    tab: "Understand",
    eyebrow: "Understand",
    heading: "Read every resume, without reading every resume.",
    summary:
      "Resumes arrive as PDFs and Word files written to no standard at all. They are parsed into structured profiles, then scored against the role with deterministic checks first and semantic matching second — so the reason for a score is always inspectable.",
    audience: "Anyone whose inbox is the real applicant tracking system",
    problem:
      "Two hundred resumes for one role, each in a different format, and the only way to rank them is to open all two hundred.",
    capabilities: [
      {
        label: "Structured profiles from any format",
        detail: "PDF and Word resumes become comparable fields.",
      },
      {
        label: "Deterministic checks run first",
        detail: "Hard requirements are decided in code, not by a language model.",
      },
      {
        label: "Every score is explainable",
        detail: "See which requirement drove a match before you trust it.",
      },
    ],
    modules: [
      { name: "Resume AI parsing", what: "Extraction into structured fields, with a review diff showing exactly what changed before anything is saved." },
      { name: "AI matching", what: "A deterministic scorer for hard requirements, combined with semantic matching for the rest." },
    ],
    aiBoundary: {
      proposes: "Extracted profile fields and a match score with its reasoning.",
      confirms: "A recruiter accepts, edits or rejects the extraction on a review screen. Nothing reaches the candidate record unreviewed.",
    },
    connectsTo: ["source", "screen"],
  },
  {
    slug: "screen",
    tab: "Screen",
    eyebrow: "Screen",
    heading: "First-round screening calls that actually happen.",
    summary:
      "An AI voice agent runs the first screening conversation, then the call becomes a structured report a human can act on — availability, notice period, expectations, and the answers to the questions you set.",
    audience: "Teams whose shortlist decays while first calls wait to be scheduled",
    problem:
      "Fifty shortlisted candidates and one recruiter means the fiftieth first call happens three weeks late, by which point the candidate has taken another offer.",
    capabilities: [
      {
        label: "Consent disclosure that cannot be turned off",
        detail: "Every call opens by saying what it is.",
      },
      {
        label: "A hard cap on attempts",
        detail: "Nobody is called until they stop answering.",
      },
      {
        label: "Calls become structured reports",
        detail: "A readable summary with the answers, not a recording to sit through.",
      },
    ],
    modules: [
      { name: "AI screening calls", what: "Outbound voice screening through the Bolna adapter, with a call script, retry policy and attempt cap." },
      { name: "Screening reports", what: "The call summarized into a structured, reviewable report attached to the application." },
    ],
    aiBoundary: {
      proposes: "The conversation and the summary of what the candidate said.",
      confirms: "A recruiter reads the report and decides. The call is disconnected by default and needs explicit confirmation in the UI before it can dial anyone.",
    },
    connectsTo: ["understand", "decide"],
  },
  {
    slug: "decide",
    tab: "Decide",
    eyebrow: "Decide",
    heading: "A pipeline that tells you what is going wrong.",
    summary:
      "Move applications through the stages that role actually uses, with service-level tracking that surfaces the candidate nobody has touched in nine days. Schedule interviews with a prepared brief, and run the technical round in the product instead of over a screen share.",
    audience: "Hiring managers and recruiters who need to know what is stuck",
    problem:
      "The board looks fine. Meanwhile a strong candidate has been sitting in 'client review' for two weeks and nobody noticed.",
    capabilities: [
      {
        label: "SLA tracking per stage",
        detail: "At-risk and overdue are computed, not remembered.",
      },
      {
        label: "Interviews with a prepared brief",
        detail: "The interviewer walks in knowing the candidate.",
      },
      {
        label: "Live coding, in the product",
        detail: "A shared editor the candidate opens from a link — no install, no login.",
      },
    ],
    modules: [
      { name: "Pipeline", what: "Stage boards with SLA configuration, per-job stage lists, and AI-assisted prioritisation of what to work on next." },
      { name: "Interviews", what: "Scheduling, feedback capture, reminder queue, and an AI-prepared interview brief." },
      { name: "Live coding interviews", what: "A shared code editor for the technical round, opened by the candidate from a signed link that carries no candidate or organization id." },
      { name: "Evaluations", what: "Structured scoring and verdicts recorded against the application, not left in someone's notebook." },
    ],
    aiBoundary: {
      proposes: "An interview brief, and a suggested order of attention across the pipeline.",
      confirms: "Every stage move, every evaluation and every hiring decision is made by a person.",
    },
    connectsTo: ["screen", "close"],
  },
  {
    slug: "close",
    tab: "Close",
    eyebrow: "Close",
    heading: "From offer to first day, without a spreadsheet.",
    summary:
      "Share a shortlist with the client and track how long feedback actually takes. Once someone is hired, the document checklist opens itself and chases what is missing, so onboarding is not an email thread.",
    audience: "Agencies with clients to report to, and teams with paperwork to collect",
    problem:
      "The offer went out, the candidate said yes, and three weeks later nobody can say whether their signed contract ever came back.",
    capabilities: [
      {
        label: "Client submissions and feedback timing",
        detail: "See which client is the actual bottleneck.",
      },
      {
        label: "Document checklists open automatically",
        detail: "Created by a database trigger on hire, not by remembering.",
      },
      {
        label: "Overdue documents get swept",
        detail: "Missing paperwork surfaces before the start date.",
      },
    ],
    modules: [
      { name: "Clients", what: "Client records, shortlist submissions, and feedback turnaround measurement." },
      { name: "Onboarding and documents", what: "A per-hire document checklist with a completion gate and an overdue sweep. Records are created by a trigger, never by a route handler." },
    ],
    aiBoundary: {
      proposes: "A client-facing submission summary, and a recommended document checklist for the role.",
      confirms: "A recruiter edits and approves anything before a client or a new hire ever sees it.",
    },
    connectsTo: ["decide", "operate"],
  },
  {
    slug: "operate",
    tab: "Operate",
    eyebrow: "Operate",
    heading: "Measure it, automate it, and know who changed what.",
    summary:
      "Analytics over the whole funnel with the filters that matter, automation rules for the repetitive moves, candidate and internal communication from one template library, and an append-only audit log behind all of it.",
    audience: "Whoever has to answer for the numbers at the end of the quarter",
    problem:
      "Reporting means exporting three views into a spreadsheet on the last Friday of the month, and the numbers never quite agree.",
    capabilities: [
      {
        label: "Funnel analytics with real filters",
        detail: "Trends and CSV export, computed in the org's own timezone.",
      },
      {
        label: "Automation rules you can read",
        detail: "A rule catalogue and evaluator, not an opaque black box.",
      },
      {
        label: "An append-only audit log",
        detail: "Who changed what, when, and from where.",
      },
    ],
    modules: [
      { name: "Analytics and reporting", what: "Metric calculators, trend direction, filters and CSV export. Every 'this week' uses the organization's configured timezone." },
      // Was "orchestrated through n8n" — wrong on two counts. It named a provider
      // that is not customer-facing, and the engine does not run through it:
      // Module 13 evaluates and executes rules in-process, deliberately. A public
      // page claiming otherwise is a promise about architecture nobody can keep.
      { name: "Automation engine", what: "A rule catalogue, evaluator and execution engine that runs in-process, with an approval gate on anything that contacts a candidate." },
      { name: "Notifications and communication", what: "Internal notifications plus the candidate-facing half — templates, pipeline-event triggers, email and WhatsApp, and a working opt-out." },
      { name: "Activity and audit", what: "An append-only event log across every module, with narrative grounding so a summary cannot contradict the numbers." },
      { name: "Settings and integrations", what: "Organization settings, preferences, and integration health for every connected provider." },
    ],
    aiBoundary: {
      proposes: "A plain-language explanation of a metric, a drafted automation rule, and a daily brief.",
      confirms: "A person approves any rule before it runs. Generated summaries are checked in code against the real figures, so a brief cannot state a number that contradicts the dashboard.",
    },
    connectsTo: ["decide", "close"],
  },
];

/**
 * The four-step chip row under the hero. Deliberately the shortest honest
 * description of the product — a visitor should get the shape in four words.
 */
export const HERO_STEPS = ["Open a role", "Bring candidates in", "Screen and interview", "Hire"];

/**
 * The stat band.
 *
 * COUNTED, NOT CHOSEN. Every figure here is derived from this repository and
 * can be re-derived by anyone who clones it — the commands are in the comments
 * so a future editor can check them rather than trusting the number. That is
 * the whole reason this band does not say "70% faster hiring": there is no
 * measurement behind a claim like that, and inventing one to fill a hero is how
 * a product page starts lying.
 */
export const STATS: { value: string; label: string; note: string }[] = [
  {
    value: "20",
    label: "modules, one connected system",
    // ls docs/modules/*.md — 19 numbered specs plus the live coding round.
    note: "Not a suite of separate tools. Every module reads the same records.",
  },
  {
    value: "41",
    label: "tables under row-level security",
    // grep -c "enable row level security" supabase/migrations/*.sql
    note: "Isolation is enforced by the database, not by a filter in the UI.",
  },
  {
    value: "16",
    label: "named AI functions, zero generic prompts",
    // ls lib/ai/*.ts, excluding tests, provider.ts and numericGuard.ts.
    note: "Each one has a defined input, a validated output, and a human review step.",
  },
];

/** How-it-works: the end-to-end flow, from docs/00-overview.md. */
export const END_TO_END_FLOW: { stage: string; detail: string; group: string }[] = [
  { stage: "Client requirement becomes a job", detail: "The role is opened with its own hiring stages.", group: "source" },
  { stage: "Candidates enter the system", detail: "Career page, bulk upload, referral, or added by hand.", group: "source" },
  { stage: "Resumes are parsed into profiles", detail: "Structured fields extracted from whatever format arrived.", group: "understand" },
  { stage: "A human reviews the extraction", detail: "The review diff shows exactly what would be written.", group: "understand" },
  { stage: "Candidates are matched to the role", detail: "Deterministic requirement checks, then semantic matching.", group: "understand" },
  { stage: "An AI agent runs the screening call", detail: "With a consent disclosure and a hard attempt cap.", group: "screen" },
  { stage: "The call becomes a structured report", detail: "Readable answers, not an hour of audio.", group: "screen" },
  { stage: "The recruiter reviews and decides", detail: "AI output is an input to a person, never an action.", group: "screen" },
  { stage: "The application moves through the pipeline", detail: "With SLA tracking on every stage.", group: "decide" },
  { stage: "Interviews are scheduled with a brief", detail: "Optionally including a live coding round.", group: "decide" },
  { stage: "Evaluations and feedback are recorded", detail: "Against the application, in a comparable shape.", group: "decide" },
  { stage: "The client reviews the shortlist", detail: "And their feedback turnaround is measured.", group: "close" },
  { stage: "Offer, then hire", detail: "The document checklist opens itself on hire.", group: "close" },
  { stage: "Onboarding documents are collected", detail: "With an overdue sweep before the start date.", group: "close" },
  { stage: "Everything is measured and automated", detail: "Analytics over the funnel, automation for the repetition.", group: "operate" },
];

/**
 * Role-specific short flows for the how-it-works page.
 *
 * `anchor` MAKES THESE ADDRESSABLE. They rendered as anonymous cards until the
 * navbar needed a "Who It's For" menu; rather than invent four /for/* pages to
 * hang that menu on, the sections that already existed were given ids. The nav
 * links to `/how-it-works#<anchor>` and `lib/marketing/navigation.test.ts`
 * asserts every one of those fragments matches an anchor below — so renaming a
 * role here fails the test instead of silently breaking a menu item.
 */
export const ROLE_FLOWS: { role: string; anchor: string; summary: string; steps: string[] }[] = [
  {
    role: "Agency recruiter",
    anchor: "for-agency-recruiter",
    summary: "Many clients, many roles, and submissions to track.",
    steps: ["Take the requirement", "Search candidates already on file", "Bulk-add new resumes", "Screen and shortlist", "Submit to the client", "Track feedback turnaround"],
  },
  {
    role: "In-house talent team",
    anchor: "for-in-house-talent-team",
    summary: "Fewer roles, deeper process, more stakeholders.",
    steps: ["Open the role with its stages", "Route inbound applications", "Match and screen", "Coordinate interview panels", "Record structured evaluations", "Hand off to onboarding"],
  },
  {
    role: "Hiring manager",
    anchor: "for-hiring-manager",
    summary: "You do not want a recruiting tool. You want a decision.",
    steps: ["See only your roles", "Read the shortlist with reasons", "Take the interview with a brief", "Leave structured feedback", "Approve the offer"],
  },
  {
    role: "Candidate",
    anchor: "for-candidate",
    summary: "They never signed up for this product, and never have to.",
    steps: ["Apply from a public link", "Take a screening call with a disclosure", "Open the coding round from a link — no install, no login", "Receive interview details", "Upload documents on hire"],
  },
];

/** The trust section. States the architecture, and admits what is missing. */
export const TRUST_POINTS: { title: string; body: string; points: string[] }[] = [
  {
    title: "AI proposes. A person decides.",
    body: "The pipeline is fixed and it runs in one direction: raw data, then AI, then a structured output, then validation, then human review, and only then a business action. AI output never writes straight to a trusted table.",
    points: [
      "Every AI function has a named purpose and a validated output shape.",
      "Generated summaries are checked in code against the real figures.",
      "When the AI provider is down, the manual workflow still works.",
    ],
  },
  {
    title: "Anything that contacts a person fails closed.",
    body: "Calls, emails and messages are disconnected by default. Connecting one takes an explicit action, sending needs confirmation in the UI, and there is a hard cap on attempts.",
    points: [
      "A consent disclosure that cannot be disabled opens every call.",
      "Opt-out links work without a login, because candidates have no account.",
      "Recording someone without telling them is unlawful in many places, so the product is built so it cannot happen.",
    ],
  },
  {
    title: "Every organization's data is isolated in the database.",
    body: "Each tenant's rows are separated by row-level security in PostgreSQL. The tenant is resolved from the session — never from a request body, a query parameter or a header.",
    points: [
      "Isolation holds even for a caller talking to the database directly.",
      "Provider credentials are encrypted and readable only through a privileged path.",
      "An append-only audit log records who changed what.",
    ],
  },
];

/**
 * FAQ. Includes the honest, awkward answers — where the product is early, and
 * what it does not have — because a buyer will ask anyway and finding out later
 * is worse than reading it here.
 */
export const FAQS: { q: string; a: string }[] = [
  {
    q: "What is this, in one sentence?",
    a: "A recruitment operating system: one workspace covering jobs, candidates, applications, resume parsing, AI matching, screening calls, pipeline, interviews, client submissions, onboarding, automation and analytics — with AI assisting at each step rather than sitting in a separate 'AI' tab.",
  },
  {
    q: "Does the AI make hiring decisions?",
    a: "No, by design. AI parses, matches, summarizes and drafts. A person reviews that output and makes every consequential decision. AI output is never written directly to a trusted record — it goes through validation and a human review screen first.",
  },
  {
    q: "Are the AI screening calls disclosed to candidates?",
    a: "Yes, and the disclosure cannot be turned off. Every call opens by saying what it is. There is also a hard cap on call attempts, and calling is disconnected by default until someone explicitly enables it.",
  },
  {
    q: "How is one company's data kept separate from another's?",
    a: "Every table carries an organization id and is governed by row-level security in PostgreSQL, so isolation is enforced by the database itself rather than by a filter in the application. The tenant is always resolved from the authenticated session.",
  },
  {
    q: "What happens if the AI provider goes down?",
    a: "The manual workflow keeps working. AI failure is treated as an expected condition throughout, not an outage — you lose the assistance, not the ability to recruit.",
  },
  {
    q: "Do candidates need an account?",
    a: "No. A candidate is not a user of this product. Applying, taking a screening call, opening a coding round and unsubscribing all work without a login, authorised by signed links instead.",
  },
  {
    q: "Is it available to buy today?",
    a: "It is in active development, built module by module against a written specification. Pricing is not published yet. Get in touch and we will tell you honestly where it stands for your use case.",
  },
  {
    q: "Do you hold SOC 2 or ISO 27001 certification?",
    a: "Not today, and we would rather say so than imply otherwise. The architecture is built to the practices those audits look for — tenant isolation at the database layer, encrypted provider credentials, an append-only audit log, and least-privilege access — but no certification has been completed.",
  },
];

/*
  The header nav and footer columns MOVED to lib/marketing/home.ts as
  HOME_NAV_LINKS / HOME_FOOTER_SECTIONS when the landing page was redesigned.

  Removed rather than left in place: both were exported, both were unused by any
  component afterwards, and a second set of nav constants sitting beside the
  live ones is how a future edit lands in the wrong file and appears to do
  nothing. Their link-integrity assertions moved to home.test.ts with them.
*/

/** Lookup used by the product route's generateStaticParams and page. */
/**
 * What each product page is ABOUT, in words a reader or a search result can use.
 *
 * WHY THIS EXISTS SEPARATELY FROM `tab`. The tab labels — Source, Understand,
 * Screen, Decide, Close, Operate — are good tabs: one word each, they fit a
 * horizontal scroller and they read as a sequence. They are poor titles and
 * poor link text, because out of that strip they describe nothing. "Decide ·
 * Scoreboad" is a browser tab nobody can place and a search result nobody
 * clicks.
 *
 * Each label below was taken from that page's own `heading`, not written to
 * hit a keyword. ONE MAP, used by the product page's <title>, its Open Graph
 * title and the footer's anchor text, so the three cannot drift.
 */
export const PRODUCT_SEO_TITLES: Record<string, string> = {
  source: "Jobs and applications",
  understand: "AI resume screening",
  screen: "AI screening calls",
  decide: "Hiring pipeline and evaluation",
  close: "Offers and onboarding",
  operate: "Analytics and automation",
};

export function getGroup(slug: string): CapabilityGroup | undefined {
  return CAPABILITY_GROUPS.find((g) => g.slug === slug);
}

/** Every internal path the site links to. The content test uses this. */
export const INTERNAL_ROUTES: string[] = [
  "/",
  "/about",
  "/security",
  "/contact",
  "/faq",
  "/privacy",
  "/terms",
  "/cookies",
  "/how-it-works",
  "/login",
  "/signup",
  ...CAPABILITY_GROUPS.map((g) => `/product/${g.slug}`),
];
