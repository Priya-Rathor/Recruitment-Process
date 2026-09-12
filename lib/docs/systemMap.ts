// =============================================================================
// The system map — how the modules actually connect.
//
// Data only: the ordered stages a candidate's record passes through, plus the
// cross-cutting modules that sit under all of them. app/docs/system-map renders
// it and makes it clickable.
//
// WHY A GRAPH RATHER THAN A PICTURE. The obvious implementation is an image or
// a mermaid string, and both go stale silently — nobody re-exports a PNG when a
// module is added. Here the edges are data the same test suite can walk, and
// every node names a documentation page that registry.test.ts already proves
// exists.
//
// Client-safe: no fs, no database, no React.
// =============================================================================

export type MapNode = {
  id: string;
  label: string;
  /** The documentation page this box opens, as a /docs slug. */
  slug: string;
  /** One sentence, in the language a non-technical reader would use. */
  summary: string;
  /** Node ids this one hands work to. */
  feeds: string[];
  /** True for a step a candidate performs, rather than a recruiter. */
  candidateFacing?: boolean;
};

export type MapStage = { title: string; caption: string; nodes: MapNode[] };

export const MAP_STAGES: MapStage[] = [
  {
    title: "1 · Sourcing",
    caption: "Three doors in. All of them end at the same candidate record.",
    nodes: [
      {
        id: "apply",
        label: "Public application form",
        slug: "modules/forms",
        summary:
          "Somebody with no account opens a signed link or scans a QR code and applies. The only door a stranger can use.",
        feeds: ["resume"],
        candidateFacing: true,
      },
      {
        id: "intake",
        label: "Bulk resume intake",
        slug: "modules/bulk-intake",
        summary: "A recruiter drops a folder of CVs on a job; each one becomes a parsed, deduplicated application.",
        feeds: ["resume"],
      },
      {
        id: "manual",
        label: "Manual entry",
        slug: "modules/candidates",
        summary: "A recruiter types a candidate in, or adds one from a client conversation.",
        feeds: ["candidate"],
      },
    ],
  },
  {
    title: "2 · Understanding",
    caption: "Raw files become structured data — reviewed by a human before anything is trusted.",
    nodes: [
      {
        id: "resume",
        label: "Resume parsing",
        slug: "modules/resume-parsing",
        summary:
          "Text is extracted from the file, an LLM structures it, and a person confirms the result before it is saved.",
        feeds: ["candidate"],
      },
      {
        id: "candidate",
        label: "Candidate record",
        slug: "modules/candidates",
        summary: "One person, one row. Matched against existing candidates rather than duplicated.",
        feeds: ["application"],
      },
    ],
  },
  {
    title: "3 · Applying",
    caption: "A candidate against a job. Every later module hangs off this row.",
    nodes: [
      {
        id: "application",
        label: "Application",
        slug: "modules/applications",
        summary: "The join between a person and a role, carrying its stage, its score and its history.",
        feeds: ["matching", "pipeline"],
      },
      {
        id: "matching",
        label: "AI matching",
        slug: "modules/ai-matching",
        summary: "Scores the fit, with a deterministic matcher that has to agree before the score is acted on.",
        feeds: ["screening"],
      },
    ],
  },
  {
    title: "4 · Screening",
    caption: "The automated phone screen. Fails closed at every step.",
    nodes: [
      {
        id: "screening",
        label: "AI screening call",
        slug: "modules/screening-calls",
        summary:
          "An automated call that announces itself, asks the job's questions, and stops after a hard attempt cap.",
        feeds: ["report"],
        candidateFacing: true,
      },
      {
        id: "report",
        label: "Screening report",
        slug: "modules/screening-report",
        summary: "Transcript, summary and answers, put in front of a recruiter to decide on.",
        feeds: ["evaluation"],
      },
    ],
  },
  {
    title: "5 · Deciding",
    caption: "Where a human is always in the loop.",
    nodes: [
      {
        id: "evaluation",
        label: "Evaluation & next action",
        slug: "modules/evaluations",
        summary: "Structured scoring and one recommended next step, taken by a person with the right role.",
        feeds: ["pipeline"],
      },
      {
        id: "pipeline",
        label: "Pipeline & SLA",
        slug: "modules/pipeline",
        summary: "The board. Stage movement, ageing rules, and the alerts when something sits too long.",
        feeds: ["interview", "submission"],
      },
    ],
  },
  {
    title: "6 · Interviewing",
    caption: "People talking to people, with the product carrying the paperwork.",
    nodes: [
      {
        id: "interview",
        label: "Interview",
        slug: "modules/interviews",
        summary: "Scheduled, briefed by AI, held on a meeting link, and scored on a scorecard afterwards.",
        feeds: ["coding", "offer"],
      },
      {
        id: "coding",
        label: "Live coding round",
        slug: "modules/live-coding",
        summary: "A shared editor the candidate opens from a QR code — no account, no install.",
        feeds: ["offer"],
        candidateFacing: true,
      },
    ],
  },
  {
    title: "7 · Closing",
    caption: "Offer, hire, and the documents that follow.",
    nodes: [
      {
        id: "submission",
        label: "Client submission",
        slug: "modules/clients",
        summary: "Agency mode only: a shortlist presented to the client company that owns the role.",
        feeds: ["offer"],
      },
      {
        id: "offer",
        label: "Offer & hire",
        slug: "modules/pipeline",
        summary: "The final stages of the board, where an application becomes a hire.",
        feeds: ["onboarding"],
      },
      {
        id: "onboarding",
        label: "Onboarding documents",
        slug: "modules/hire-onboarding",
        summary: "The document checklist, the candidate's upload link, and completion tracking.",
        feeds: [],
        candidateFacing: true,
      },
    ],
  },
];

/**
 * The modules that sit under every stage rather than inside one.
 *
 * Drawn as a rail rather than as boxes in the flow, because an arrow from
 * "Automation engine" to all fourteen stage nodes is a diagram nobody can read
 * — and it would be true of the activity log and notifications too.
 */
export const CROSS_CUTTING: MapNode[] = [
  {
    id: "ai",
    label: "AI service layer",
    slug: "modules/ai-service-layer",
    summary: "The only code that talks to a model. Every AI feature is a named function here, never a generic prompt.",
    feeds: [],
  },
  {
    id: "automations",
    label: "Automation engine",
    slug: "modules/automations",
    summary: "Trigger, condition, action. Moves work along on a five-minute sweep without anyone clicking.",
    feeds: [],
  },
  {
    id: "notifications",
    label: "Notifications",
    slug: "modules/notifications",
    summary: "What the product tells your own team, in-app and by email.",
    feeds: [],
  },
  {
    id: "communications",
    label: "Candidate communications",
    slug: "modules/communications",
    summary: "What the product sends the candidate, with opt-out honoured everywhere.",
    feeds: [],
  },
  {
    id: "activity",
    label: "Activity & audit log",
    slug: "modules/activity-log",
    summary: "Who did what, when. Written by the modules above, read by nobody who can edit it.",
    feeds: [],
  },
  {
    id: "analytics",
    label: "Analytics",
    slug: "modules/analytics",
    summary: "Funnel, time-to-hire and source quality, computed over everything above.",
    feeds: [],
  },
];

const ALL_NODES = [...MAP_STAGES.flatMap((stage) => stage.nodes), ...CROSS_CUTTING];

export function findNode(id: string): MapNode | null {
  return ALL_NODES.find((node) => node.id === id) ?? null;
}

/** The nodes that hand work TO this one — the reverse of `feeds`. */
export function fedBy(id: string): MapNode[] {
  return ALL_NODES.filter((node) => node.feeds.includes(id));
}
