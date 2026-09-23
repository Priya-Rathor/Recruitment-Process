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
    THE SECOND LINE IS WHERE THE SEARCH INTENT LIVES, and it is one sentence
    rather than a paragraph.

    It names the four things a person searching for an AI recruitment platform
    is actually looking for — screening candidates, managing interviews,
    evaluating applicants, a connected hiring workflow — in the order the
    product does them, as a sentence somebody would say out loud. That is the
    difference between natural copy that ranks and the keyword soup the brief
    rules out: every noun here is a surface that exists, so the sentence is a
    description rather than a list of terms.
  */
  leadDetail:
    "Screen candidates, manage interviews, evaluate applicants, and keep your " +
    "hiring workflow connected from one workspace.",
  /*
    Kept from the previous homepage, and kept deliberately.

    This product has no customers to name, so there is no logo wall and no
    testimonial. Saying where it actually stands is the honest substitute, and
    it is the line a founder evaluating a young product wants to see first.
  */
  badge: "In active development · built module by module",
  /*
    THE CTA DESTINATIONS ARE DECLARED HERE SO A TEST CAN CHECK THEM.

    "Explore the Platform" wants a /platform page, which does not exist —
    lib/marketing/navigation.ts declares it as `planned`. /how-it-works IS the
    platform walkthrough: fifteen stages, every capability, every product page
    linked from it. So the label ships against the real page rather than
    against a route created to match a label.
  */
  ctaPrimary: { label: "Get Started", href: "/signup" },
  ctaSecondary: { label: "Explore the Platform", href: "/how-it-works" },
} as const;

/**
 * The floating notification cards beside the product visual.
 *
 * EVERY ONE OF THESE IS AN EVENT THE PRODUCT ACTUALLY EMITS — the screening
 * call completing (Module 8), a match score crossing the job's threshold
 * (lib/matching), and an interview being booked into a real calendar
 * (Module 11). A "notification" for something the system cannot do would be a
 * screenshot of a feature that does not exist, which is the same lie as an
 * invented testimonial, just smaller.
 *
 * Decorative in the accessibility sense: the hero's meaning does not depend on
 * them, they are `aria-hidden`, and they are hidden outright below 1400px
 * because that is the width at which they stop having room to sit OUTSIDE the
 * dashboard frame. Overlapping the product to keep a flourish is the wrong
 * trade.
 */
export const HERO_SIGNALS: { title: string; meta: string; icon: string; tone: "mint" | "accent" }[] = [
  { title: "AI screening complete", meta: "Call summary ready to review", icon: "PhoneCall", tone: "mint" },
  { title: "Strong match found", meta: "Senior Backend Engineer", icon: "Sparkles", tone: "accent" },
];

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
  /*
    THE TILES ARE THE APPLICATION'S REAL KPIs, verbatim.

    They used to be four invented ones ("Total candidates", "Time to hire")
    with an invented delta line underneath. The real dashboard
    (app/dashboard/KpiTiles.tsx) has no delta row at all and its labels come
    from METRIC_LABELS in lib/dashboard/metrics.ts — so the old mock was a
    picture of a dashboard this product does not have.

    `warn` reproduces the one piece of real tile behaviour worth showing: a
    metric whose non-zero value is itself bad news gets an amber left edge.
    That is genuinely what the product does with overdue applications, and it
    is the detail that says this is a tool for noticing problems rather than a
    wall of green numbers.
  */
  tiles: [
    { label: "New candidates", value: "124", icon: "UserPlus", warn: false },
    { label: "Screenings completed", value: "38", icon: "PhoneCall", warn: false },
    { label: "Interviews today", value: "4", icon: "CalendarDays", warn: false },
    { label: "Overdue applications", value: "3", icon: "Clock", warn: true },
  ],
  /*
    THE FUNNEL USES THE REAL STAGE NAMES, from STAGE_LABELS in
    lib/applications/stages.ts, in the real order.

    The brief sketched "Applied → Screening → Interview → Evaluation → Hired".
    Three of those five are not stages in this product: there is no "Screening"
    stage (it is "AI Screening Call"), no "Evaluation" stage (evaluation is
    recorded against an application, not a stage), and no bare "Interview"
    (phone, video, written assessment and director round are separate,
    per-job-configurable stages). Shipping the sketch would have put four
    invented stage names on the most-read screen on the site, and every one of
    them would have been wrong on the first day somebody opened the product.

    Counts are illustrative and the component says so; they are shaped like a
    small team's real month and narrow monotonically, because a funnel that
    widens is not a funnel.
  */
  funnel: [
    { stage: "Applied", value: 124, pct: 100 },
    { stage: "Shortlisted", value: 46, pct: 37 },
    { stage: "AI Screening Call", value: 28, pct: 23 },
    { stage: "Video Interview", value: 9, pct: 7 },
    { stage: "Hired", value: 2, pct: 2 },
  ],
} as const;

/*
  PIPELINE_PREVIEW LIVED HERE — a static candidate table under the heading
  "See your hiring pipeline at a glance". Module 09 replaces that section with
  a board a candidate actually moves across, so the table and its data are
  gone rather than left as a third product shot saying the same thing.
*/


// -----------------------------------------------------------------------------
// The problem, and the turn into the solution
// -----------------------------------------------------------------------------

/**
 * WHY THIS SECTION EXISTS AT ALL, given that the page already has "One
 * workspace" and "From application to hire".
 *
 * Those two describe the SOLUTION. Nothing on the page had ever described the
 * problem, so the reader met a list of capabilities without having been told
 * what they are for. This is the missing first half of that argument, and it
 * is deliberately the only thing here that is new: the workflow itself is not
 * restated, because WORKFLOW_STEPS already renders it two bands below and a
 * second copy would be the same six stages twice on one page.
 *
 * EVERY LINE IS A STATEMENT ABOUT HIRING, NOT A CLAIM ABOUT A COMPANY.
 * "Resumes can arrive as email attachments" is observably true of the world;
 * "your resumes are lost in your inbox" is a claim about a reader nobody here
 * has met. The modal verb is doing real work in each of these and should not
 * be edited out for punchiness.
 */
export const PROBLEM_CARDS: { step: string; title: string; body: string }[] = [
  {
    step: "01",
    title: "Scattered candidate data",
    body: "Candidate information can live across resumes, spreadsheets, inboxes and separate recruiting tools.",
  },
  {
    step: "02",
    title: "Repetitive screening",
    body: "Reading every application and working out which ones fit the role is slow, and it is the same work every time.",
  },
  {
    step: "03",
    title: "Interview coordination",
    body: "Scheduling rounds, sending invites and keeping candidate conversations organised adds real overhead.",
  },
  {
    step: "04",
    title: "Inconsistent evaluation",
    body: "Feedback is hard to compare when each interviewer records it somewhere different, in a different shape.",
  },
  {
    step: "05",
    title: "One process, many tools",
    body: "A single hire can touch a job board, an inbox, a spreadsheet, a calendar and a chat thread before anyone decides.",
  },
];

/**
 * THE TRANSFORMATION, AS ONE ARRAY RENDERED TWICE.
 *
 * Six pieces of a hire. The problem band shows them scattered — each labelled
 * with the generic tool it tends to end up in — and the solution band shows the
 * same six connected, each labelled with the Scoreboad surface that holds it.
 *
 * ONE ARRAY RATHER THAN TWO IS THE POINT. The section's whole argument is that
 * these are the SAME six things in both states; two arrays would let the two
 * halves drift until the "before" and "after" were of different subjects, and
 * nothing would have failed.
 *
 * `surface` NAMES A REAL SCREEN IN THE PRODUCT, in every case: the candidate
 * record (Module 4), applications (Module 5), the structured screening report
 * (Module 8), interviews (Module 11), the evaluation panel (Module 12) and the
 * pipeline board (Module 5). Nothing here is aspirational.
 */
export const WORKFLOW_PIECES: {
  /** The thing itself. Identical in both states — that is the story. */
  piece: string;
  /** Where it tends to live when nothing is joined up. */
  scattered: string;
  /** The Scoreboad screen that holds it instead. */
  surface: string;
  icon: string;
}[] = [
  { piece: "Resumes", scattered: "Email attachments", surface: "Candidate record", icon: "FileText" },
  { piece: "Applications", scattered: "A spreadsheet", surface: "Applications", icon: "ClipboardCheck" },
  { piece: "Screening answers", scattered: "Call notes", surface: "Screening report", icon: "PhoneCall" },
  { piece: "Interview times", scattered: "Calendar invites", surface: "Interviews", icon: "CalendarCheck" },
  { piece: "Interviewer feedback", scattered: "Chat threads", surface: "Evaluation", icon: "MessagesSquare" },
  { piece: "The decision", scattered: "A meeting", surface: "Pipeline", icon: "Gauge" },
];

/** The two headings, here rather than in the components so the copy tests see them. */
export const PROBLEM_HEAD = {
  eyebrow: "The challenge",
  title: "Great candidates shouldn't get lost in a fragmented hiring process.",
  lead:
    "Sourcing, resumes, screening, interviews, evaluation and candidate " +
    "communication each tend to end up in a different place. The work of hiring " +
    "then becomes the work of keeping those places in sync.",
} as const;

export const SOLUTION_HEAD = {
  eyebrow: "The solution",
  title: "One connected workspace for modern hiring.",
  lead:
    "Scoreboad brings candidate screening, interviews, evaluation and the " +
    "hiring workflow into one place, and uses AI to take the repetitive reading " +
    "and summarising off your team — so the time goes into the decision instead " +
    "of the admin around it.",
} as const;

// -----------------------------------------------------------------------------
// The platform showcase — six real screens, one frame
// -----------------------------------------------------------------------------

/**
 * THE SIX CAPABILITIES, EACH AS A SCREEN RATHER THAN AS A CARD.
 *
 * This REPLACED the six icon-and-paragraph cards that used to sit here. Their
 * copy is not lost — each one is now a `caption` below — but the card grid
 * itself is gone, because a row of icon/heading/paragraph is the single most
 * generic thing a SaaS homepage can do and it was the page's only answer to
 * "what does this actually look like".
 *
 * EVERY LABEL IN EVERY ROW IS REAL, and that is checked by a test rather than
 * by care. The sources:
 *
 *   Jobs        app/jobs/page.tsx        Title / Status / Health columns
 *   Candidates  app/candidates           one record per person, many applications
 *   Screening   lib/evaluation/sources   strong_matches / gaps / needs_verification
 *   Interviews  lib/interviews/feedback  MODE_LABELS + STATUS_LABELS
 *   Evaluation  lib/evaluation/verdict   Pass / Fail / Needs Review, /100 and /10
 *   Pipeline    lib/applications/stages  STAGE_LABELS, plus real SLA tracking
 *
 * `nav` IS WHICH SIDEBAR ITEM LIGHTS UP, and screening and evaluation both
 * point at Applications on purpose: neither is a separate app, both are views
 * on an application record. Two tabs highlighting one nav item is the most
 * honest thing this showcase says about the product being connected.
 *
 * THE FIGURES ARE ILLUSTRATIVE and the frame's caption says so. They are
 * internally consistent with the hero's dashboard — 124 new candidates there,
 * 124 at the top of the funnel here — because a reader who compares the two
 * product shots on one page should not find two different companies.
 */
export type PlatformRow = {
  primary: string;
  secondary: string;
  /** The right-hand cell: a status, a count, or a score. */
  meta: string;
  /** Tints the meta cell. `warn` is the product's own "needs attention". */
  tone?: "good" | "warn";
  /** Renders a bar under the row. A share of something, 0-100. */
  pct?: number;
};

export const PLATFORM_VIEWS: {
  key: string;
  /** The tab label. Short — these sit in a row on desktop. */
  tab: string;
  /** Which DASHBOARD.nav entry is active while this view is shown. */
  nav: string;
  /** One line under the tabs. These are the old workspace cards' bodies. */
  caption: string;
  panel: {
    title: string;
    meta: string;
    columns: [string, string, string];
    rows: PlatformRow[];
  };
}[] = [
  {
    key: "jobs",
    tab: "Jobs",
    nav: "Jobs",
    caption:
      "Open a role with its own hiring stages, requirements and screening questions.",
    panel: {
      title: "Jobs",
      meta: "4 open",
      columns: ["Title", "Location", "Health"],
      rows: [
        { primary: "Senior Backend Engineer", secondary: "Remote · Full-time", meta: "Healthy", tone: "good" },
        { primary: "Product Designer", secondary: "Bengaluru · Full-time", meta: "Needs attention", tone: "warn" },
        { primary: "Data Analyst", secondary: "Remote · Contract", meta: "Healthy", tone: "good" },
        { primary: "Support Lead", secondary: "Pune · Full-time", meta: "Draft" },
      ],
    },
  },
  {
    key: "candidates",
    tab: "Candidates",
    nav: "Candidates",
    caption:
      "One record per person, carrying their resumes, contact history and every application they hold.",
    panel: {
      title: "Candidates",
      meta: "248 on file",
      columns: ["Candidate", "Current role", "Applications"],
      rows: [
        { primary: "A. Sharma", secondary: "Backend Engineer · 7 yrs", meta: "2 applications" },
        { primary: "M. Iyer", secondary: "Platform Engineer · 5 yrs", meta: "1 application" },
        { primary: "R. Nair", secondary: "Product Designer · 6 yrs", meta: "3 applications" },
        { primary: "S. Bose", secondary: "Data Analyst · 3 yrs", meta: "1 application" },
      ],
    },
  },
  {
    key: "screening",
    tab: "AI screening",
    nav: "Applications",
    caption:
      "Resumes parsed and scored against the role, with the reasoning shown beside the score.",
    panel: {
      title: "Resume match",
      meta: "A. Sharma · Senior Backend Engineer",
      columns: ["Signal", "Detail", "Score"],
      rows: [
        { primary: "Match score", secondary: "Requirements met, weighted by the job", meta: "91 / 100", tone: "good", pct: 91 },
        { primary: "Strong matches", secondary: "Go, PostgreSQL, distributed systems at scale", meta: "3 found", tone: "good" },
        { primary: "Gaps", secondary: "No Kubernetes experience stated on the resume", meta: "1 found", tone: "warn" },
        { primary: "Needs verification", secondary: "Team-lead scope is claimed but not evidenced", meta: "1 found", tone: "warn" },
      ],
    },
  },
  {
    key: "interviews",
    tab: "Interviews",
    nav: "Interviews",
    caption:
      "Schedule rounds, send invites through the connected calendar, and collect structured feedback.",
    panel: {
      title: "Interviews",
      meta: "This week",
      columns: ["Candidate", "Round", "Status"],
      rows: [
        { primary: "A. Sharma", secondary: "Video · Tomorrow, 10:00", meta: "Scheduled" },
        { primary: "M. Iyer", secondary: "Phone · Yesterday, 15:30", meta: "Feedback due", tone: "warn" },
        { primary: "R. Nair", secondary: "On-site · Thursday, 11:00", meta: "Scheduled" },
        { primary: "S. Bose", secondary: "Video · Monday, 09:00", meta: "Completed", tone: "good" },
      ],
    },
  },
  {
    key: "evaluation",
    tab: "Evaluation",
    nav: "Applications",
    caption:
      "Screening results, interview feedback and match score on one panel per application.",
    panel: {
      title: "Evaluation",
      meta: "A. Sharma · Senior Backend Engineer",
      columns: ["Stage", "Recorded by", "Result"],
      rows: [
        { primary: "Resume match", secondary: "Scored against the job's requirements", meta: "91 / 100", tone: "good", pct: 91 },
        { primary: "AI Screening Call", secondary: "Structured report from the call", meta: "8 / 10", tone: "good", pct: 80 },
        { primary: "Video Interview", secondary: "Panel feedback, two interviewers", meta: "7 / 10", pct: 70 },
        { primary: "Verdict", secondary: "A person decides — the panel only gathers", meta: "Needs Review", tone: "warn" },
      ],
    },
  },
  {
    key: "pipeline",
    tab: "Hiring workflow",
    nav: "Pipeline",
    caption:
      "A pipeline that shows what has moved, what is stuck, and what is waiting on somebody.",
    panel: {
      title: "Hiring pipeline",
      meta: "Senior Backend Engineer",
      columns: ["Stage", "In stage", "SLA"],
      rows: [
        { primary: "Applied", secondary: "124 in stage", meta: "On track", tone: "good", pct: 100 },
        { primary: "Shortlisted", secondary: "46 in stage", meta: "3 overdue", tone: "warn", pct: 37 },
        { primary: "AI Screening Call", secondary: "28 in stage", meta: "On track", tone: "good", pct: 23 },
        { primary: "Video Interview", secondary: "9 in stage", meta: "2 awaiting feedback", tone: "warn", pct: 7 },
      ],
    },
  },
];

export const PLATFORM_HEAD = {
  eyebrow: "The Scoreboad platform",
  title: "Everything you need to manage hiring in one workspace.",
  lead:
    "Jobs, candidates, AI screening, interviews, evaluation and the hiring " +
    "pipeline are six views of the same records — not six tools that have to be " +
    "kept in step. Pick one to see it.",
} as const;

/*
  WORKSPACE_CARDS LIVED HERE — six {icon, title, body} entries rendered as a
  card grid. The grid is gone (see PLATFORM_VIEWS, which shows the same six
  capabilities as product screens instead), and the six bodies moved verbatim
  into those views' `caption` fields.

  Deleted rather than left in place as an unused export: dead content data is
  worse than dead code, because the next person to edit the marketing copy has
  no way to tell which of two arrays the site is actually rendering.
*/

// -----------------------------------------------------------------------------
// The AI screening call — the voice story
// -----------------------------------------------------------------------------

/**
 * THE FEATURE IS AN AI SCREENING CALL, NOT AN "AI INTERVIEW".
 *
 * The brief for this section called it an AI voice interview throughout. In
 * this product those are two different things and conflating them would be a
 * claim about the wrong feature:
 *
 *   * `screening_calls` (Module 8) is the automated voice call. It is the
 *     FIRST conversation, it asks the job's own configured questions, and
 *     STAGE_LABELS calls the stage it belongs to "AI Screening Call".
 *   * `interviews` (Module 11) are the later rounds. They are conducted by
 *     PEOPLE, scheduled into a real calendar, and their modes are Video,
 *     Phone and On-site. No model conducts one.
 *
 * So the section keeps the brief's H2 — "Let every candidate have a structured
 * first conversation" is exactly right for a screening call — and names the
 * feature the way the product does.
 *
 * WHAT IS REAL HERE, all of it read out of the schema and the script builder
 * before this copy was written:
 *
 *   supabase/migrations/0007 — screening_calls: one row per ATTEMPT, with
 *     status, transcript, recording_url, duration and consent_confirmed.
 *   supabase/migrations/0008 — screening_reports: summary, interest level,
 *     expected CTC, notice period, location acceptance, availability notes,
 *     plus `ai_*` mirror columns that are NEVER updated after insert,
 *     `uncertain_fields`, `corrected_fields`, reviewed_by and reviewed_at.
 *     A database trigger refuses to create one without consent.
 *   lib/screening/script.ts — the consent disclosure, always first, always
 *     present, compliance-checked before the provider is ever called.
 *   job_screening_questions — the questions are written by the hiring team.
 *
 * WHAT IS NOT REAL, and is therefore absent: a numeric score. A screening
 * report has no score column. Inventing one for the picture would be the
 * single easiest lie to tell in this section and the hardest for a reader to
 * check.
 */
export const VOICE_STAGES: { key: string; num: string; label: string; copy: string }[] = [
  {
    key: "start",
    num: "01",
    label: "Start",
    copy:
      "A screening call is queued against one application. Calling is disconnected " +
      "until somebody turns it on, and every attempt is counted against a cap — " +
      "so a candidate cannot be dialled repeatedly by a loop nobody is watching.",
  },
  {
    key: "connect",
    num: "02",
    label: "Connect",
    copy:
      "The first thing the candidate hears is that the call is automated and may " +
      "be recorded, and that they can stop it. That line is built by the same " +
      "function for every call and checked before the provider is contacted; there " +
      "is no setting that removes it.",
  },
  {
    key: "ask",
    num: "03",
    label: "Ask",
    copy:
      "The questions are the ones your team wrote on the job — not questions a " +
      "model invented on the call. Every role carries its own list, asked in the " +
      "order you set.",
  },
  {
    key: "respond",
    num: "04",
    label: "Respond",
    copy:
      "Answers are captured as a transcript against the application, with the " +
      "recording kept beside it. Nothing is treated as usable until the consent " +
      "flag on the call is true — a database rule, not a code convention.",
  },
  {
    key: "understand",
    num: "05",
    label: "Understand",
    copy:
      "The conversation becomes a structured report: interest, expected pay, " +
      "notice period, whether the location works. Anything the model was unsure " +
      "of is flagged as uncertain rather than guessed at.",
  },
  {
    key: "review",
    num: "06",
    label: "Review",
    copy:
      "A recruiter reads it and corrects what is wrong. What the AI originally " +
      "said is kept unchanged alongside, so the edit is always visible — and the " +
      "candidate was told on the call that a person would be reviewing it.",
  },
];

/**
 * The transcript, with the consent line quoted VERBATIM from
 * lib/screening/script.ts. It is the most reassuring thing this product says
 * to a candidate and paraphrasing it into marketing prose would waste it.
 *
 * `at` is the stage the line belongs to. Everything else is synthetic
 * demonstration content and the component labels it as such.
 */
export const VOICE_TRANSCRIPT: { at: number; who: "ai" | "candidate"; text: string }[] = [
  {
    at: 1,
    who: "ai",
    text:
      "Hello, am I speaking with A. Sharma? I'm an automated assistant calling on " +
      "behalf of Northwind about your application for the Senior Backend Engineer " +
      "role. Before we start: this is an automated call and it may be recorded so a " +
      "recruiter can review it. If you'd rather not continue, just say so and I'll " +
      "end the call and arrange for a person to contact you instead.",
  },
  { at: 1, who: "candidate", text: "That's fine, go ahead." },
  {
    at: 2,
    who: "ai",
    text: "Thank you. This will take about five minutes. I'll ask a few short questions about your experience and availability.",
  },
  {
    at: 2,
    who: "ai",
    text: "What is your current notice period, and when could you realistically start?",
  },
  {
    at: 3,
    who: "candidate",
    text: "I'm on thirty days, and I could probably start the first week after that.",
  },
  {
    at: 3,
    who: "ai",
    text: "The role is remote with occasional travel to Pune. Does that work for you?",
  },
  { at: 3, who: "candidate", text: "Remote is what I'm looking for. Travel now and then is no problem." },
  {
    at: 5,
    who: "ai",
    text: "That's everything — thank you for your time. A recruiter from Northwind will review this and be in touch about next steps.",
  },
];

/**
 * The structured report.
 *
 * These five fields are the actual columns of `screening_reports`, and
 * `uncertain` marks the ones that would land in `uncertain_fields`. `corrected`
 * shows the pair the schema keeps forever: what the model said, and what the
 * recruiter changed it to.
 */
export const VOICE_REPORT: {
  field: string;
  value: string;
  uncertain?: boolean;
  corrected?: { from: string; by: string };
}[] = [
  { field: "Interest level", value: "High" },
  { field: "Notice period", value: "30 days" },
  { field: "Location accepted", value: "Accepted" },
  {
    field: "Expected CTC",
    value: "Not stated on the call",
    uncertain: true,
  },
  {
    field: "Availability",
    value: "From the first week after notice",
    corrected: { from: "Immediately available", by: "R. Menon" },
  },
];

export const VOICE_HEAD = {
  eyebrow: "AI screening calls",
  title: "Let every candidate have a structured first conversation.",
  lead:
    "Scoreboad can run the first-round call for you — the questions your team " +
    "wrote, asked the same way every time, captured as a transcript and returned " +
    "as a structured report against the application. A recruiter reads it and " +
    "decides what happens next.",
} as const;

/**
 * Three, not four. The brief's fourth suggestion was interview scheduling,
 * which is real but belongs to a later module — and, more to the point, is not
 * part of this story: nothing about scheduling a human round happens on an
 * automated call.
 */
export const VOICE_CALLOUTS: (HomeCard & { href: string })[] = [
  {
    title: "Questions you wrote",
    // job_screening_questions — per job, ordered, capped at MAX_QUESTIONS.
    body:
      "Each job carries its own screening questions, asked in the order you set. " +
      "Up to twelve per role.",
    icon: "ClipboardCheck",
    href: "/product/source",
  },
  {
    title: "Transcript and recording",
    // screening_calls.transcript / recording_url, behind the consent gate.
    body:
      "Every call is captured against the application, and nothing is usable " +
      "until the candidate has been told and has agreed to carry on.",
    icon: "PhoneCall",
    href: "/product/screen",
  },
  {
    title: "A report a person edits",
    // screening_reports: ai_* columns are never updated; corrected_fields records edits.
    body:
      "Interest, notice, pay and location come back as fields. What the AI said " +
      "is kept beside what your recruiter changed it to.",
    icon: "ClipboardCheck",
    href: "/product/decide",
  },
];

// -----------------------------------------------------------------------------
// The candidate workspace — one candidate, six views
// -----------------------------------------------------------------------------

/**
 * THE SIX VIEWS ARE THE PRODUCT'S OWN.
 *
 * Read off the real screens before any of this copy was written:
 *
 *   Profile     app/candidates/[id] — the Profile card's own fields
 *   Resumes     app/candidates/[id]/ResumesCard
 *   Screening   app/applications/[id]/screening-report
 *   Interviews  app/applications/[id] — the Interviews section
 *   Evaluation  app/applications/[id]/EvaluationPanel
 *   Activity    app/candidates/[id]/activity — Timeline
 *
 * The brief's sixth stage was "Review". That is not a separate screen in this
 * product: reviewing IS the evaluation panel, and what survives the review is
 * the activity timeline. So the sixth view is Activity, and the evaluation view
 * carries the verdict — which keeps the journey ending on a person rather than
 * on a score, the thing §22 asks for.
 */
export const CANDIDATE_STAGES: {
  key: string;
  num: string;
  label: string;
  /** The left-hand explanation for this view. */
  copy: string;
}[] = [
  {
    key: "profile",
    num: "01",
    label: "Profile",
    copy:
      "One record per person, not one per application. Contact details, current " +
      "role, experience, expected salary and notice period live here — and stay " +
      "here when the same person applies for a second job.",
  },
  {
    key: "resume",
    num: "02",
    label: "Resume",
    copy:
      "Resumes are parsed into structured fields, and the proposed values are " +
      "shown as a diff against what is already on the record. A person applies " +
      "them; nothing is written to a candidate by a model alone.",
  },
  {
    key: "screening",
    num: "03",
    label: "Screening",
    copy:
      "The screening call's report lands on the application: interest, notice, " +
      "expected pay, whether the location works. What the AI said is kept beside " +
      "what a recruiter corrected it to.",
  },
  {
    key: "interviews",
    num: "04",
    label: "Interviews",
    copy:
      "Rounds, their mode and their outcome, with structured feedback captured " +
      "per interviewer — so two people's opinions can actually be compared " +
      "rather than read.",
  },
  {
    key: "evaluation",
    num: "05",
    label: "Evaluation",
    copy:
      "Every signal on one panel: the resume match, the screening result and the " +
      "interview feedback, with the strengths and concerns each contributed. The " +
      "verdict is a person's.",
  },
  {
    key: "activity",
    num: "06",
    label: "Activity",
    copy:
      "An append-only record of what happened and who did it. Every line below " +
      "is a real event type this product writes — it is the audit log, not a " +
      "marketing summary of one.",
  },
];

/**
 * The protagonist. SYNTHETIC, and the same person the hero, the platform
 * showcase and the screening-call story already follow — so the homepage reads
 * as one candidate moving through one product rather than four demos.
 *
 * Fields are exactly the Profile card's: app/candidates/[id]/page.tsx renders
 * Email, Phone, Location, Current company, Current role, Total experience,
 * Expected salary, Notice period and Added. Email and phone are omitted here
 * rather than invented — a fake address on a public page is a small lie with a
 * real chance of belonging to somebody.
 */
export const CANDIDATE_PROFILE = {
  name: "A. Sharma",
  role: "Backend Engineer",
  fields: [
    { label: "Current role", value: "Backend Engineer" },
    { label: "Current company", value: "Northwind Labs" },
    { label: "Location", value: "Pune, IN" },
    { label: "Total experience", value: "7 years" },
    { label: "Expected salary", value: "Not stated" },
    { label: "Notice period", value: "30 days" },
  ],
} as const;

/**
 * What each view shows. One shape, six fills — the panel morphs rather than
 * being six different panels.
 *
 * `rows` are label/value pairs; `note` is the one line of context the real
 * screen carries under them.
 */
export const CANDIDATE_VIEWS: Record<
  string,
  { rows: { label: string; value: string; tone?: "good" | "warn" }[]; note: string }
> = {
  profile: {
    rows: CANDIDATE_PROFILE.fields.map((field) => ({ ...field })),
    note: "Two applications on file. The record is the person, not the application.",
  },
  resume: {
    rows: [
      { label: "Resume", value: "sharma-backend.pdf · parsed" },
      { label: "Skills found", value: "Go · PostgreSQL · Kafka · AWS" },
      { label: "Experience", value: "3 roles extracted" },
      { label: "Proposed change", value: "Notice period 60 → 30 days", tone: "warn" },
    ],
    note: "Parsed fields are proposed as a diff. A person applies them.",
  },
  screening: {
    rows: [
      { label: "Call", value: "Completed · 4m 51s" },
      { label: "Interest level", value: "High", tone: "good" },
      { label: "Location accepted", value: "Accepted", tone: "good" },
      { label: "Expected CTC", value: "Flagged uncertain", tone: "warn" },
    ],
    note: "Report reviewed by R. Menon. The AI's original answers are kept alongside.",
  },
  interviews: {
    rows: [
      { label: "Round 1", value: "Video · Completed", tone: "good" },
      { label: "Feedback", value: "2 of 2 submitted", tone: "good" },
      { label: "Round 2", value: "Director Round · Scheduled" },
      { label: "Brief", value: "Generated from the resume and round 1" },
    ],
    note: "Feedback is captured in a fixed shape, so two interviewers can be compared.",
  },
  evaluation: {
    rows: [
      { label: "Resume match", value: "91 / 100", tone: "good" },
      { label: "Screening", value: "High interest, notice confirmed", tone: "good" },
      { label: "Interview", value: "Strong on systems, light on Kubernetes", tone: "warn" },
      { label: "Verdict", value: "Needs Review — set by R. Menon" },
    ],
    note: "Three sources on one panel. The verdict is recorded against a person.",
  },
  activity: {
    rows: [
      { label: "Applied", value: "12 days ago" },
      { label: "Resume parsed", value: "12 days ago" },
      { label: "Parsed fields reviewed", value: "11 days ago" },
      { label: "Screening report reviewed", value: "6 days ago" },
    ],
    note: "Append-only. Every entry names who did it and cannot be edited afterwards.",
  },
};

/**
 * The timeline down the side of the workspace.
 *
 * EVERY LABEL IS A REAL EVENT TYPE from lib/activity/events.ts — "Resume
 * parsed", "Parsed fields reviewed", "Match calculated", "Screening report
 * reviewed", "Interview feedback submitted", "Stage changed". They are what
 * the audit log actually writes, which is why they can be shown as a
 * candidate's history without inventing a single one.
 *
 * `at` is the view that highlights it.
 */
export const CANDIDATE_TIMELINE: { at: string; label: string; by: string }[] = [
  { at: "profile", label: "Applied", by: "Career page" },
  { at: "resume", label: "Resume parsed", by: "AI" },
  { at: "resume", label: "Parsed fields reviewed", by: "R. Menon" },
  { at: "screening", label: "Match calculated", by: "Code + AI" },
  { at: "screening", label: "Screening report reviewed", by: "R. Menon" },
  { at: "interviews", label: "Interview scheduled", by: "R. Menon" },
  { at: "interviews", label: "Interview feedback submitted", by: "2 interviewers" },
  { at: "evaluation", label: "Stage changed", by: "R. Menon" },
];

export const CANDIDATE_HEAD = {
  eyebrow: "Candidate workspace",
  title: "Everything about a candidate, in one place.",
  lead:
    "One record per person, carrying every application they hold — the parsed " +
    "resume, the screening report, each interview round and the evaluation that " +
    "draws on all three. One candidate, one complete picture.",
} as const;

export const CANDIDATE_CALLOUTS: (HomeCard & { href: string })[] = [
  {
    title: "Candidate profiles",
    // Module 4 — one record per person, deduplicated on contact details.
    body:
      "One record per person, deduplicated on contact details, carrying every " +
      "application they have ever held with you.",
    icon: "Users",
    href: "/product/source",
  },
  {
    title: "Resume intelligence",
    // lib/ai/parseResume.ts, applied through a review diff.
    body:
      "Resumes parsed into fields and proposed as a diff, so what changes on a " +
      "record is always something a person approved.",
    icon: "FileSearch",
    href: "/product/understand",
  },
  {
    title: "Candidate evaluation",
    // app/applications/[id]/EvaluationPanel — match, screening, feedback.
    body:
      "Match score, screening result and interview feedback on one panel, with " +
      "the strengths and concerns each one contributed.",
    icon: "Gauge",
    href: "/product/decide",
  },
  {
    title: "Activity history",
    // lib/activity — append-only, actor-attributed.
    body:
      "An append-only log of every change, naming who made it. It cannot be " +
      "edited after the fact, by anyone.",
    icon: "Activity",
    href: "/how-it-works",
  },
];

// -----------------------------------------------------------------------------
// The hiring pipeline — a board a candidate crosses
// -----------------------------------------------------------------------------

/**
 * SIX COLUMNS, AND SIX IS ITSELF A PRODUCT FACT.
 *
 * `PIPELINE_STAGES` has eight: applied, shortlisted, ai_screening_call,
 * phone_interview, video_interview, written_assessment, director_round, hired.
 * FOUR of them are configurable per job (CONFIGURABLE_STAGES) — a board shows
 * only the ones that job has switched on. This one has Phone Interview and
 * Written Assessment off, which is why it has six columns and not eight, and
 * the caption says so rather than leaving it looking like the whole product.
 *
 * THERE IS NO "OFFER" STAGE, so there is no Offer column. The brief's flow
 * ended "…Review → Offer → Hired"; in this product an offer is an automation
 * ACTION (`send_offer_letter`) and onboarding is its own module. Inventing the
 * column would have put a stage on the marketing page that a recruiter opening
 * the board would then go looking for.
 *
 * Counts are synthetic and the board says so.
 */
export const PIPELINE_COLUMNS: {
  key: string;
  /** The real STAGE_LABELS value. */
  label: string;
  /**
   * EXCLUDING THE TRAVELLING CANDIDATE, who is counted into whichever column
   * currently holds them — see pipelineCountAt(). Storing the base this way is
   * what lets a stage move decrement one column and increment the next, which
   * is the behaviour a real board has and the thing that makes the movement
   * read as a move rather than as a duplicate.
   */
  count: number;
  /** Real SLA target from DEFAULT_SLA_DAYS, in days. null for terminal. */
  targetDays: number | null;
}[] = [
  { key: "applied", label: "Applied", count: 123, targetDays: 2 },
  { key: "shortlisted", label: "Shortlisted", count: 46, targetDays: 3 },
  { key: "ai_screening_call", label: "AI Screening Call", count: 28, targetDays: 3 },
  { key: "video_interview", label: "Video Interview", count: 9, targetDays: 7 },
  { key: "director_round", label: "Director Round", count: 4, targetDays: 7 },
  { key: "hired", label: "Hired", count: 1, targetDays: null },
];

/**
 * What a column's counter reads at a given beat.
 *
 * The travelling candidate is a real occupant of exactly one column at a time,
 * so the source loses them and the destination gains them. A board where the
 * numbers never moved would be showing a card sliding over the top of a static
 * picture.
 *
 * Exported so the test can assert the invariant that matters — the funnel
 * never widens, at ANY beat — rather than only checking the base array.
 */
export function pipelineCountAt(columnIndex: number, beat: number): number {
  const base = PIPELINE_COLUMNS[columnIndex].count;
  const travellerAt = PIPELINE_BEATS[beat]?.at;
  return base + (travellerAt === columnIndex ? 1 : 0);
}

/**
 * How many cards in a column have breached their stage target.
 *
 * REAL: `lib/pipeline/sla.ts` assesses every card against its stage's target
 * and returns `breached` past it. The board can therefore say "2 breaching
 * their target" on a column without claiming a bottleneck-detection feature
 * that does not exist — it is counting a status the product already computes.
 */
export function pipelineBreachesAt(columnIndex: number): number {
  return PIPELINE_CARDS.filter(
    (card) => card.at === columnIndex && card.sla === "breached"
  ).length;
}

/**
 * The exits.
 *
 * Rejected and withdrawn are shown as COUNTS rather than as columns, which is
 * what the real board does — app/pipeline/PipelineBoard.tsx: "otherwise the
 * board fills with finished work and stops being a work queue." It is a small
 * decision that says a lot about the product, and it costs one line to show.
 */
export const PIPELINE_EXITS: { label: string; count: number }[] = [
  { label: "rejected", count: 31 },
  { label: "withdrawn", count: 6 },
];

/**
 * The six beats of the scroll story.
 *
 * `at` is the column the travelling candidate occupies at that beat. The card
 * is rendered once and translated, so it genuinely crosses the board rather
 * than being destroyed and recreated somewhere else.
 */
export const PIPELINE_BEATS: {
  key: string;
  num: string;
  label: string;
  /** Index into PIPELINE_COLUMNS. */
  at: number;
  copy: string;
}[] = [
  {
    key: "enter",
    num: "01",
    label: "Applied",
    at: 0,
    copy:
      "Every application lands in the same first column, however it arrived — " +
      "career page, bulk upload, referral or added by hand.",
  },
  {
    key: "shortlist",
    num: "02",
    label: "Shortlisted",
    at: 1,
    copy:
      "A resume that clears the job's passing mark moves to Shortlisted. One that " +
      "does not is flagged rather than deleted, and the flag can be cleared.",
  },
  {
    key: "screen",
    num: "03",
    label: "Screening",
    at: 2,
    copy:
      "An automation can start the screening call when someone reaches this " +
      "stage. `move_to_stage` and `start_screening_call` are real actions — the " +
      "board moves on its own only where you have said it should.",
  },
  {
    key: "age",
    num: "04",
    label: "Aging",
    at: 3,
    copy:
      "Every card is aged against its stage's target — two days in Applied, three " +
      "in Shortlisted, a week in the interview rounds. Past three quarters of the " +
      "target a card is at risk; past the target it has breached.",
  },
  {
    key: "move",
    num: "05",
    label: "Moved",
    at: 4,
    copy:
      "A person moves the card, from a menu on the card itself. There is no drag " +
      "and drop, deliberately: a dropdown works with a keyboard and on a phone, " +
      "and it cannot fire from a mis-drag.",
  },
  {
    key: "hired",
    num: "06",
    label: "Hired",
    at: 5,
    copy:
      "Hired is a stage; rejected and withdrawn are exits, counted at the foot of " +
      "the board rather than given columns. A board full of finished work stops " +
      "being a work queue.",
  },
];

/**
 * The other cards on the board. SYNTHETIC.
 *
 * `sla` uses the real SlaStatus vocabulary — ok / at_risk / breached — so the
 * badges say what the product's badges say. The breached one sits in Director
 * Round, which is where a real board's oldest work collects.
 */
export const PIPELINE_CARDS: {
  id: string;
  name: string;
  role: string;
  at: number;
  sla: "ok" | "at_risk" | "breached";
  slaLabel: string;
}[] = [
  { id: "iyer", name: "M. Iyer", role: "Platform Engineer", at: 1, sla: "ok", slaLabel: "1 day in stage" },
  { id: "reddy", name: "K. Reddy", role: "Backend Engineer", at: 2, sla: "at_risk", slaLabel: "Day 3 of 3" },
  { id: "bose", name: "S. Bose", role: "Data Analyst", at: 3, sla: "ok", slaLabel: "2 days in stage" },
  { id: "nair", name: "R. Nair", role: "Product Designer", at: 4, sla: "breached", slaLabel: "4 days over" },
  { id: "das", name: "P. Das", role: "Backend Engineer", at: 4, sla: "breached", slaLabel: "6 days over" },
];

export const PIPELINE_HEAD = {
  eyebrow: "Hiring pipeline",
  title: "See every candidate move from application to decision.",
  lead:
    "One board per job, with every application on it and every card aged " +
    "against the target you set for its stage — so what has stalled is visible " +
    "before somebody asks.",
} as const;

/** The job the board belongs to. Consistent with the rest of the page. */
export const PIPELINE_JOB = {
  title: "Senior Backend Engineer",
  meta: "213 active · 2 hired",
} as const;

export const PIPELINE_CALLOUTS: (HomeCard & { href: string })[] = [
  {
    title: "Stage SLAs",
    // lib/pipeline/sla.ts — per-stage targets, at-risk at 75%, breached past it.
    body:
      "A target per stage, with a card marked at risk at three quarters of it " +
      "and breached past it. Defaults apply until you change them.",
    icon: "Gauge",
    href: "/product/decide",
  },
  {
    title: "Deliberate moves",
    // app/pipeline/PipelineBoard.tsx — a menu, not drag and drop.
    body:
      "Stage changes come from a menu on the card, so they work with a keyboard, " +
      "work on a phone, and cannot happen by accident.",
    icon: "Workflow",
    href: "/product/operate",
  },
  {
    title: "Automations you set",
    // lib/automations — move_to_stage, start_screening_call, notify_recruiter.
    body:
      "Rules can move a card, start a screening call or notify a recruiter — and " +
      "an approval step where the action is one you would want to see first.",
    icon: "Zap",
    href: "/product/operate",
  },
];

// -----------------------------------------------------------------------------
// Candidate applications — the public form, and what happens after Submit
// -----------------------------------------------------------------------------

/**
 * THE FIELDS ARE THE PRODUCT'S FIELDS, from DEFAULT_APPLICATION_FIELDS in
 * lib/forms/fields.ts — every job's form is auto-created with exactly these
 * thirteen, in this order. Six are shown here; the caption says how many there
 * are rather than letting six look like the whole form.
 *
 * `email` and `resume` are marked required because they genuinely are:
 * PROTECTED_FIELD_KEYS, enforced by migration 0033, and a form cannot be saved
 * without them. Email is what duplicate matching runs on.
 */
export const APPLY_FIELDS: {
  label: string;
  value: string;
  type: string;
  required?: boolean;
  /** The beat at which this field fills in. */
  at: number;
}[] = [
  { label: "First name", value: "A.", type: "text", required: true, at: 0 },
  { label: "Last name", value: "Sharma", type: "text", required: true, at: 0 },
  { label: "Email address", value: "a.sharma@example.invalid", type: "email", required: true, at: 0 },
  { label: "Current job title", value: "Backend Engineer", type: "text", at: 0 },
  { label: "Total years of experience", value: "7", type: "number", at: 0 },
  { label: "Notice period (days)", value: "30", type: "number", at: 0 },
];

/**
 * The six beats, and their order is `lib/forms/submit.ts`'s order rather than
 * the obvious one.
 *
 * The obvious story — fill a form, AI reads the resume, a profile appears — is
 * not what this product does, and the difference is the most interesting thing
 * in the module. Three rules from that file's header, quoted in substance:
 *
 *   1. The answers are saved FIRST, before storage, before the model, before
 *      the candidate insert. "A downstream failure loses a link, never a
 *      submission."
 *   2. AI failure is not submission failure. The candidate and application are
 *      created from the TYPED answers; an unparsed resume is simply filed.
 *   3. An existing candidate is never overwritten — not by the parsed resume
 *      and not by the typed answers. "A public form is an unauthenticated
 *      claim about a record a human established."
 *
 * So the story ends on a PROPOSAL queued for a recruiter, not on a profile the
 * model rewrote. That is also what connects it to the candidate workspace
 * band, whose Resume view already shows a proposed change awaiting approval.
 */
export const APPLY_BEATS: {
  key: string;
  num: string;
  label: string;
  copy: string;
}[] = [
  {
    key: "apply",
    num: "01",
    label: "Apply",
    copy:
      "Every job gets its own application form, created with the same thirteen " +
      "fields and shared as a link. No account, no login — a candidate opens it " +
      "and types.",
  },
  {
    key: "resume",
    num: "02",
    label: "Resume",
    copy:
      "A resume is required, and it is the only file the form accepts. Custom " +
      "questions can be added to any form; a custom FILE upload cannot, because " +
      "a form that collects someone's documents and drops them is worse than one " +
      "that never offered.",
  },
  {
    key: "saved",
    num: "03",
    label: "Saved",
    copy:
      "The answers are written down before anything that can fail — before the " +
      "file is stored, before a model is called. Someone has typed for five " +
      "minutes on a phone; a failure after this point loses a link, never their " +
      "submission.",
  },
  {
    key: "created",
    num: "04",
    label: "Created",
    copy:
      "The candidate and the application are created from what they typed, and " +
      "matched against everyone already on file by normalised email and phone. " +
      "This happens whether or not the resume could be read.",
  },
  {
    key: "parsed",
    num: "05",
    label: "Parsed",
    copy:
      "Then the resume is parsed. A scanned PDF with no text layer, a provider " +
      "outage, a rate limit — all normal, and none of them fail the application. " +
      "The file is simply filed unparsed.",
  },
  {
    key: "proposed",
    num: "06",
    label: "Proposed",
    copy:
      "What the parse found is queued as a proposal, not written to the record. " +
      "An existing candidate is never overwritten — not by the model, and not by " +
      "the form either. A recruiter decides what lands.",
  },
];

/**
 * The right-hand side: what exists inside Scoreboad at each beat.
 *
 * `state` drives the tone. "pending" is genuinely pending — these rows appear
 * in the order the submission pipeline creates them.
 */
export const APPLY_RECORDS: {
  label: string;
  value: string;
  at: number;
  state?: "good" | "warn";
}[] = [
  { label: "Form response", value: "Saved — 6 answers", at: 2, state: "good" },
  { label: "Resume file", value: "sharma-backend.pdf · filed", at: 2, state: "good" },
  { label: "Candidate", value: "New record — no duplicate found", at: 3, state: "good" },
  { label: "Application", value: "Senior Backend Engineer · Applied", at: 3, state: "good" },
  { label: "Resume parse", value: "Skills, 3 roles, education", at: 4, state: "good" },
  { label: "Proposed change", value: "Awaiting review — nothing written yet", at: 5, state: "warn" },
];

export const APPLY_HEAD = {
  eyebrow: "Candidate applications",
  title: "Make it easy for candidates to enter your hiring workflow.",
  lead:
    "Every job gets a shareable application form. What a candidate types is " +
    "saved before anything else happens, becomes a real candidate record, and " +
    "what the resume adds to it waits for a person to approve.",
} as const;

export const APPLY_CALLOUTS: (HomeCard & { href: string })[] = [
  {
    title: "A form for every job",
    // DEFAULT_APPLICATION_FIELDS — 13 fields, auto-created per job.
    body:
      "Thirteen fields by default, from name and email through to notice period, " +
      "with your own questions added on top.",
    icon: "ClipboardCheck",
    href: "/product/source",
  },
  {
    title: "A link, not a login",
    // app/apply/[token] — signed token, rate-limited, no account required.
    body:
      "Share one link. Candidates never make an account, and the public endpoint " +
      "is rate-limited rather than left open.",
    icon: "KeyRound",
    href: "/how-it-works",
  },
  {
    title: "Answers become the record",
    // CANDIDATE_COLUMN_BY_KEY — answers map to candidate columns directly.
    body:
      "Typed answers map straight onto candidate fields, and the person is " +
      "matched against everyone on file by normalised email and phone.",
    icon: "Users",
    href: "/product/understand",
  },
  {
    title: "Nothing lands unreviewed",
    // submit.ts rule 3 — proposals queue in resume_parse_results.
    body:
      "What the resume adds is queued as a proposal. An existing candidate is " +
      "never overwritten by a form or by a model.",
    icon: "ShieldCheck",
    href: "/product/decide",
  },
];

// -----------------------------------------------------------------------------
// Recruitment automation — one rule, running
// -----------------------------------------------------------------------------

/**
 * THE GRAPH IS ONE REAL RULE, and every node in it is a real part of the
 * engine. Verified against lib/automations before any of this was written:
 *
 *   trigger      TRIGGER_LABELS.screening_call_completed —
 *                "A screening call completes". TRIGGER_MODES marks it
 *                `service`: Bolna's webhook, so nobody is signed in.
 *   conditions   CONDITION_FIELDS — interest_level, screening_consent_confirmed.
 *   approval     approvals.ts — `requires_approval` parks the run at
 *                `awaiting_approval` with the actions SNAPSHOTTED, and the
 *                proposal expires after seven days.
 *   wait         lib/workflow/delay.ts — delay_minutes, 1 minute to 30 days,
 *                with a basis of `after` / `before_scheduled_call` /
 *                `before_interview`.
 *   actions      ACTION_LABELS.move_to_stage, .send_candidate_email.
 *
 * THE APPROVAL IS NOT DECORATION AND IT IS NOT MID-RUN. A rule that requires
 * approval does not act at all — it proposes, and the whole run waits. Putting
 * the gate anywhere else in this graph would misdescribe the engine, and it is
 * also the single best answer to "does this thing email my candidates by
 * itself".
 */
export const FLOW_NODES: {
  key: string;
  kind: "trigger" | "condition" | "approval" | "wait" | "action" | "candidate";
  label: string;
  /** The one-line detail shown when the node is opened. */
  detail: string;
  /**
   * For an action node, the real ACTION_LABELS value it is an instance of.
   *
   * `label` is the CONFIGURED form — "Move to Video Interview" — because that
   * is what a built rule reads like on screen. `action` is the generic action
   * it was built from, and a test checks it against the catalog. Without this
   * the two could drift: a display label nobody can find in the action list
   * would look real and not be.
   */
  action?: string;
  /** Beat at which the node joins the graph. */
  at: number;
}[] = [
  {
    key: "trigger",
    kind: "trigger",
    label: "A screening call completes",
    detail:
      "Fires when the voice provider reports a finished call. Nobody is signed " +
      "in for this one, so the engine runs it with a service client and only " +
      "the actions it can perform itself are available.",
    at: 0,
  },
  {
    key: "conditions",
    kind: "condition",
    label: "Interest is High · consent confirmed",
    detail:
      "Conditions are read off the application at the moment the trigger " +
      "arrives. A rule that does not match simply does not run — it is not an " +
      "error and nothing is logged against the candidate.",
    at: 1,
  },
  {
    key: "approval",
    kind: "approval",
    label: "Waiting for a recruiter",
    detail:
      "This rule requires approval, so it does not act — it proposes. The run " +
      "parks and the actions are snapshotted, so what somebody approves is " +
      "exactly what they read, even if the rule is edited in between. A " +
      "proposal nobody answers expires after seven days, and lapsing is " +
      "recorded separately from being rejected.",
    at: 2,
  },
  {
    key: "wait",
    kind: "wait",
    label: "Wait 30 minutes",
    detail:
      "A wait is a whole number of minutes, from one minute to thirty days, " +
      "measured either from the other actions or from a scheduled call or " +
      "interview. A pending wait is cancelled if the application changes stage " +
      "— the reason for it has gone.",
    at: 3,
  },
  {
    key: "move",
    kind: "action",
    label: "Move to Video Interview",
    action: "Move to a stage",
    detail:
      "The stage change is recorded against the application with the rule as " +
      "its actor, so the activity log shows what moved this person and why.",
    at: 4,
  },
  {
    key: "email",
    kind: "action",
    label: "Email the candidate a stage update",
    action: "Email the candidate a stage update",
    detail:
      "Sent from an approved template. Email is disconnected until somebody " +
      "connects it, and the candidate's opt-out is checked before anything " +
      "leaves.",
    at: 4,
  },
  {
    key: "candidate",
    kind: "candidate",
    label: "A. Sharma · Video Interview",
    detail:
      "The same candidate the rest of this page follows. The card's stage is " +
      "what the rule changed; everything else on the record is untouched.",
    at: 5,
  },
];

/**
 * The seven beats.
 *
 * Beat 6 has no new node — it is the finished graph, which is what §6's last
 * stage asks for and also the only moment a reader sees the whole rule at once.
 */
export const FLOW_BEATS: { key: string; num: string; label: string; copy: string }[] = [
  {
    key: "trigger",
    num: "01",
    label: "Trigger",
    copy:
      "Nine things can start a rule, and this is one of them: a screening call " +
      "finishing. The voice provider calls back, so there is no signed-in user " +
      "behind it — the engine knows that and limits itself to what it can do " +
      "on its own.",
  },
  {
    key: "conditions",
    num: "02",
    label: "Conditions",
    copy:
      "Conditions are checked against the application as it stands. A rule that " +
      "does not match does not run, and that is a non-event — nothing is logged " +
      "against the candidate and nothing is retried.",
  },
  {
    key: "approval",
    num: "03",
    label: "Proposal",
    copy:
      "This rule requires approval, so it does not act. It proposes, and the " +
      "run stops here. Nothing has been sent, nothing has moved, and nothing " +
      "will until a person says so.",
  },
  {
    key: "approved",
    num: "04",
    label: "Approved",
    copy:
      "A recruiter reads the proposal and approves it. What they approve is a " +
      "snapshot taken when it was raised — editing the rule in the meantime " +
      "cannot change what their click authorises. Left unanswered, a proposal " +
      "lapses after seven days rather than firing late.",
  },
  {
    key: "wait",
    num: "05",
    label: "Wait",
    copy:
      "Then the wait runs, on a scheduler rather than a timer in somebody's " +
      "browser. If the application changes stage while it is pending, the wait " +
      "is cancelled — the thing it was waiting for has already happened.",
  },
  {
    key: "actions",
    num: "06",
    label: "Actions",
    copy:
      "The stage moves and the candidate gets a templated update. Both are " +
      "recorded against the application with the rule named as the actor, so " +
      "the history says what changed this and why.",
  },
  {
    key: "done",
    num: "07",
    label: "Complete",
    copy:
      "One rule, end to end: an event nobody was present for, a gate a person " +
      "had to open, and two actions recorded under the rule's name. Automation " +
      "that keeps the process moving without deciding anything.",
  },
];

/**
 * The run log. Timestamps are synthetic and the panel says so; the STATUSES
 * are the engine's own — a run is proposed, approved, waiting, done.
 */
export const FLOW_LOG: { at: number; time: string; text: string; tone?: "good" | "warn" }[] = [
  { at: 0, time: "09:41", text: "Screening call completed" },
  { at: 1, time: "09:41", text: "Rule matched — 2 conditions" },
  { at: 2, time: "09:41", text: "Awaiting approval — actions snapshotted", tone: "warn" },
  { at: 3, time: "09:52", text: "Approved by R. Menon", tone: "good" },
  { at: 4, time: "10:22", text: "Wait finished — 30 minutes" },
  { at: 5, time: "10:22", text: "Stage changed to Video Interview", tone: "good" },
  { at: 5, time: "10:22", text: "Candidate email sent", tone: "good" },
];

export const FLOW_HEAD = {
  eyebrow: "Recruitment automation",
  title: "Keep hiring moving, even between conversations.",
  lead:
    "Rules run on the events your process already produces — a call finishing, " +
    "an application entering a stage, a week going by. They can move a " +
    "candidate, start a call or send a templated update, and the ones that " +
    "matter wait for a person first.",
} as const;

export const FLOW_CALLOUTS: (HomeCard & { href: string })[] = [
  {
    title: "Nine real triggers",
    // TRIGGERS in lib/automations/catalog.ts — all nine are wired.
    body:
      "From an application being created to one sitting in a stage too long. " +
      "Each one says where it is dispatched from, so you can tell whether your " +
      "rule will actually fire.",
    icon: "Zap",
    href: "/product/operate",
  },
  {
    title: "Approval before action",
    // approvals.ts — snapshotted actions, seven-day expiry.
    body:
      "A rule can be made to propose rather than act. The actions are frozen " +
      "when the proposal is raised, so approving it cannot authorise something " +
      "you did not read.",
    icon: "ShieldCheck",
    href: "/how-it-works#ai-safety",
  },
  {
    title: "Waits that get cancelled",
    // lib/workflow/delay.ts — 1 min to 30 days, cancelled on stage change.
    body:
      "A minute to thirty days, measured from the actions or from a booked " +
      "call. If the candidate moves on while a wait is pending, it is dropped.",
    icon: "CalendarCheck",
    href: "/product/decide",
  },
  {
    title: "One clock, not many",
    // A single scheduled sweep drains every time-based rule.
    body:
      "Every time-based rule drains from one scheduled sweep. No timers in a " +
      "browser tab, and no second clock to disagree with the first.",
    icon: "Activity",
    href: "/product/operate",
  },
];

// -----------------------------------------------------------------------------
// Integrations — five, verified one at a time
// -----------------------------------------------------------------------------

/**
 * EVERY NODE HERE WAS CHECKED AGAINST PROVIDER_DESCRIPTORS in
 * lib/settings/integrations.ts. Labels, descriptions and connect styles are
 * that file's, verbatim; `impact` is its `featureImpact` — the product's own
 * answer to "what stops working without this", which is a far better reason
 * for an integration to exist on a marketing page than a logo is.
 *
 * TWO THINGS ARE DELIBERATELY ABSENT.
 *
 *   n8n. There is an adapter for it in lib/integrations/n8n, and it is
 *   RETIRED: `CustomerFacingProvider` is literally `Exclude<Provider, "n8n">`,
 *   its automation action is in RETIRED_ACTIONS, and it has no descriptor. A
 *   customer cannot see or connect it, so it is not an integration this site
 *   may advertise.
 *
 *   Google Meet as its own node. Meet links are a capability OF the calendar
 *   integration — "Creates interview invites and Meet links" — not a separate
 *   connection. Giving it a node would double-count one OAuth grant and imply
 *   a second thing to set up.
 *
 * THE CATEGORIES ARE THE SETTINGS PAGE'S CATEGORIES, not new ones invented to
 * make five things look like a platform.
 */
export const INTEGRATIONS: {
  key: string;
  label: string;
  category: string;
  description: string;
  /** "oauth" or "api_key" — how credentials are actually supplied. */
  connect: string;
  /** What stops working without it. From featureImpact. */
  impact: string[];
  icon: string;
  /** Which quadrant of the network it sits in. */
  cell: "top" | "left" | "right" | "bottom-left" | "bottom-right";
}[] = [
  {
    key: "calendar",
    label: "Google Calendar",
    category: "Calling & scheduling",
    description: "Creates interview invites and Meet links.",
    connect: "Connected with Google sign-in",
    impact: [
      "Interview invites — interviews still schedule here, but nobody is invited",
      "Google Meet links on video interviews",
    ],
    icon: "CalendarCheck",
    cell: "top",
  },
  {
    key: "bolna",
    label: "Bolna AI",
    category: "Calling & scheduling",
    description: "Places automated screening calls to candidates.",
    connect: "Connected with an API key",
    impact: [
      "AI screening calls, manual and automated",
      "Screening reports, which are built from call transcripts",
    ],
    icon: "PhoneCall",
    cell: "left",
  },
  {
    key: "llm",
    label: "AI provider",
    category: "AI & automation",
    description: "Powers resume parsing, matching, summaries and drafting.",
    connect: "Connected with an API key",
    impact: [
      "Resume parsing, match scoring, screening reports and every AI draft",
      "Every manual workflow keeps working without it",
    ],
    icon: "Zap",
    cell: "right",
  },
  {
    key: "email",
    label: "Email",
    category: "Communication",
    description: "Delivers notifications and reminders outside the app.",
    connect: "Connected with an API key",
    impact: [
      "External email notifications — in-app notifications are unaffected",
      "Interview and feedback reminders by email",
    ],
    icon: "MessagesSquare",
    cell: "bottom-left",
  },
  {
    key: "whatsapp",
    label: "WhatsApp Business",
    category: "Communication",
    description: "Sends candidate messages over WhatsApp, alongside email.",
    connect: "Connected with an API key",
    impact: [
      "The WhatsApp half of any message template — the email half is unaffected",
      "Nothing else: templates, triggers and the communication log all keep working",
    ],
    icon: "MessagesSquare",
    cell: "bottom-right",
  },
];

export const INTEGRATIONS_HEAD = {
  eyebrow: "Integrations",
  title: "Connect the tools your hiring workflow already uses.",
  lead:
    "Five connections, and every one of them is off until you turn it on. Each " +
    "says plainly what stops working if you disconnect it — because the honest " +
    "answer is usually less than you would expect.",
} as const;

/**
 * The four points under the network.
 *
 * These are architecture facts rather than benefits, and that is the point:
 * "disconnected by default" and "credentials you cannot read back" are the
 * things a buyer actually wants to know about a connection to their calendar.
 */
export const INTEGRATIONS_CALLOUTS: (HomeCard & { href: string })[] = [
  {
    title: "Off until you connect it",
    // Every adapter is disconnected by default; nothing contacts anyone
    // before somebody explicitly enables it.
    body:
      "Nothing reaches a candidate until an integration is connected on " +
      "purpose. A fresh workspace sends nothing to anyone.",
    icon: "ShieldCheck",
    href: "/how-it-works#ai-safety",
  },
  {
    title: "Credentials you cannot read back",
    // lib/integrations/crypto.ts — AES-GCM, plus a column-level REVOKE.
    body:
      "Keys are encrypted before they are stored and the column is revoked, so " +
      "they cannot be read back out — not through the app, and not by a query.",
    icon: "KeyRound",
    href: "/how-it-works",
  },
  {
    title: "It tells you what breaks",
    // featureImpact, shown before disconnecting.
    body:
      "Before you disconnect anything, the product lists exactly which features " +
      "stop and which carry on regardless.",
    icon: "ClipboardCheck",
    href: "/product/operate",
  },
  {
    title: "The manual path still works",
    // The AI provider's own featureImpact says it outright.
    body:
      "Every integration is assistance, not a dependency. Without the AI " +
      "provider connected, every manual workflow keeps working.",
    icon: "UserCheck",
    href: "/product/understand",
  },
];

// -----------------------------------------------------------------------------
// Analytics — activity becoming insight
// -----------------------------------------------------------------------------

/**
 * THE NUMBERS ARE SYNTHETIC; THE SHAPE OF THEM IS NOT.
 *
 * Everything here mirrors app/analytics/page.tsx: the same KPI labels, the
 * same chart titles, and — most importantly — the same SUBTITLES, which are
 * the product's own precision statements about what each figure does and does
 * not mean. Those three sentences are the section's substance:
 *
 *   "Each step counts applications that ever reached it, not those sitting
 *    there now."
 *   "Median days, from closed stage visits only. A stage nobody has left yet
 *    shows no figure."
 *   "A source with too few candidates shows its raw counts instead of a
 *    percentage."
 *
 * A product that refuses to print a percentage it cannot support is the whole
 * argument for trusting its analytics, and it is already written down.
 *
 * The marketing section renders the REAL chart components from
 * app/analytics/charts.tsx rather than reimplementing them — see
 * AnalyticsShowcase.
 */

/** The raw events, before anything is counted. Synthetic, and labelled so. */
export const ANALYTICS_EVENTS: { label: string; meta: string; group: string }[] = [
  { label: "Application received", meta: "Senior Backend Engineer", group: "Applications" },
  { label: "Resume parsed", meta: "A. Sharma", group: "Applications" },
  { label: "Screening call completed", meta: "4m 51s", group: "Screening" },
  { label: "Screening report reviewed", meta: "R. Menon", group: "Screening" },
  { label: "Interview scheduled", meta: "Video · round 1", group: "Interviews" },
  { label: "Interview feedback submitted", meta: "2 interviewers", group: "Interviews" },
  { label: "Evaluation recorded", meta: "Needs Review", group: "Evaluation" },
  { label: "Stage changed", meta: "Director Round", group: "Evaluation" },
];

/** The four groups the events sort into. Matches the analytics page's sections. */
export const ANALYTICS_GROUPS = ["Applications", "Screening", "Interviews", "Evaluation"];

/** KPI tiles. Labels are app/analytics/page.tsx's, verbatim. */
export const ANALYTICS_KPIS: { label: string; value: string; hint?: string }[] = [
  { label: "Applications", value: "124" },
  { label: "Hired", value: "2" },
  { label: "Median time to hire", value: "24d" },
  { label: "Screening completion", value: "68%" },
];

/**
 * The funnel. `FunnelChart` renders these as concentric orbits from a shared
 * twelve o'clock start — see the reasoning in app/analytics/charts.tsx.
 *
 * Stage labels are real STAGE_LABELS values and the counts narrow, because a
 * funnel step counts everyone who EVER reached it.
 */
export const ANALYTICS_FUNNEL: { label: string; value: number; pct: number }[] = [
  { label: "Applied", value: 124, pct: 100 },
  { label: "Shortlisted", value: 46, pct: 37 },
  { label: "AI Screening Call", value: 28, pct: 23 },
  { label: "Video Interview", value: 9, pct: 7 },
  { label: "Hired", value: 2, pct: 2 },
];

/**
 * Time in stage. Median days per stage — and Director Round deliberately has
 * NO figure, because the product shows none for a stage nobody has left yet.
 * Reproducing that gap is more honest than filling it in.
 */
export const ANALYTICS_STAGE_DAYS: { label: string; value: number | null }[] = [
  { label: "Applied", value: 2 },
  { label: "Shortlisted", value: 4 },
  { label: "AI Screening Call", value: 3 },
  { label: "Video Interview", value: 6 },
  { label: "Director Round", value: null },
];

/**
 * Hire rate by source — and the last one shows RAW COUNTS rather than a
 * percentage, because the product refuses to compute a rate from too small a
 * sample. That refusal is the single most trustworthy thing on the analytics
 * page and it costs one row to show.
 */
export const ANALYTICS_SOURCES: { label: string; pct: number | null; raw: string }[] = [
  { label: "Career page", pct: 4, raw: "3 of 74" },
  { label: "Referral", pct: 11, raw: "2 of 18" },
  { label: "Agency database", pct: null, raw: "0 of 4" },
];

export const ANALYTICS_BEATS: { key: string; num: string; label: string; copy: string }[] = [
  {
    key: "activity",
    num: "01",
    label: "Activity",
    copy:
      "Every step already leaves a record — an application arriving, a call " +
      "finishing, feedback going in, a stage changing. Nobody has to fill in a " +
      "spreadsheet for any of this to exist.",
  },
  {
    key: "structure",
    num: "02",
    label: "Structure",
    copy:
      "Those events are already structured, because each one was written by the " +
      "screen that produced it. Grouping them is counting, not guessing — there " +
      "is no parsing step between what happened and what is reported.",
  },
  {
    key: "analytics",
    num: "03",
    label: "Analytics",
    copy:
      "Which is what makes the figures defensible. The funnel counts everyone " +
      "who ever reached a step rather than who is sitting there now, time in " +
      "stage uses only visits that have ended, and a source with too few " +
      "candidates shows its raw counts instead of a rate.",
  },
  {
    key: "decision",
    num: "04",
    label: "Decision",
    copy:
      "And then a person reads it. Analytics here tells you where the process " +
      "is slow and which sources are worth the effort. It does not rank your " +
      "candidates, and it does not decide anything.",
  },
];

export const ANALYTICS_HEAD = {
  eyebrow: "Analytics",
  title: "Turn hiring activity into clear, actionable insight.",
  lead:
    "See what is happening across your hiring workflow and understand where it " +
    "slows down — built from the records your team already creates, and honest " +
    "about what the numbers can and cannot tell you.",
} as const;

export const ANALYTICS_CLOSING = "From activity to insight, your hiring workflow stays connected.";

export const ANALYTICS_CALLOUTS: (HomeCard & { href: string })[] = [
  {
    title: "Recruitment analytics",
    body:
      "Applications, hires, median time to hire and screening completion, " +
      "filtered by date range, job, client or recruiter.",
    icon: "Gauge",
    href: "/product/operate",
  },
  {
    title: "Hiring workflow visibility",
    body:
      "Median days in each stage, counted from visits that have actually " +
      "ended — so a slow step shows up as a number rather than a feeling.",
    icon: "Activity",
    href: "/product/decide",
  },
  {
    title: "Candidate pipeline insights",
    body:
      "Where applications come from, how far each source gets, and what the " +
      "funnel loses between one step and the next.",
    icon: "Workflow",
    href: "/product/source",
  },
];

// -----------------------------------------------------------------------------
// Who it's for — four perspectives, one product
// -----------------------------------------------------------------------------

/**
 * FOUR PERSONAS, NOT FIVE, AND THEY ARE THE ONES THE SITE ALREADY HAS.
 *
 * The brief asked for Recruiters, Hiring Managers, HR Teams, Startups and
 * Agencies. Checked against the product, that list does not survive:
 *
 *   * THE PRODUCT'S ROLES are owner, admin, recruiter and viewer. There is no
 *     hiring-manager role. A hiring manager participates through interviews
 *     and structured feedback, which is a real workflow — but it is not a
 *     separate mode of the product, and describing it as one would send an
 *     admin looking for a role that does not exist.
 *   * "HR TEAMS" AND "STARTUPS" ARE MARKET SEGMENTS, not product distinctions.
 *     Nothing in the codebase behaves differently for either. The brief itself
 *     says not to invent a differentiated workflow where none exists.
 *   * THE ONE STRUCTURAL SPLIT IS AGENCY VS IN-HOUSE. lib/organizations/
 *     hiringModel.ts: "One product, two buyers." An agency has clients,
 *     submissions and feedback SLAs; an in-house team has none of that, and
 *     every client-facing surface is a permanently empty page for them.
 *
 * So the four are ROLE_FLOWS — which already exist, were written from the
 * product overview, already render on /how-it-works, and are already the four
 * items in the navbar's "Who It's For" menu. Five different personas here
 * would have contradicted the site's own navigation.
 *
 * `role`, `summary` and `steps` are NOT duplicated: the component reads them
 * from ROLE_FLOWS, so the homepage, /how-it-works and the navbar cannot drift.
 * This adds only what is specific to the section.
 */
export const PERSONA_VIEWS: {
  /** Matches a ROLE_FLOWS anchor, which is also the /how-it-works fragment. */
  anchor: string;
  /** Short label for the selector. */
  tab: string;
  /**
   * Which of DASHBOARD.nav this person actually opens. The workspace lights
   * these and dims the rest — the same product, seen from where they stand.
   */
  surfaces: string[];
  /** One line on what the product does differently for them, if anything. */
  note: string;
  links: { label: string; href: string }[];
}[] = [
  {
    anchor: "for-agency-recruiter",
    tab: "Agency recruiters",
    surfaces: ["Jobs", "Candidates", "Applications", "Pipeline", "Interviews"],
    note:
      "The one setting that genuinely changes the product. In agency mode there " +
      "are client companies, submissions to them, and a measured feedback " +
      "turnaround; an in-house workspace has none of those surfaces at all.",
    links: [
      { label: "Jobs and candidates", href: "/product/source" },
      { label: "Client submissions and offers", href: "/product/close" },
      { label: "The full hiring flow", href: "/how-it-works#for-agency-recruiter" },
    ],
  },
  {
    anchor: "for-in-house-talent-team",
    tab: "In-house teams",
    surfaces: ["Dashboard", "Jobs", "Candidates", "Applications", "Pipeline", "Interviews"],
    note:
      "Fewer roles and more people to satisfy on each one. Everything client- " +
      "facing is switched off, so the workspace is the pipeline, the panels and " +
      "the records they write to.",
    links: [
      { label: "The hiring pipeline", href: "/product/decide" },
      { label: "Resume screening", href: "/product/understand" },
      { label: "The full hiring flow", href: "/how-it-works#for-in-house-talent-team" },
    ],
  },
  {
    anchor: "for-hiring-manager",
    tab: "Hiring managers",
    surfaces: ["Interviews"],
    note:
      "There is no hiring-manager role in the product, and that is the point: a " +
      "hiring manager does not administer anything. They take an interview with " +
      "a brief and leave feedback in a fixed shape, so two opinions can be " +
      "compared rather than merely read.",
    links: [
      { label: "Interviews and evaluation", href: "/product/decide" },
      { label: "Where AI stops and a person decides", href: "/how-it-works#ai-safety" },
      { label: "What a hiring manager sees", href: "/how-it-works#for-hiring-manager" },
    ],
  },
  {
    anchor: "for-candidate",
    tab: "Candidates",
    /*
      DELIBERATELY EMPTY, and it is the most useful thing in the section. A
      candidate never signs in, so no part of this workspace is theirs. The
      panel says so rather than lighting something to avoid an awkward blank.
    */
    surfaces: [],
    note:
      "A candidate never opens this product, and never makes an account. They " +
      "get a link to apply, a call that says what it is, a coding round that " +
      "needs no install, and an opt-out that works without a login.",
    links: [
      { label: "How applications arrive", href: "/product/source" },
      { label: "What a screening call is like", href: "/product/screen" },
      { label: "The candidate's path", href: "/how-it-works#for-candidate" },
    ],
  },
];

export const PERSONA_HEAD = {
  eyebrow: "Who it's for",
  title: "Built for the people who make hiring happen.",
  lead:
    "Whether you are running a desk of client roles, hiring for your own team, " +
    "or sitting one interview a month, it is the same workspace — you just open " +
    "different parts of it.",
} as const;

// -----------------------------------------------------------------------------
// Security — four layers, and only the ones marked IMPLEMENTED
// -----------------------------------------------------------------------------

/**
 * THE RULE THAT DECIDED WHAT IS IN THIS SECTION.
 *
 * docs/SECURITY.md and docs/PRIVACY.md label every area with a status:
 * `IMPLEMENTED`, `PARTIAL`, `RISK` or `MISSING`. That turns "only represent
 * security mechanisms that actually exist" from a judgement into a lookup.
 *
 * Only `IMPLEMENTED` sections appear here:
 *
 *   §1  Authentication            IMPLEMENTED
 *   §2  Authorization & RBAC      IMPLEMENTED
 *   §3  Multi-tenancy & IDOR      IMPLEMENTED
 *   §8  File upload security      IMPLEMENTED
 *   §11 Candidate signed links    IMPLEMENTED
 *   Privacy §2 Consent            IMPLEMENTED
 *
 * DELIBERATELY ABSENT, because the docs mark them PARTIAL or worse: input
 * validation, rate limiting, secrets handling, logging, and data retention —
 * which PRIVACY.md calls "the largest privacy gap". None of those are claimed,
 * hinted at, or implied by a nearby sentence.
 *
 * NO CERTIFICATIONS. None are held, the homepage FAQ already says so in as many
 * words, and there is a test asserting no page names one without denying it.
 */
export const SECURITY_LAYERS: {
  key: string;
  num: string;
  label: string;
  /** The one-line claim. */
  claim: string;
  /** The specifics, each independently checkable in the codebase. */
  points: string[];
}[] = [
  {
    key: "auth",
    num: "01",
    label: "Authentication",
    claim: "A request is somebody, or it is nothing.",
    points: [
      "Sessions are HTTP-only cookies, refreshed at the edge on every request.",
      "Every route handler resolves the tenant from that session — the five that do not are public by design, and each is authorised by a signed token or an HMAC signature instead.",
      "Candidate-facing links need no account at all, which is why they are signed rather than guarded.",
    ],
  },
  {
    key: "roles",
    num: "02",
    label: "Authorization",
    claim: "Hiding a control is cosmetic, so the rule lives in three places.",
    points: [
      "Four roles, enforced in the interface, in the API and in the database — not one of the three on its own.",
      "Role changes are database triggers rather than application code: only an Owner may grant or revoke Owner, and an organisation cannot be left without one.",
      "Every change is logged with both the old value and the new one.",
    ],
  },
  {
    key: "isolation",
    num: "03",
    label: "Isolation",
    claim: "A workspace cannot see another one, even if it asks precisely.",
    points: [
      "The tenant comes from the session. The active-workspace cookie is only a hint, re-checked against real memberships on every request — a forged value gets the default workspace, not access.",
      "An id belonging to another workspace returns not found rather than forbidden, so nobody can use the difference to work out which records exist.",
      "Around twenty database triggers stop a correctly-owned row from pointing at another workspace's parent.",
    ],
  },
  {
    key: "links",
    num: "04",
    label: "Candidate links",
    claim: "The links sent to candidates store no secret at all.",
    points: [
      "Each one is a signature over a single row id, with nothing written down — so a database copy contains no working links, and there is no token column to leak.",
      "A bad signature, a missing key and a malformed link all fail identically and in constant time, because telling them apart would let somebody probe which records exist.",
      "One version bump revokes every link and QR code a form has ever issued, still without storing a secret.",
    ],
  },
];

/**
 * The boundary diagram's contents. Records a workspace holds, and the two
 * neighbours either side of the isolation seam.
 *
 * Labels are the application's real top-level surfaces.
 */
export const SECURITY_RECORDS = ["Jobs", "Candidates", "Applications", "Interviews"];

/**
 * The human-in-the-loop chain (§9), and every step is a real constraint:
 * `AiResult` is a result type rather than an exception, AI output is validated
 * before it is offered, nothing is written to a trusted table by a model, and
 * the verdict is recorded against a named person.
 */
export const SECURITY_CHAIN: { label: string; note: string; by: "ai" | "code" | "human" }[] = [
  { label: "AI output", note: "A structured result, never a free-text answer", by: "ai" },
  { label: "Validated", note: "Shape and figures checked before anyone sees it", by: "code" },
  { label: "Reviewed", note: "On a screen, beside what it was derived from", by: "human" },
  { label: "Decision", note: "Recorded against the person who made it", by: "human" },
];

export const SECURITY_HEAD = {
  eyebrow: "Security and trust",
  title: "Built with trust at every step of the hiring workflow.",
  lead:
    "Hiring decisions affect people's livelihoods, so the guardrails are part of " +
    "the architecture rather than a policy page. Everything below is something " +
    "the product does today — not a roadmap, and not a badge.",
} as const;

/**
 * The closing honesty line.
 *
 * The homepage FAQ already answers the certification question directly; this
 * points at it rather than restating it, so the two cannot drift apart.
 */
export const SECURITY_NOTE =
  "No certification is held, and this section claims none. The awkward version of that answer is in the FAQ below.";

// -----------------------------------------------------------------------------
// Use cases — an index by problem
// -----------------------------------------------------------------------------

/**
 * THERE ARE NO CUSTOMERS, AND THE PROJECT ALREADY SAID SO.
 *
 * docs/modules/21-public-website.md is explicit: "no customer logos, no
 * testimonials, no invented pricing tiers and no security certifications". The
 * only image assets in public/ are Scoreboad's own three brand files. There is
 * no CMS, no quotes file and nothing to quote from.
 *
 * So this is §11's alternative — product scenarios — and it is built as an
 * INDEX rather than as a fifth retelling.
 *
 * WHY AN INDEX. The five scenarios the brief sketches map onto workflows this
 * page has already demonstrated at length: high-volume screening is the AI
 * band, structured interviews are the screening-call band, candidate
 * management is the workspace band, and the hiring workflow is the pipeline
 * board. A section that showed them again would be a recap of the page it sits
 * in, on a page that is already long.
 *
 * What it does instead is the thing none of those bands can do for themselves:
 * let somebody who skimmed say "that one is my problem" and go straight to the
 * part that answers it. Navigation by situation rather than by feature — which
 * is also exactly what §16's internal-linking requirement is for.
 *
 * `onPage` is an id that exists on this page; `page` is a real capability
 * route. Both are asserted in the tests.
 */
export const USE_CASES: {
  key: string;
  /** The selector's label. */
  tab: string;
  /** The H3 — a situation, not a feature name. */
  title: string;
  /** What is actually hard about it. No invented statistics. */
  challenge: string;
  /** The real stages this scenario runs through, in product terms. */
  chain: string[];
  /** What the product leaves you with. A capability, never a business result. */
  outcome: string;
  onPage: { label: string; href: string };
  page: { label: string; href: string };
}[] = [
  {
    key: "volume",
    tab: "High-volume screening",
    title: "High-volume candidate screening",
    challenge:
      "Two hundred applications against one role, and the reading is the same " +
      "work every time — extract the facts, check them against the requirement, " +
      "decide who is worth a call.",
    chain: ["Application", "Resume parsed", "Requirements checked", "Match score", "Review"],
    outcome:
      "The reading is done and the reasons are on the record. A person still " +
      "decides who moves.",
    onPage: { label: "See how screening works", href: "/#ai" },
    page: { label: "AI resume intelligence", href: "/product/understand" },
  },
  {
    key: "interviews",
    tab: "Structured interviews",
    title: "Interviews that can be compared",
    challenge:
      "Two interviewers, two sets of notes, two different shapes. Comparing " +
      "them afterwards is guesswork, and the round that mattered is the one " +
      "nobody wrote down properly.",
    chain: ["Round scheduled", "Brief generated", "Feedback captured", "Evaluation", "Verdict"],
    outcome:
      "Feedback in one shape per round, on the application, beside everything " +
      "else known about the person.",
    onPage: { label: "See the screening call", href: "/#voice" },
    page: { label: "Interviews and evaluation", href: "/product/decide" },
  },
  {
    key: "records",
    tab: "Candidate records",
    title: "One record per person, not per application",
    challenge:
      "The same person applies twice, six months apart. Without a single " +
      "record, the second application starts from nothing and the first " +
      "conversation may as well not have happened.",
    chain: ["Candidate", "Resumes", "Applications", "Screening", "Activity"],
    outcome:
      "One record carrying every application, every resume and an append-only " +
      "history of what changed and who changed it.",
    onPage: { label: "See the candidate workspace", href: "/#candidates" },
    page: { label: "Jobs and candidates", href: "/product/source" },
  },
  {
    key: "pipeline",
    tab: "Stalled pipelines",
    title: "Knowing what has stopped moving",
    challenge:
      "Nothing is obviously wrong, and three people have been sitting in the " +
      "same stage for a fortnight. The board looks busy either way.",
    chain: ["Stage target", "Days in stage", "At risk", "Breached", "Someone acts"],
    outcome:
      "Every card aged against the target you set for its stage, so a stall is " +
      "a number on a column rather than something you notice late.",
    onPage: { label: "See the hiring pipeline", href: "/#pipeline" },
    page: { label: "The hiring pipeline", href: "/product/decide" },
  },
  {
    key: "repeatable",
    tab: "Repeatable process",
    title: "A process that survives the team growing",
    challenge:
      "What two people held in their heads stops working at five. The steps " +
      "are still the steps; they are just no longer in anybody's head.",
    chain: ["Job stages", "Screening questions", "Rules", "Approval", "Audit log"],
    outcome:
      "The process written down where it runs — per-job stages and questions, " +
      "rules that can wait for a person, and a log of everything that happened.",
    onPage: { label: "See recruitment automation", href: "/#automation" },
    page: { label: "Analytics and automation", href: "/product/operate" },
  },
];

export const USE_CASES_HEAD = {
  eyebrow: "Use cases",
  title: "See Scoreboad in action across the hiring workflow.",
  lead:
    "From the first application to the final decision, Scoreboad connects the " +
    "people, information and workflows involved in hiring. Pick the situation " +
    "that sounds like yours.",
} as const;

/**
 * The honest note where a logo wall would be.
 *
 * Not an apology, and not hidden in small print: a young product saying so is
 * more credible than a row of invented marks, and the page has taken that line
 * everywhere else.
 */
export const USE_CASES_NOTE =
  "These are product scenarios, not customer stories. Scoreboad is early and has no customers to name yet — so there are no logos here, and nothing on this page claims otherwise.";

// -----------------------------------------------------------------------------
// Resources — what the site actually has to read
// -----------------------------------------------------------------------------

/**
 * WHAT §1's INSPECTION FOUND: no blog, no guides, no documentation, no case
 * studies, no product-tour route, no content directory and no CMS. The site
 * has TEN public URLs, and lib/marketing/navigation.ts already marks /blog,
 * /resources/guides and /docs as `planned`.
 *
 * SO THE HONEST VERSION OF THIS SECTION IS NOT AN EMPTY STATE.
 *
 * It would have been easy to render "resources coming soon" and move on. But
 * the site does have real reading material — it simply is not in a blog. The
 * fifteen-stage walkthrough, six capability pages, the AI safety model and a
 * FAQ that answers the awkward questions are all published, all crawlable and
 * all genuinely useful to somebody evaluating the product.
 *
 * So this section indexes what exists, and says plainly what does not. The
 * "coming" list carries NO links, because §1's rule is that a route which does
 * not exist does not get one — not even a disabled-looking one.
 *
 * `/how-it-works` IS the product tour §23 asks about, which is why it is the
 * featured item rather than a placeholder.
 */
export type Resource = {
  title: string;
  description: string;
  href: string;
  /** The category shown on the card. */
  kind: string;
};

/**
 * The featured item. Real, published, and the closest thing the site has to a
 * guided tour — fifteen stages from a client requirement to somebody's first
 * day, with every stage linking to the capability behind it.
 */
export const RESOURCE_FEATURED: Resource & { meta: string } = {
  kind: "Product tour",
  title: "How Scoreboad works, end to end",
  description:
    "Fifteen stages from a client requirement to somebody's first day — what " +
    "happens at each one, which screen it happens on, and exactly where AI " +
    "assists and where a person decides.",
  meta: "15 stages · the full walkthrough",
  href: "/how-it-works",
};

/**
 * The capability pages. Titles are CAPABILITY_GROUPS' own headings, which are
 * already editorial sentences rather than feature names — so the cards read
 * like a contents page rather than a nav menu, and they cannot drift from the
 * pages they point at.
 */
export const RESOURCE_GROUPS: { heading: string; note: string; items: Resource[] }[] = [
  {
    heading: "Capability guides",
    note: "One page per part of the hiring process, written as what it does rather than what it is called.",
    items: CAPABILITY_GROUPS.map((group) => ({
      kind: group.tab,
      title: group.heading,
      description: group.summary,
      href: `/product/${group.slug}`,
    })),
  },
  {
    heading: "Answers",
    note: "The questions a careful buyer asks before they trust a product with candidate data.",
    items: [
      {
        kind: "AI safety",
        title: "Where the model stops",
        description:
          "The fixed pipeline every AI feature runs through — raw data, AI, a structured output, validation, human review, and only then a business action.",
        href: "/how-it-works#ai-safety",
      },
      {
        kind: "Use cases",
        title: "Which hiring problem is yours",
        description:
          "Five situations, each pointing at the part of the product that answers it. Product scenarios rather than customer stories, and it says so.",
        href: "/#use-cases",
      },
      {
        kind: "FAQ",
        title: "The awkward questions, answered",
        description:
          "What the product does not do yet, what it does not hold, and what it costs — including the answers that are not flattering.",
        href: "/#faq",
      },
    ],
  },
];

/**
 * What does not exist yet.
 *
 * NAMED WITHOUT LINKS, on purpose. A "coming soon" card that looks clickable
 * is a broken link with better manners, and a greyed-out one still invites the
 * click. Stating them as a sentence is honest and costs nothing.
 *
 * lib/marketing/navigation.ts already carries each of these as `planned`, so
 * the day one is written the navbar and this list turn on from the same edit.
 */
export const RESOURCES_COMING = ["a blog", "hiring guides", "product documentation"];

export const RESOURCES_HEAD = {
  eyebrow: "Resources",
  title: "Resources for better hiring.",
  lead:
    "Practical product resources and hiring insights for teams building a more " +
    "connected recruitment workflow. Everything listed here is published and " +
    "readable now.",
} as const;

// -----------------------------------------------------------------------------
// Pricing — the honest version, because there is no other kind available
// -----------------------------------------------------------------------------

/**
 * WHAT §1's INSPECTION FOUND: there is no billing system.
 *
 * No Stripe (the only match in the codebase is a test asserting
 * `isProvider("stripe")` is FALSE), no subscriptions table, no plans, no
 * checkout, no trial clock, no seat counting and no usage metering. The one
 * "billing" mention in lib/ is a note about a voice provider's balance API
 * that this product deliberately does not call.
 *
 * So every part of the brief that depends on pricing existing is omitted
 * rather than invented: no plan cards, no monthly/annual toggle, no
 * recommended plan, no feature comparison, no trial length, no free-tier
 * limits and no enterprise tier. Each of those would have been a number or a
 * promise with nothing behind it.
 *
 * AND THERE WAS A SECOND FINDING, which is really what this section is for.
 * lib/marketing/content.ts carries a FAQ answer — "Pricing is not published
 * yet" — but that array is DEAD: nothing renders it, and its only reference is
 * its own test. HOME_FAQS, which does render, has no pricing question at all.
 * So a visitor asking what this costs currently finds nothing anywhere on the
 * site.
 *
 * That is the gap this section closes. It is not a placeholder standing in for
 * a pricing table; it is the answer, in the place somebody looks for it.
 */
export const PRICING_HEAD = {
  eyebrow: "Pricing",
  title: "What Scoreboad costs today.",
  lead:
    "Nothing, because there is nothing to charge for yet. There is no billing " +
    "in the product — no plans, no card, no trial running down — and that is " +
    "worth saying plainly rather than leaving you to hunt for a price list that " +
    "does not exist.",
} as const;

/**
 * The two honest panels.
 *
 * `points` are each independently true today. "No plan limits" is carefully
 * NOT "unlimited" — §8 bans assuming unlimited anything, and the real
 * statement is narrower and stronger: there are no plan limits because there
 * are no plans.
 */
export const PRICING_PANELS: {
  key: string;
  label: string;
  title: string;
  points: string[];
}[] = [
  {
    key: "today",
    label: "Today",
    title: "An account costs nothing, and takes no card",
    points: [
      "There is no payment step, because there is nothing in the product that could take a payment.",
      "No trial is running, so nothing expires and nothing needs cancelling.",
      "No plan limits either — not because they are generous, but because there are no plans to limit anything.",
      "Everything described on this page is in the product now. What is not built yet is said so on the page that describes it.",
    ],
  },
  {
    key: "later",
    label: "When there is a price",
    title: "It will be published here, in numbers",
    points: [
      "Pricing is unpublished because it is undecided, not because it is being withheld until you ask.",
      "When it exists it will appear on this page with the figures on it, not as a form that promises a quote.",
      "Anyone already using the product will be told before anything changes for them.",
    ],
  },
];

/**
 * The one honest CTA pair.
 *
 * /signup is real. There is deliberately NO "talk to sales" or "request a
 * demo": no contact route exists, and a button that opens nothing is worse
 * than no button. The dead FAQ answer says "get in touch" — which is exactly
 * the kind of promise this cannot repeat, because there is nowhere to get in
 * touch.
 */
export const PRICING_CTA = {
  primary: { label: "Create an account", href: "/signup" },
  secondary: { label: "See what is in the product", href: "/how-it-works" },
} as const;

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
/**
 * THE AI STORY — the scroll-driven screening demonstration.
 *
 * FIVE STAGES, and every one of them is a real step in this codebase rather
 * than a diagram of how AI screening works in general:
 *
 *   role        a job with requirements            Module 3
 *   candidates  applications against it            Module 5
 *   ai          parse -> review -> check -> match  lib/ai + lib/matching
 *   insight     the structured output              Module 7
 *   review      a person decides                   the AI safety model
 *
 * THE THIRD STAGE IS THE ONE WORTH GETTING RIGHT, and it is the thing most AI
 * recruitment sites get wrong about their own product. Screening here is NOT
 * "send the resume to a model". lib/ai/matchCandidateToJob.ts says it in its
 * own header: salary, experience, location, notice and literal skill overlap
 * are settled by lib/matching/deterministic.ts, and the model is never told
 * them. It answers only what code cannot — whether a missing skill is covered
 * under another name, how close the current role is, whether the seniority
 * reads as a fit.
 *
 * And lib/matching/score.ts owns the number: "the model cannot state a score
 * at all, so it cannot state one that disagrees with the facts beside it."
 * That sentence is the whole reason this section can show a score next to a
 * list of reasons and have the two always agree.
 */
export const AI_STORY_STAGES: { key: string; num: string; label: string }[] = [
  { key: "role", num: "01", label: "Role" },
  { key: "candidates", num: "02", label: "Candidates" },
  { key: "ai", num: "03", label: "AI" },
  { key: "insight", num: "04", label: "Insight" },
  { key: "review", num: "05", label: "Review" },
];

/** The job at the top of the flow. Consistent with the hero and the showcase. */
export const AI_STORY_JOB = {
  title: "Senior Backend Engineer",
  meta: "Remote · Full-time · 4 stages",
  requirements: ["Go", "PostgreSQL", "Distributed systems", "AWS"],
} as const;

/**
 * The four steps inside the AI layer.
 *
 * `by` is not decoration — it is the point. Two of these four are code and one
 * is a person; only ONE is the model. A section about AI screening that shows
 * a single box marked "AI" would be describing a different product.
 */
export const AI_STORY_STEPS: { title: string; body: string; by: "ai" | "code" | "human" }[] = [
  {
    title: "Resume parsed",
    // lib/ai/parseResume.ts
    body: "PDF, DOCX or pasted text read into structured fields.",
    by: "ai",
  },
  {
    title: "Extraction reviewed",
    // The review diff — parseResume PROPOSES, a person applies.
    body: "The proposed fields land on a review screen before anything is saved.",
    by: "human",
  },
  {
    title: "Requirements checked",
    // lib/matching/deterministic.ts
    body: "Must-haves, experience, location and notice settled in code, not by a model.",
    by: "code",
  },
  {
    title: "Semantic match",
    // lib/ai/matchCandidateToJob.ts — its own header describes exactly this.
    body: "Only what code cannot answer: is a missing skill covered under another name?",
    by: "ai",
  },
];

/**
 * Three synthetic candidates. SYNTHETIC — invented for this page, and the only
 * candidate-shaped data that has ever existed in the marketing bundle. This
 * module is imported by a component that constructs no Supabase client and
 * receives no props from a page that has one, so there is no path by which a
 * real person's record could reach it.
 *
 * Scores are illustrative and internally consistent: the strengths and gaps
 * listed explain the number, which is what the real product guarantees in code.
 */
export const AI_STORY_CANDIDATES: {
  id: string;
  name: string;
  headline: string;
  score: number;
  verdict: string;
  strengths: string[];
  gaps: string[];
  verify: string[];
}[] = [
  {
    id: "sharma",
    name: "A. Sharma",
    headline: "Backend Engineer · 7 yrs",
    score: 91,
    verdict: "Needs Review",
    strengths: ["Go and PostgreSQL in production", "Distributed systems at scale"],
    gaps: ["No Kubernetes experience stated"],
    verify: ["Team-lead scope is claimed but not evidenced"],
  },
  {
    id: "iyer",
    name: "M. Iyer",
    headline: "Platform Engineer · 5 yrs",
    score: 84,
    verdict: "Needs Review",
    strengths: ["AWS and infrastructure ownership", "Go via a service rewrite"],
    gaps: ["PostgreSQL depth not stated"],
    verify: ["Notice period missing from the application"],
  },
  {
    id: "reddy",
    name: "K. Reddy",
    headline: "Backend Engineer · 4 yrs",
    score: 63,
    verdict: "Needs Review",
    strengths: ["Strong PostgreSQL and schema design"],
    gaps: ["Below the stated experience minimum", "No distributed systems work listed"],
    verify: [],
  },
];

export const AI_STORY_HEAD = {
  eyebrow: "AI-powered recruitment",
  title: "Turn candidate information into hiring insight.",
  lead:
    "Scoreboad reads candidate information, checks it against what the role " +
    "actually requires and surfaces the signals worth a recruiter's attention — " +
    "so the repetitive part of candidate screening stops being a person's job.",
} as const;

/**
 * The closing line of the flow.
 *
 * THE BRIEF ASKED FOR "AI assists. Your team decides." — which is almost word
 * for word the H2 of the Human + AI band further down this same page ("AI does
 * the work. You make the decisions."). Two near-identical sentences on one page
 * is the thing the last three modules have been removing, so this says the same
 * thing in its own words and leaves the headline to the section that owns it.
 */
export const AI_STORY_VERDICT_NOTE =
  "Every one of these is a draft until a person signs it off.";

/**
 * The four supporting capabilities under the story.
 *
 * DOWN FROM EIGHT. The old grid listed voice screening, interview briefs,
 * candidate messaging and pipeline automation alongside these four — all real,
 * and all owned by later modules of this redesign. Keeping them here would
 * have made this section a summary of the whole product rather than of
 * screening, which is what it is about.
 */
export const AI_CALLOUTS: (HomeCard & { href: string })[] = [
  {
    title: "Resume intelligence",
    // lib/ai/parseResume.ts — proposes fields; a review screen applies them.
    body:
      "Resumes are read and structured automatically, then held for review before " +
      "anything is written to a candidate.",
    icon: "FileSearch",
    href: "/product/understand",
  },
  {
    title: "Candidate screening",
    // lib/matching/deterministic.ts + lib/ai/matchCandidateToJob.ts.
    body:
      "Requirements checked in code, judgement calls left to the model, and one " +
      "score that cannot contradict either.",
    icon: "Target",
    href: "/product/screen",
  },
  {
    title: "AI evaluation",
    // lib/ai/generateApplicationSummary.ts — numeric guard on every figure.
    body:
      "One paragraph on where an application stands, derived strictly from its " +
      "own recorded fields.",
    icon: "Gauge",
    href: "/product/decide",
  },
  {
    title: "Recruiter review",
    // The AI safety model: raw -> AI -> structured -> validation -> human.
    body:
      "Every AI output lands on a screen before it counts. No stage moves itself.",
    icon: "UserCheck",
    href: "/how-it-works#ai-safety",
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

/*
  THE NAVBAR'S LINKS USED TO LIVE HERE, as a flat HOME_NAV_LINKS array. They
  moved to lib/marketing/navigation.ts when the navbar gained mega menus,
  because the nav now has to express groups, one-line descriptions and a
  live/planned distinction that a flat list of {label, href} cannot carry.

  The footer's links stayed: a footer IS a flat list, and duplicating it into
  the navigation module would have created two places to change one link.
*/

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
      { label: "Trust and security", href: "/security" },
      // Added with the About page. A route nothing links to is a route nobody
      // finds, and a sitemap entry is not a link.
      { label: "About Scoreboad", href: "/about" },
    ],
  },
  {
    title: "Get started",
    links: [
      { label: "Sign in", href: "/login" },
      { label: "Create an account", href: "/signup" },
      // Added with the Contact page. It sits under "Get started" rather than
      // under a "Company" heading because that is what it is: the page that
      // explains the one route into the product that works today.
      { label: "Contact and next steps", href: "/contact" },
      { label: "Frequently asked questions", href: "/faq" },
    ],
  },
];

/** The brand phrase. Rendered with the × as separate, dimmed glyphs. */
export const BRAND_STATEMENT = ["People", "Intelligence", "Opportunity"] as const;
