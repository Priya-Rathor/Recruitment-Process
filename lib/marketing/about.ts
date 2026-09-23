// =============================================================================
// The About page's copy.
//
// -----------------------------------------------------------------------------
// WHAT §1's INSPECTION FOUND, AND WHAT IT DID NOT
// -----------------------------------------------------------------------------
//
// VERIFIED, and used here:
//
//   * The product's name and what it is — README.md: "AI-powered, multi-tenant
//     Recruitment Operating System."
//   * That it was built module by module against a written specification in
//     docs/ — seventeen core modules plus two cross-cutting retrofits. That is
//     an unusual and checkable fact, and it is the page's spine.
//   * The tagline already in the marketing layout: "Smarter Hiring. Brighter
//     Teams."
//
// NOT FOUND ANYWHERE, and therefore absent:
//
//   * No founder, no team, no employee count. package.json has no `author`.
//   * No founding year. The footer prints the CURRENT year, which is a
//     copyright line rather than a founding date, and reading it as one would
//     be inventing a fact from a template.
//   * No location, no legal entity, no funding, no investors, no partnerships,
//     no awards, no milestones, no customers, no revenue.
//
// So there is no company section, no team section and no timeline. §13 is
// explicit that credibility matters more than filling space, and this site has
// already declined to invent customers (Module 16), certifications (Module 15)
// and prices (Module 18). A founding year would be the smallest of those lies
// and the same kind.
//
// ONE THING THE README GETS WRONG, deliberately not repeated: it lists n8n as
// the automation orchestrator. Module 12 established that n8n is RETIRED —
// `CustomerFacingProvider` excludes it and its automation action is in
// RETIRED_ACTIONS. The README is stale on that point; this page does not carry
// the error forward.
// =============================================================================

export const ABOUT_HERO = {
  /** The page's own H1. It is a dedicated route, so it may have one. */
  title: "Building a better way to hire.",
  lead:
    "Scoreboad brings candidate information, screening, interviews, evaluation " +
    "and hiring workflows together in one connected workspace — with AI doing " +
    "the repetitive reading and people making every decision that matters.",
  /*
    The six things the orb pulls together. They are the product's real
    top-level surfaces, so the visual is a picture of this product rather than
    of software in general.
  */
  fragments: ["Candidates", "Resumes", "Screening", "Interviews", "Evaluation", "Pipeline"],
} as const;

export const ABOUT_MISSION = {
  title: "Make hiring more connected.",
  body:
    "Scoreboad is built around a simple idea: hiring works better when candidate " +
    "information, conversations, evaluation and workflow stay connected. Most of " +
    "what makes hiring hard is not the decisions — it is everything that has to " +
    "be true before a decision can be made, spread across tools that do not know " +
    "about each other.",
  /*
    The line that separates this page from the homepage's challenge band. That
    one shows the fragmentation; this one says what follows from it.
  */
  pull: "Modern hiring needs better context, not more tools.",
} as const;

/**
 * The AI position, which is the site's spine and is stated identically
 * everywhere it appears.
 *
 * `does` and `decides` are the split the codebase actually enforces — AI output
 * is a validated structure that lands on a review screen, and no model writes
 * to a trusted table. Nothing here claims AI removes bias, improves hiring
 * outcomes, or picks anybody.
 */
export const ABOUT_AI = {
  title: "AI should do the work. People should make the decisions.",
  body:
    "Every AI feature in Scoreboad produces a structured result that is checked " +
    "in code and then shown to a person, beside whatever it was derived from. " +
    "Nothing a model produces is written to a candidate's record on its own, and " +
    "when the AI provider is unavailable the manual workflow still works.",
  does: [
    "Reads resumes into structured fields, and proposes them as a diff",
    "Runs first-round screening calls and returns them as a readable report",
    "Drafts briefs, summaries and messages inside approved wording",
    "Keeps the pipeline current and surfaces what has stopped moving",
  ],
  decides: [
    "Whether somebody is worth a conversation",
    "What the interview actually revealed",
    "Which of two candidates fits the role",
    "Every stage move, offer and rejection",
  ],
} as const;

/**
 * The principles.
 *
 * FOUR, AND EACH ONE NAMES SOMETHING THE CODEBASE DOES rather than an
 * aspiration. "Says what it does not have" is the least conventional and the
 * most defensible: this site publishes the absence of certifications, of
 * customers and of pricing, which is a positioning claim it can actually be
 * held to.
 */
export const ABOUT_PRINCIPLES: { title: string; body: string }[] = [
  {
    title: "Connected by default",
    body:
      "One record per person, carrying every application, resume, call and " +
      "interview. The parts of hiring that belong together are stored together.",
  },
  {
    title: "A person decides",
    body:
      "AI proposes and a human applies. The review step is in the architecture, " +
      "not in a policy document — there is no path that skips it.",
  },
  {
    title: "Useful where it is useful",
    body:
      "AI is pointed at reading, structuring and summarising. The checkable " +
      "facts — requirements, experience, notice, location — are settled in code, " +
      "which is why a score can never contradict them.",
  },
  {
    title: "Says what it does not have",
    body:
      "No certifications are held, there are no customers to name and pricing " +
      "is not set. All three are on this site in as many words, because finding " +
      "out later is worse than reading it now.",
  },
];

/**
 * The journey. Real stage and surface names, in the order the product runs
 * them — the same sequence the homepage's bands walk through.
 */
export const ABOUT_JOURNEY: { label: string; note: string }[] = [
  { label: "Job", note: "Opened with its own stages and screening questions" },
  { label: "Application", note: "From a shared link, a bulk upload or by hand" },
  { label: "Candidate", note: "One record, matched against everyone on file" },
  { label: "Screening", note: "An automated first call, returned as a report" },
  { label: "Interview", note: "Rounds scheduled, feedback in a fixed shape" },
  { label: "Evaluation", note: "Every signal on one panel, for a person to weigh" },
  { label: "Decision", note: "Recorded against the person who made it" },
];

export const ABOUT_CTA = {
  title: "See how Scoreboad fits your hiring workflow.",
  body: "The walkthrough covers all of it, end to end, in fifteen stages.",
  primary: { label: "Explore the platform", href: "/how-it-works" },
  secondary: { label: "Create an account", href: "/signup" },
} as const;
