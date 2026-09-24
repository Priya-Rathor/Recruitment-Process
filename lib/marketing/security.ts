// =============================================================================
// The Security page's copy.
//
// -----------------------------------------------------------------------------
// §2 — EVERY CLAIM ON THIS PAGE IS CLASSIFIED BEFORE IT IS WRITTEN
// -----------------------------------------------------------------------------
//
// docs/SECURITY.md labels each area IMPLEMENTED / PARTIAL / MISSING / RISK /
// UNKNOWN, verified against this repository with file and line references. That
// document is the classification, and this file may only draw on the first
// label. Where a claim is made here, the mechanism was ALSO read in the source —
// a status line in a document is not by itself a verified control.
//
// A. VERIFIED IMPLEMENTED, and therefore described here:
//
//   * Authentication — Supabase Auth; HTTP-only session cookies refreshed at
//     the edge by proxy.ts; lib/supabase/session.ts is a deny-by-default
//     allowlist whose isPublicPath() is exercised by publicPaths.test.ts.
//   * Authorization — four roles (lib/types.ts ORG_ROLES), enforced in the UI,
//     in the API (requireRole in lib/tenant.ts) and in the database (RLS plus
//     has_org_role). Role transitions are triggers: prevent_self_role_change
//     and enforce_owner_remains (migrations 0036, 0040).
//   * Tenant isolation — 56 tables with RLS enabled and 151 policies across
//     supabase/migrations. Id-addressed queries filter organization_id, so a
//     cross-tenant id returns 404 rather than 403. ~20 tenant-integrity
//     triggers. The active-workspace cookie is a hint, re-validated per request.
//   * File uploads — buckets are private (migration 0005: public = false), a
//     10 MB cap in both the bucket and the route, a MIME allowlist on the
//     bucket and an extension allowlist in the route, reads through short-lived
//     signed URLs (300s for resumes, 60s for onboarding documents).
//   * Candidate links — HMAC over a single row id with nothing stored,
//     constant-time comparison, identical failure for every reason,
//     token_version as a complete revocation (lib/forms/token.ts and siblings).
//   * Activity log — 86 catalogued event types (lib/activity/events.ts) carrying
//     organization, entity, actor and timestamp; events marked sensitive are
//     restricted to Owner/Admin in the RLS SELECT policy (migration 0013).
//   * AI handling — AiResult<T> plus a validate() narrowing function in
//     lib/ai/provider.ts; the model has no tool access and no database handle;
//     numericGuard.ts stops generated prose contradicting a displayed figure.
//   * Consent — the screening call's opening disclosure cannot be reordered or
//     switched off (lib/screening/script.ts).
//   * Webhook verification — the Bolna webhook checks an HMAC over the raw body
//     and returns 401 otherwise (app/api/webhooks/bolna/route.ts).
//   * Security headers — next.config.ts sets X-Frame-Options, nosniff,
//     Referrer-Policy, HSTS and Permissions-Policy.
//   * Logging hygiene — recipients masked at write time, IP addresses stored
//     only as a keyed HMAC, no credential logged anywhere.
//   * Integration credentials — AES-GCM ciphertext plus a column-level REVOKE
//     (lib/integrations/crypto.ts).
//   * Rate limiting — the public application form, and only there
//     (lib/forms/rateLimit.ts: 3 per source per hour, 120 per form per hour).
//
// C. PLANNED, PARTIAL OR ABSENT — named on the page as absent, never implied:
//
//   * No Content-Security-Policy. next.config.ts says why in full.
//   * No MFA, no session-revocation UI, no login-attempt lockout of our own.
//   * No malware scanning and no file content sniffing.
//   * No rate limiting outside the public form.
//   * No structured logging, no alerting, no error tracking.
//   * No prompt-injection boundary on attacker-controlled resume text.
//   * No CSRF token (SameSite cookies and JSON-only bodies cover it in
//     practice; docs/SECURITY.md calls that defence-by-default, not by design).
//   * No SOC 2, ISO 27001, HIPAA, PCI DSS or CCPA. No penetration test and no
//     third-party audit.
//   * No published privacy policy page. app/settings/privacy is an in-product
//     admin screen, not a public document.
//   * No security contact address exists anywhere in this project.
//
// D. UNKNOWN — absent entirely:
//
//   * Encryption at rest and in transit as a blanket claim. Supabase and Vercel
//     both provide it and both document it, but this project has verified
//     neither, and §9 of the brief is explicit that an unverified encryption
//     claim may not be made. The ONE encryption claim on this page is the
//     integration credential store, because that cipher is in our own source.
// =============================================================================

export const SECURITY_PAGE_HERO = {
  title: "Security built into the hiring workflow.",
  lead:
    "Scoreboad is designed to keep hiring information controlled, reviewable, " +
    "and connected to the people responsible for hiring decisions. Everything " +
    "on this page is a mechanism in the product today — described precisely, " +
    "with the gaps named rather than left out.",
  /** The hero diagram's three beats, which are also its text equivalent (§28). */
  flow: [
    { label: "Candidate data", note: "Applications, resumes, screening answers" },
    { label: "Scoreboad", note: "Session, role and workspace decide what opens" },
    { label: "Human review", note: "A named person makes the decision" },
  ],
} as const;

/**
 * §25's contents. Each entry is an id that exists on the page — the test pins
 * that, because a table of contents pointing at a missing anchor is worse than
 * no contents at all.
 */
export const SECURITY_CONTENTS: { id: string; label: string }[] = [
  { id: "overview", label: "Overview" },
  { id: "architecture", label: "Architecture" },
  { id: "access", label: "Access control" },
  { id: "isolation", label: "Data isolation" },
  { id: "data", label: "Data handling" },
  { id: "ai", label: "AI and human review" },
  { id: "audit", label: "Auditability" },
  { id: "privacy", label: "Privacy" },
  { id: "principles", label: "Principles" },
  { id: "status", label: "What is not here" },
];

/**
 * §5 — the five areas, each one backed by a mechanism rather than a posture.
 */
export const SECURITY_PILLARS: {
  key: string;
  icon: string;
  label: string;
  question: string;
  body: string;
}[] = [
  {
    key: "access",
    icon: "ShieldCheck",
    label: "Access",
    question: "Who can interact with hiring information?",
    body:
      "A session identifies the person, a role decides what they may do, and " +
      "both are checked again in the database. Four roles: Owner, Admin, " +
      "Recruiter and Viewer.",
  },
  {
    key: "data",
    icon: "Database",
    label: "Data",
    question: "How is information kept in the right workspace?",
    body:
      "Every table carries an organization and a row-level policy. A record " +
      "addressed by an id from another workspace comes back as not found.",
  },
  {
    key: "ai",
    icon: "Sparkles",
    label: "AI",
    question: "How is AI-generated information handled?",
    body:
      "A model returns a structured result that is checked in code before " +
      "anyone sees it. It holds no database handle and no tools.",
  },
  {
    key: "review",
    icon: "Users",
    label: "Review",
    question: "Where do people inspect what was produced?",
    body:
      "AI output is shown beside the material it came from, on a screen built " +
      "for correcting it. What the model said is kept alongside the correction.",
  },
  {
    key: "audit",
    icon: "Activity",
    label: "Audit",
    question: "What activity can be traced afterwards?",
    body:
      "Eighty-six catalogued event types record who did what, to which record, " +
      "and when. Access-changing events are restricted to Owners and Admins.",
  },
];

/**
 * §6 — the request's path, top to bottom. Each step names the file or the
 * mechanism that performs it, because "authorization" as a box on a diagram is
 * decoration and "requireRole, in all 105 route handlers" is a fact.
 */
export const SECURITY_ARCHITECTURE: {
  key: string;
  label: string;
  detail: string;
  /** Which layer performs it — the diagram's only colour distinction. */
  layer: "edge" | "server" | "database" | "human";
}[] = [
  {
    key: "user",
    label: "User or team member",
    detail: "Signs in with email and password or Google, through Supabase Auth.",
    layer: "edge",
  },
  {
    key: "auth",
    label: "Authentication",
    detail:
      "An HTTP-only session cookie, refreshed at the edge on every request. " +
      "Routes are protected by default: anything not on the public allowlist " +
      "requires a session.",
    layer: "edge",
  },
  {
    key: "authz",
    label: "Authorization",
    detail:
      "The route resolves the workspace and the role from that session — never " +
      "from the URL, the body or a header.",
    layer: "server",
  },
  {
    key: "workspace",
    label: "Workspace",
    detail:
      "The active-workspace cookie is only a hint. It is re-checked against " +
      "real membership rows on every request, so a forged value yields the " +
      "default workspace rather than access.",
    layer: "server",
  },
  {
    key: "policy",
    label: "Access policy",
    detail:
      "Row-level security is the real boundary, not the route handler — the " +
      "browser holds an authenticated database client, so a rule that exists " +
      "only in application code is not a rule.",
    layer: "database",
  },
  {
    key: "data",
    label: "Data",
    detail:
      "Jobs, candidates, applications, interviews and evaluations, each row " +
      "owned by one workspace and reachable only from it.",
    layer: "database",
  },
  {
    key: "ai",
    label: "AI workflow",
    detail:
      "Structured input in, a validated structure out. No tools, no database " +
      "handle, and no write to a candidate's record.",
    layer: "server",
  },
  {
    key: "review",
    label: "Human review",
    detail:
      "A person reads the result beside its source and decides. The decision " +
      "is recorded against them.",
    layer: "human",
  },
];

/**
 * §7 — access control, as the three places the same rule is written.
 */
export const SECURITY_ACCESS = {
  title: "Access should follow responsibility.",
  lead:
    "Hiding a button is cosmetic — a request made with curl never runs your " +
    "interface. So each access rule is written in three places, and the " +
    "database is the one that decides.",
  layers: [
    {
      label: "Interface",
      body:
        "Controls a role may not use are not rendered. This is for clarity, " +
        "and it is treated as carrying no security weight at all.",
    },
    {
      label: "API",
      body:
        "Every route handler resolves membership and role from the session " +
        "before it does anything else. Five routes are public by design — the " +
        "application form, three candidate coding-session routes and one " +
        "webhook — and each is authorised by a signed token or an HMAC " +
        "signature instead.",
    },
    {
      label: "Database",
      body:
        "Row-level security policies and role-checking functions, plus " +
        "triggers for the rules a policy cannot express: only an Owner may " +
        "grant or revoke Owner, nobody may change their own role, and a " +
        "workspace cannot be left without an Owner.",
    },
  ],
  /** The four roles, in the order the product lists them. */
  roles: ["Owner", "Admin", "Recruiter", "Viewer"],
} as const;

/**
 * §8 — isolation. The mechanism is described; no policy SQL is shown, and no
 * project identifier, schema detail or internal URL appears anywhere.
 */
export const SECURITY_ISOLATION = {
  title: "One workspace cannot reach another.",
  lead:
    "Every table that holds hiring information carries the workspace that owns " +
    "it, and row-level security decides what a query returns — including a " +
    "query the application never wrote.",
  records: ["Jobs", "Candidates", "Applications", "Interviews", "Evaluations"],
  points: [
    {
      label: "Not found, not forbidden",
      body:
        "An id belonging to another workspace returns 404. Answering 403 would " +
        "confirm the record exists, which is an oracle worth nothing to a " +
        "legitimate user and a great deal to anyone enumerating ids.",
    },
    {
      label: "The session decides the tenant",
      body:
        "Never a request body, a query parameter or a header. Those are " +
        "attacker-controlled by definition.",
    },
    {
      label: "Cross-workspace parents blocked",
      body:
        "Around twenty triggers stop a correctly-owned row from pointing at " +
        "another workspace's parent record — the shape of isolation bug that " +
        "a per-table policy on its own will not catch.",
    },
  ],
} as const;

/**
 * §9, §12, §13, §14 — what is actually enforced on the way in.
 *
 * NO BLANKET ENCRYPTION CLAIM. See the D classification in this file's header.
 */
export const SECURITY_DATA = {
  title: "Treat hiring information as sensitive workflow data.",
  lead:
    "Resumes, applications, screening answers and interview feedback are all " +
    "written by people who did not ask to be processed by software. What " +
    "follows is what the product enforces at each edge.",
  groups: [
    {
      label: "Files",
      icon: "FileText",
      points: [
        "Storage buckets are private. No uploaded file is served from a public URL.",
        "A 10 MB cap, set on the bucket and checked again in the route.",
        "The bucket's own type allowlist is the real gate; the route's extension check exists to give a usable error at the file picker.",
        "Reads go through a short-lived signed URL — five minutes for a resume, one minute for an onboarding document — issued only after the caller's workspace is checked.",
      ],
    },
    {
      label: "Input",
      icon: "ClipboardCheck",
      points: [
        "Ids are shape-checked before they reach a query, and updates run against a field allowlist rather than trusting the body's keys.",
        "Database CHECK constraints carry the rules that are about the data rather than the request — ranges, ordering, currency and key formats.",
        "Queries are parameter-bound; there is no raw SQL in application code, and no HTML is ever injected into the page.",
      ],
    },
    {
      label: "Webhooks and credentials",
      icon: "KeyRound",
      points: [
        "The one inbound webhook verifies an HMAC signature over the raw body and refuses anything else.",
        "Integration credentials are stored as AES-GCM ciphertext behind a column-level revoke, so they cannot be read through an ordinary query at all.",
        "The public application form is rate-limited per source and per form.",
      ],
    },
    {
      label: "What is written down",
      icon: "ScanSearch",
      points: [
        "Message recipients are masked when the log row is written, not when it is displayed.",
        "IP addresses are never stored raw — only a keyed HMAC, which cannot be read back.",
        "No password, token or credential is written to a log anywhere in the codebase.",
      ],
    },
  ],
} as const;

/**
 * §10 and §11 — one section, because they are one argument and the site has
 * told it the same way since Module 06.
 */
export const SECURITY_AI = {
  title: "AI supports the workflow. People stay in control.",
  lead:
    "Every AI feature returns a structured result that is checked in code and " +
    "then shown to a person beside whatever it was derived from. No model " +
    "writes to a candidate's record, and when the provider is unavailable the " +
    "manual workflow still works.",
  chain: [
    { label: "Input", note: "Resume text, an application, a call transcript", by: "data" },
    { label: "AI processing", note: "A named function with structured input — never a free-form prompt box", by: "ai" },
    { label: "Structured result", note: "A typed shape, or a failure that is handled", by: "ai" },
    { label: "Validation", note: "Checked in code before anyone sees it; generated prose cannot contradict a displayed figure", by: "code" },
    { label: "Review", note: "On screen, beside the source, on a page built for correcting it", by: "human" },
    { label: "Decision", note: "Made by a person and recorded against them", by: "human" },
  ],
  bounds: [
    {
      label: "The model holds nothing",
      body: "No tool access and no database handle. It receives structured input and returns text.",
    },
    {
      label: "What it said is kept",
      body:
        "A screening report stores the AI's original fields and the correction " +
        "separately, so what the model produced and what a person changed it " +
        "to are both visible afterwards.",
    },
    {
      label: "Consent is not a setting",
      body:
        "The screening call opens by saying it is automated and may be " +
        "recorded. That disclosure cannot be reordered or switched off.",
    },
  ],
  /*
    §10 IS EXPLICIT ABOUT THE FOUR CLAIMS THAT MAY NOT BE MADE, and this is the
    honest version of the same point: the product's position is that the model
    is not the thing being trusted.
  */
  note:
    "Nothing here claims the AI is unbiased, accurate or objective. It is not " +
    "audited for bias, and no part of the product treats its output as a " +
    "finding — which is why a person reads it before it counts for anything.",
} as const;

/**
 * §15 — auditability, described as what the log actually records.
 */
export const SECURITY_AUDIT = {
  title: "Important activity stays traceable.",
  lead:
    "The activity log is a closed catalogue of eighty-six event types, so every " +
    "row renders as a sentence rather than a raw slug — and so a summary of it " +
    "can be checked against it.",
  record: [
    { label: "Who", value: "The person, recorded as an actor on the row" },
    { label: "What", value: "One of eighty-six catalogued event types" },
    { label: "Which", value: "The entity it happened to, and its workspace" },
    { label: "When", value: "A timestamp, in the workspace's own timezone" },
  ],
  points: [
    "Events that change who can do what — role grants, invitations, removals — are marked sensitive and restricted to Owners and Admins by the same row-level policy that protects everything else.",
    "A role change records both the old value and the new one.",
    "An event type the catalogue does not know still stores and still renders, as its raw name. Losing an audit row to a missing label would be worse than an ugly one.",
  ],
  /*
    §15 NAMES THIS EXACT OVERCLAIM. The log is deliberate and broad, but it is
    not a tamper-evident ledger and nothing here should suggest it is.
  */
  note:
    "This is an activity record, not a tamper-evident ledger. It is not claimed " +
    "that every action in the product is logged permanently.",
} as const;

/**
 * §16 — privacy. There is NO published privacy policy, so this section links to
 * nothing and says so.
 */
export const SECURITY_PRIVACY = {
  title: "Privacy belongs in the workflow.",
  lead:
    "Candidate information is handled where hiring happens rather than in a " +
    "separate compliance surface. These are the controls that exist in the " +
    "product today.",
  points: [
    {
      label: "In-product privacy controls",
      body:
        "An organisation's administrators have a privacy screen in the " +
        "product — retention settings and candidate data handling live there, " +
        "beside the workspace they apply to.",
    },
    {
      label: "Candidates are told, and can leave",
      body:
        "The screening call discloses that it is automated and may be " +
        "recorded. Outbound messages carry an unsubscribe link that is a " +
        "signature rather than a stored token, so it cannot be leaked from a " +
        "database copy.",
    },
    {
      label: "Contact details are minimised in logs",
      body:
        "A recipient is masked in the log row itself, and the full address " +
        "stays on the candidate's record where it belongs.",
    },
  ],
  /*
    WAS "there is no published privacy policy page yet", which was true until
    Module 25 wrote one. The security test asserted that sentence precisely so
    that adding the page would fail the build rather than leave this page
    denying something that now exists — which is what it did.
  */
  note:
    "How this information is handled end to end — what is collected, what AI " +
    "does with it, and what is not in place yet — is set out in full on the " +
    "privacy page.",
  link: { label: "Read the Scoreboad privacy page", href: "/privacy" },
} as const;

/**
 * §17 — the principles grid. Every card restates something described above, so
 * no card can be true here and unsupported there.
 */
export const SECURITY_PRINCIPLES: { icon: string; title: string; body: string }[] = [
  {
    icon: "ShieldCheck",
    title: "Controlled access",
    body:
      "Four roles, checked in the interface, the API and the database. The " +
      "database check is the one that counts.",
  },
  {
    icon: "Database",
    title: "Data boundaries",
    body:
      "Every row belongs to a workspace, and row-level security decides what a " +
      "query returns rather than the code that wrote it.",
  },
  {
    icon: "Users",
    title: "Human review",
    body:
      "AI proposes, a person applies. There is no path through the product " +
      "that turns model output into a decision on its own.",
  },
  {
    icon: "ClipboardCheck",
    title: "Validated workflows",
    body:
      "Uploads, ids, webhook payloads and AI output are all narrowed before " +
      "use, with database constraints as the backstop.",
  },
  {
    icon: "Activity",
    title: "Auditability",
    body:
      "A closed catalogue of events records who did what and when, with " +
      "access-changing events restricted to Owners and Admins.",
  },
  {
    icon: "ScanSearch",
    title: "Minimised by default",
    body:
      "Recipients masked at write time, IP addresses stored only as a keyed " +
      "hash, credentials encrypted behind a column-level revoke.",
  },
];

/**
 * §18 and §19 — the section that would carry badges if there were any.
 *
 * There are none, and there is no security contact address anywhere in this
 * project, so neither is invented. This is the same position the homepage FAQ
 * and the About page already take, stated once more where somebody evaluating
 * the product will look for it.
 */
export const SECURITY_STATUS = {
  title: "What Scoreboad does not have.",
  lead:
    "A security page that lists only strengths is an advertisement. These are " +
    "the gaps, named because finding them out later is worse than reading them " +
    "now.",
  absent: [
    {
      label: "No certifications",
      body:
        "No SOC 2, ISO 27001, HIPAA, PCI DSS or CCPA attestation. None is held, " +
        "none is in progress, and no badge appears anywhere on this site.",
    },
    {
      label: "No third-party audit",
      body: "No penetration test and no external security review has been carried out.",
    },
    {
      label: "No Content-Security-Policy",
      body:
        "Five security headers are set — framing, sniffing, referrer, transport " +
        "and permissions. A CSP is not among them, because a policy loose " +
        "enough to ship quickly would be theatre.",
    },
    {
      label: "No multi-factor authentication",
      body: "No MFA, no session-revocation screen and no login-attempt lockout of our own.",
    },
    {
      label: "No malware scanning",
      body:
        "Uploads are type-checked and size-capped, and they are never executed " +
        "or served from our origin — but their contents are not scanned.",
    },
    {
      label: "No published security contact",
      body:
        "There is no security address to report an issue to yet, and inventing " +
        "one would be worse than the gap: a report sent into nowhere is a " +
        "vulnerability nobody is working on.",
    },
  ],
  /*
    §18's instruction when nothing is verified: documentation rather than
    badges. The only public, real destinations are the pages this site
    actually serves — which is why this links to the AI safety model and the
    homepage trust section and nothing else.
  */
  docs: {
    title: "Where the rest of this is written down",
    links: [
      {
        label: "The AI safety model, step by step",
        href: "/how-it-works#ai-safety",
        note: "Where AI assists and where a person decides, across the whole flow.",
      },
      {
        label: "Security and trust on the homepage",
        href: "/#trust",
        note: "The same architecture in short, with the certification question answered.",
      },
      {
        label: "How Scoreboad thinks about AI and people",
        href: "/about",
        note: "The position these controls are built to serve.",
      },
    ],
  },
} as const;
