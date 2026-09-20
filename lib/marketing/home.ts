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
