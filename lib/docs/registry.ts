// =============================================================================
// The documentation centre's information architecture — ONE list, four consumers.
//
// The sidebar, the home page's module grid, the [...slug] route and the search
// index all read from here, for the same reason app/settings/catalog.ts exists:
// a second list drifts, and a drifted docs nav is a sidebar full of 404s.
//
// EVERY ENTRY RESOLVES TO REAL CONTENT. A page is either a chapter of a real
// markdown file in docs/ (matched by a marker in its level-1 heading, never by
// index) or a React page in app/docs/. registry.test.ts opens every source file
// and asserts every marker still matches exactly one chapter, so a renamed or
// deleted chapter fails `npm test` instead of shipping an empty page.
//
// PURE DATA. No React, no fs, no database — imported by a server component, a
// client component and a test.
// =============================================================================
import { hasRole } from "@/lib/tenant";
import type { OrgRole } from "@/lib/types";

/**
 * The markdown files the documentation centre may read.
 *
 * AN ALLOWLIST, NOT A DIRECTORY SCAN. The loader resolves a page's file through
 * this map, so no request can ever name a path — there is no traversal to
 * defend against because there is no caller-supplied path. It also keeps the
 * decision about what is publishable in one readable place: docs/SECURITY.md
 * and docs/PRODUCTION_AUDIT.md are deliberately NOT here. They are a working
 * vulnerability register with exploit detail, written for the two people fixing
 * them, and rendering them to every member of every organization would turn the
 * documentation centre into the most useful page in the product for the wrong
 * reader.
 */
export const DOC_FILES = {
  guide: "docs/QA-MANUAL-TESTING-GUIDE.md",
  supplement: "docs/QA-SUPPLEMENT-MODULES.md",
  knownIssues: "docs/KNOWN_ISSUES.md",
} as const;

export type DocFileKey = keyof typeof DOC_FILES;

/**
 * Build status, shown as a chip on every module page and card.
 *
 * `planned` means specified and NOT built. It is a first-class value rather
 * than an omission because the architecture rules are explicit that a missing
 * feature must be labelled rather than left to read as broken — and because a
 * tester filing a bug against something nobody built wastes two people's day.
 */
export type DocStatus = "implemented" | "partial" | "planned";

export type DocGroup = "start" | "modules" | "reference" | "quality";

export type DocPage = {
  /** URL under /docs. "modules/candidates" -> /docs/modules/candidates. */
  slug: string;
  title: string;
  /** One line, shown under the title in the sidebar's cards and search hits. */
  description: string;
  group: DocGroup;
  /**
   * Where the content comes from. `null` means a React page under app/docs
   * renders it (the home page, the system map, the testing centre).
   */
  source: { file: DocFileKey; marker: string } | null;
  status?: DocStatus;
  /** Primary routes a reader can open to see this module. Modules only. */
  routes?: string[];
  /** The lib/ folder that owns it. Modules only. */
  owner?: string;
  /** Other pages, by slug. Rendered as links at the foot of the page. */
  related?: string[];
  /**
   * Roles that may open it. Omitted means every member of the organization.
   * Enforced by the page AND by the search route — a snippet is a disclosure.
   */
  roles?: OrgRole[];
};

export const DOC_PAGES: DocPage[] = [
  // ---- Start here ---------------------------------------------------------
  {
    slug: "",
    title: "Documentation",
    description: "What this product is, who uses it, and every module at a glance.",
    group: "start",
    source: null,
  },
  {
    slug: "overview",
    title: "Project overview",
    description: "The problem, the users, the technology, and how the layers talk to each other.",
    group: "start",
    source: { file: "guide", marker: "Project Overview" },
    related: ["architecture", "system-map", "candidate-journey"],
  },
  {
    slug: "getting-started",
    title: "Getting started",
    description: "Signing in, sessions, protected routes, and what to do on your first day.",
    group: "start",
    source: { file: "supplement", marker: "Getting Started" },
    related: ["modules/authentication", "reference/auth"],
  },
  {
    slug: "architecture",
    title: "Architecture",
    description: "Tenant isolation, the layer-by-layer request path, the AI safety model, fail-closed rules.",
    group: "start",
    source: { file: "guide", marker: "Architecture Overview" },
    related: ["reference/database", "reference/auth", "modules/ai-service-layer"],
  },
  {
    slug: "system-map",
    title: "System map",
    description: "How the modules connect. Click any box to open that module's documentation.",
    group: "start",
    source: null,
    related: ["candidate-journey", "reference/dependencies"],
  },
  {
    slug: "candidate-journey",
    title: "Candidate journey",
    description: "The complete lifecycle of one candidate, from the job advert to the signed offer.",
    group: "start",
    source: { file: "supplement", marker: "Complete Candidate Journey" },
    related: ["system-map", "modules/forms", "modules/pipeline"],
  },

  // ---- Modules ------------------------------------------------------------
  ...moduleEntries(),

  // ---- Reference ----------------------------------------------------------
  {
    slug: "reference/api",
    title: "API reference",
    description: "Every endpoint, grouped by module, with its method, auth and failure modes.",
    group: "reference",
    source: { file: "guide", marker: "API Documentation" },
    related: ["reference/auth", "reference/errors"],
  },
  {
    slug: "reference/database",
    title: "Database",
    description: "Every table, what it stores, how the rows relate, and which module owns it.",
    group: "reference",
    source: { file: "guide", marker: "Database Documentation" },
    related: ["architecture", "reference/api"],
  },
  {
    slug: "reference/auth",
    title: "Authentication & permissions",
    description: "Sessions, the four roles, what each one may do, and where each rule is enforced.",
    group: "reference",
    source: { file: "guide", marker: "Authentication & Authorization Flow" },
    related: ["modules/authentication", "modules/team-permissions"],
  },
  {
    slug: "reference/integrations",
    title: "Integrations",
    description: "Every external service this product talks to — and, precisely, what it does not.",
    group: "reference",
    source: { file: "supplement", marker: "Integrations & External Services" },
    related: ["modules/settings-integrations", "modules/voice-agent", "reference/infrastructure"],
  },
  {
    slug: "reference/infrastructure",
    title: "Infrastructure & cloud",
    description: "Where this runs, what it stores where, and which cloud services are actually used.",
    group: "reference",
    source: { file: "supplement", marker: "Infrastructure & Cloud Services" },
    related: ["reference/integrations", "architecture"],
  },
  {
    slug: "reference/errors",
    title: "Error handling",
    description: "How failures surface, what every layer does when something breaks, and how to test it.",
    group: "reference",
    source: { file: "guide", marker: "Error Handling & Failure Testing" },
    related: ["reference/validation", "quality/testing"],
  },
  {
    slug: "reference/validation",
    title: "Validation rules",
    description: "What each field accepts, where the rule is enforced, and what a rejection looks like.",
    group: "reference",
    source: { file: "guide", marker: "Validation Testing" },
    related: ["reference/errors", "modules/custom-fields"],
  },
  {
    slug: "reference/dependencies",
    title: "Dependency map",
    description: "Which module breaks what. Read this before changing anything shared.",
    group: "reference",
    source: { file: "guide", marker: "Feature Dependency Map" },
    related: ["system-map", "architecture"],
  },

  // ---- Quality ------------------------------------------------------------
  {
    slug: "quality/testing",
    title: "Testing centre",
    description: "Every manual test case in the product, filterable, with your own pass/fail marks.",
    group: "quality",
    source: null,
    related: ["quality/e2e", "quality/checklist", "quality/bug-reports"],
  },
  {
    slug: "quality/e2e",
    title: "End-to-end flows",
    description: "Full journeys that cross module boundaries — the ones unit tests cannot cover.",
    group: "quality",
    source: { file: "guide", marker: "End-to-End Testing Flows" },
    related: ["quality/testing", "candidate-journey"],
  },
  {
    slug: "quality/checklist",
    title: "Release checklist",
    description: "The master pass over the whole product before anything ships.",
    group: "quality",
    source: { file: "guide", marker: "Master Testing Checklist" },
    related: ["quality/testing", "quality/bug-reports"],
  },
  {
    slug: "quality/quick-start",
    title: "Tester quick start",
    description: "Set up, seed data, and run your first full pass without opening the source.",
    group: "quality",
    source: { file: "guide", marker: "QUICK START" },
    related: ["quality/testing", "getting-started"],
  },
  {
    slug: "quality/bug-reports",
    title: "Reporting a bug",
    description: "The template, and what makes a report actionable rather than a round trip.",
    group: "quality",
    source: { file: "guide", marker: "Bug Reporting Template" },
    related: ["quality/known-issues"],
  },
  {
    slug: "quality/known-issues",
    title: "Known issues",
    description: "The open register: what is broken, how bad, and what fixing it looks like.",
    group: "quality",
    source: { file: "knownIssues", marker: "Known Issues" },
    /**
     * OWNER AND ADMIN ONLY, and this is the one access decision in the file.
     *
     * This register names unfixed P0 security defects precisely enough to use —
     * which invite token escalates a role, which public endpoint has no rate
     * limit. That is the right level of detail for the person fixing it and
     * exactly the wrong thing to put one click from the account menu for every
     * Recruiter and Viewer in every organization.
     *
     * Per-module "Known risks" sections stay open to everyone: a tester needs to
     * know a rough edge exists, and those read as QA notes rather than as a
     * prioritised attack surface with file paths.
     */
    roles: ["owner", "admin"],
    related: ["quality/roadmap"],
  },
  {
    slug: "quality/roadmap",
    title: "Planned improvements",
    description: "What is specified but not built, and what the next version of each module needs.",
    group: "quality",
    source: { file: "guide", marker: "Recommended Improvements" },
    related: ["quality/known-issues"],
  },
];

/**
 * The modules, in the order somebody meets them.
 *
 * M01-M25 are chapters of the QA manual. M26-M31 were built after that manual
 * was written and live in the supplement; the reader cannot tell, which is the
 * point — one format, one sidebar, one search.
 */
function moduleEntries(): DocPage[] {
  const modules: Array<
    Omit<DocPage, "group" | "source"> & { marker: string; file?: DocFileKey }
  > = [
    {
      slug: "modules/authentication",
      title: "Authentication & session",
      description: "Sign up, sign in, password reset, and the session every other module inherits.",
      marker: "MODULE M01",
      status: "implemented",
      routes: ["/login", "/signup", "/forgot-password", "/reset-password"],
      owner: "lib/supabase, lib/tenant.ts",
      related: ["modules/organizations", "modules/team-permissions", "reference/auth"],
    },
    {
      slug: "modules/organizations",
      title: "Organizations & workspaces",
      description: "Creating a workspace, switching between them, and the tenant boundary itself.",
      marker: "MODULE M02",
      status: "implemented",
      routes: ["/onboarding", "/organizations/switch", "/settings/organization"],
      owner: "lib/organizations",
      related: ["modules/authentication", "modules/team-permissions", "architecture"],
    },
    {
      slug: "modules/team-permissions",
      title: "Team, invites & permissions",
      description: "Inviting colleagues, the four roles, and what each one is allowed to do.",
      marker: "MODULE M03",
      status: "implemented",
      routes: ["/team/invite", "/settings/users", "/invite/[token]"],
      owner: "lib/tenant.ts",
      related: ["reference/auth", "modules/organizations"],
    },
    {
      slug: "modules/dashboard",
      title: "Dashboard",
      description: "The morning view: what needs attention today, and the AI brief over it.",
      marker: "MODULE M04",
      status: "implemented",
      routes: ["/dashboard"],
      owner: "lib/dashboard",
      related: ["modules/analytics", "modules/pipeline"],
    },
    {
      slug: "modules/jobs",
      title: "Jobs",
      description: "Creating and running a role: description, requirements, status, health.",
      marker: "MODULE M05",
      status: "implemented",
      routes: ["/jobs", "/jobs/new", "/jobs/[id]"],
      owner: "lib/jobs",
      related: ["modules/hiring-stages", "modules/applications", "modules/forms"],
    },
    {
      slug: "modules/hiring-stages",
      title: "Hiring stages",
      description: "Per-job stage design, what each stage does automatically, and the AI screening config.",
      marker: "MODULE M06",
      status: "implemented",
      routes: ["/jobs/[id]"],
      owner: "lib/hiring-stages",
      related: ["modules/jobs", "modules/pipeline", "modules/screening-calls"],
    },
    {
      slug: "modules/bulk-intake",
      title: "Bulk resume intake",
      description: "Dropping fifty CVs on a job and getting fifty parsed, deduplicated applications.",
      marker: "MODULE M07",
      status: "implemented",
      routes: ["/jobs/[id]"],
      owner: "lib/intake",
      related: ["modules/resume-parsing", "modules/candidates"],
    },
    {
      slug: "modules/candidates",
      title: "Candidates",
      description: "The person record: profile, history, resumes, notes, and every application they hold.",
      marker: "MODULE M08",
      status: "implemented",
      routes: ["/candidates", "/candidates/new", "/candidates/[id]"],
      owner: "lib/candidates",
      related: ["modules/resume-parsing", "modules/applications", "modules/communications"],
    },
    {
      slug: "modules/resume-parsing",
      title: "Resumes & AI parsing",
      description: "Upload, extract, parse with an LLM, and the human review that has to agree before anything is saved.",
      marker: "MODULE M09",
      status: "implemented",
      routes: ["/candidates/[id]"],
      owner: "lib/resumes",
      related: ["modules/ai-service-layer", "modules/candidates", "modules/bulk-intake"],
    },
    {
      slug: "modules/applications",
      title: "Applications",
      description: "One candidate against one job — the row every other module hangs off.",
      marker: "MODULE M10",
      status: "implemented",
      routes: ["/applications", "/applications/new", "/applications/[id]"],
      owner: "lib/applications",
      related: ["modules/pipeline", "modules/ai-matching", "modules/evaluations"],
    },
    {
      slug: "modules/ai-matching",
      title: "AI matching",
      description: "Scoring a candidate against a job, with a deterministic matcher that has to agree.",
      marker: "MODULE M11",
      status: "implemented",
      routes: ["/applications/[id]"],
      owner: "lib/matching",
      related: ["modules/ai-service-layer", "modules/applications"],
    },
    {
      slug: "modules/screening-calls",
      title: "AI screening calls",
      description: "The automated phone screen: consent, attempt caps, and everything that fails closed.",
      marker: "MODULE M12",
      status: "implemented",
      routes: ["/screening-calls", "/applications/[id]"],
      owner: "lib/screening",
      related: ["modules/voice-agent", "modules/screening-report", "modules/privacy"],
    },
    {
      slug: "modules/screening-report",
      title: "Screening report",
      description: "The transcript, the summary, and the recruiter decision that follows it.",
      marker: "MODULE M13",
      status: "implemented",
      routes: ["/applications/[id]"],
      owner: "lib/screening",
      related: ["modules/screening-calls", "modules/evaluations"],
    },
    {
      slug: "modules/evaluations",
      title: "Evaluations & next action",
      description: "Structured scoring, the recommended next step, and who is allowed to take it.",
      marker: "MODULE M14",
      status: "implemented",
      routes: ["/applications/[id]"],
      owner: "lib/evaluation",
      related: ["modules/applications", "modules/interviews"],
    },
    {
      slug: "modules/pipeline",
      title: "Pipeline & SLA",
      description: "The board, stage movement, and the rules that flag an application going stale.",
      marker: "MODULE M15",
      status: "implemented",
      routes: ["/pipeline", "/pipeline/[jobId]", "/settings/pipeline"],
      owner: "lib/pipeline",
      related: ["modules/applications", "modules/automations", "modules/hiring-stages"],
    },
    {
      slug: "modules/interviews",
      title: "Interviews & feedback",
      description: "Scheduling, the meeting link, the AI brief, scorecards and feedback.",
      marker: "MODULE M16",
      status: "implemented",
      routes: ["/interviews", "/interviews/[id]"],
      owner: "lib/interviews",
      related: ["modules/live-coding", "reference/integrations", "modules/evaluations"],
    },
    {
      slug: "modules/clients",
      title: "Clients & submissions",
      description: "Agency mode: client companies, and submitting a shortlist to one.",
      marker: "MODULE M17",
      status: "implemented",
      routes: ["/clients", "/clients/[id]"],
      owner: "lib/clients",
      related: ["modules/applications", "modules/communications"],
    },
    {
      slug: "modules/automations",
      title: "Automation engine",
      description: "Trigger, condition, action — the rules that move work along without a human clicking.",
      marker: "MODULE M18",
      status: "implemented",
      routes: ["/automations", "/automations/new", "/automations/approvals"],
      owner: "lib/automations",
      related: ["modules/pipeline", "modules/notifications", "modules/communications"],
    },
    {
      slug: "modules/activity-log",
      title: "Activity & audit log",
      description: "Who did what, to whom, when — and what is deliberately never written down.",
      marker: "MODULE M19",
      status: "implemented",
      routes: ["/audit-log"],
      owner: "lib/activity",
      related: ["modules/privacy", "reference/auth"],
    },
    {
      slug: "modules/notifications",
      title: "Internal notifications",
      description: "What the product tells your team, in-app and by email, and how to turn it down.",
      marker: "MODULE M20",
      status: "implemented",
      routes: ["/notifications", "/settings/notifications"],
      owner: "lib/notifications",
      related: ["modules/communications", "modules/automations"],
    },
    {
      slug: "modules/communications",
      title: "Candidate communications",
      description: "Templates, sending, opt-out, and the rules that keep this lawful.",
      marker: "MODULE M21",
      status: "implemented",
      routes: ["/settings/templates", "/unsubscribe"],
      owner: "lib/communications",
      related: ["modules/notifications", "modules/privacy", "reference/integrations"],
    },
    {
      slug: "modules/analytics",
      title: "Analytics & reporting",
      description: "Funnel, time-to-hire, source quality, and the CSV export behind them.",
      marker: "MODULE M22",
      status: "implemented",
      routes: ["/analytics"],
      owner: "lib/analytics",
      related: ["modules/dashboard", "modules/pipeline"],
    },
    {
      slug: "modules/hire-onboarding",
      title: "Onboarding & documents",
      description: "After the offer: the document checklist, the candidate upload link, and completion.",
      marker: "MODULE M23",
      status: "implemented",
      routes: ["/hires", "/hires/[id]", "/settings/onboarding"],
      owner: "lib/onboarding",
      related: ["modules/applications", "modules/privacy"],
    },
    {
      slug: "modules/settings-integrations",
      title: "Settings & integrations",
      description: "Every knob in the product, and the credential store behind the connected services.",
      marker: "MODULE M24",
      status: "implemented",
      routes: ["/settings"],
      owner: "lib/settings, lib/integrations",
      related: ["reference/integrations", "modules/voice-agent", "modules/custom-fields"],
    },
    {
      slug: "modules/ai-service-layer",
      title: "AI service layer",
      description: "The only place that talks to a model — and the safety rules every feature inherits.",
      marker: "MODULE M25",
      status: "implemented",
      routes: ["—"],
      owner: "lib/ai",
      related: ["architecture", "modules/resume-parsing", "modules/ai-matching"],
    },
    {
      slug: "modules/forms",
      title: "Forms & public applications",
      description: "The form builder, the public apply link, and the first door into the product with no login behind it.",
      marker: "MODULE M26",
      file: "supplement",
      status: "implemented",
      routes: ["/settings/forms", "/apply/[token]"],
      owner: "lib/forms",
      related: ["modules/jobs", "modules/candidates", "modules/custom-fields"],
    },
    {
      slug: "modules/live-coding",
      title: "Live coding interviews",
      description: "A shared editor a candidate opens from a QR code, with no account and no install.",
      marker: "MODULE M27",
      file: "supplement",
      status: "partial",
      routes: ["/coding-sessions", "/coding/[token]"],
      owner: "lib/coding",
      related: ["modules/interviews", "reference/integrations"],
    },
    {
      slug: "modules/privacy",
      title: "Privacy & consent",
      description: "Recording consent, retention windows, and what this product will not let you switch off.",
      marker: "MODULE M28",
      file: "supplement",
      status: "partial",
      routes: ["/settings/privacy", "/settings/security"],
      owner: "lib/privacy",
      related: ["modules/screening-calls", "modules/activity-log", "modules/communications"],
    },
    {
      slug: "modules/public-website",
      title: "Public product website",
      description: "The marketing site — the only pages a stranger can read, and why that is safe.",
      marker: "MODULE M29",
      file: "supplement",
      status: "implemented",
      routes: ["/", "/how-it-works", "/product/[slug]"],
      owner: "lib/marketing",
      related: ["modules/forms", "architecture"],
    },
    {
      slug: "modules/voice-agent",
      title: "Voice agent console",
      description: "What the screening call says, how it sounds, and what it falls back to.",
      marker: "MODULE M30",
      file: "supplement",
      status: "implemented",
      routes: ["/settings/integrations/bolna"],
      owner: "lib/voice",
      related: ["modules/screening-calls", "modules/settings-integrations", "modules/privacy"],
    },
    {
      slug: "modules/custom-fields",
      title: "Custom fields",
      description: "Extra fields on jobs, candidates and applications without a migration or a code change.",
      marker: "MODULE M31",
      file: "supplement",
      status: "implemented",
      routes: ["/settings/custom-fields"],
      owner: "lib/customFields",
      related: ["modules/forms", "reference/validation", "modules/settings-integrations"],
    },
  ];

  return modules.map(({ marker, file, ...rest }) => ({
    ...rest,
    group: "modules" as const,
    source: { file: file ?? ("guide" as DocFileKey), marker },
  }));
}

const BY_SLUG = new Map(DOC_PAGES.map((page) => [page.slug, page]));

export function findPage(slug: string): DocPage | null {
  return BY_SLUG.get(slug) ?? null;
}

/**
 * The pages a role may see, in registry order.
 *
 * Filtered on the SERVER and handed to the sidebar as plain data, the way
 * AppShell hands TopNav its links. A Recruiter's sidebar does not contain the
 * known-issues row at all — not hidden with CSS, not filtered in the browser —
 * and the page and the search route each re-check independently, so a typed URL
 * is refused by the page itself rather than by its absence from a menu.
 *
 * `hasRole` comes from lib/tenant.ts, which reaches next/headers. That is safe
 * here for the same reason it is safe in app/settings/catalog.ts: no client
 * component value-imports this module, only its types.
 */
export function visiblePages(role: OrgRole): DocPage[] {
  return DOC_PAGES.filter((page) => canOpen(page, role));
}

/** Whether one role may open one page. The check the page itself runs. */
export function canOpen(page: DocPage, role: OrgRole): boolean {
  return !page.roles || hasRole(role, page.roles);
}

export function pagesInGroup(pages: DocPage[], group: DocGroup): DocPage[] {
  return pages.filter((page) => page.group === group && page.slug !== "");
}

export const GROUP_LABELS: Record<DocGroup, string> = {
  start: "Start here",
  modules: "Modules",
  reference: "Reference",
  quality: "Quality & testing",
};

export const STATUS_LABELS: Record<DocStatus, string> = {
  implemented: "Implemented",
  partial: "Partly built",
  planned: "Planned",
};
