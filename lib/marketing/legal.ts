// =============================================================================
// The legal pages' content.
//
// -----------------------------------------------------------------------------
// THIS DOCUMENT SET HAS NOT BEEN REVIEWED BY A LAWYER
// -----------------------------------------------------------------------------
//
// §33 is explicit, and it is the most important line in this file: nothing here
// may present itself as legally reviewed, compliant or certified. What follows
// is a technically accurate description of what the software actually does,
// arranged in the shape a privacy notice and a terms document take. Turning
// that into an enforceable legal instrument is a lawyer's job, and every place
// that needs one is marked.
//
// -----------------------------------------------------------------------------
// THE PLACEHOLDER CONVENTION
// -----------------------------------------------------------------------------
//
// `{{LIKE THIS}}` inside any string is rendered as a visually obvious marker —
// highlighted, in capitals, impossible to mistake for finalised wording. It is
// also greppable: `grep -rn "{{" lib/marketing/legal.ts` lists everything still
// outstanding, and `legal.test.ts` asserts every marker is in the published
// checklist so none can be quietly forgotten.
//
// A placeholder appears ONLY where the fact is genuinely unavailable in this
// project. Everything not marked was verified in the source or in
// docs/PRIVACY.md and docs/SECURITY.md, which carry per-area
// IMPLEMENTED/PARTIAL/MISSING/UNKNOWN labels against file references.
//
// -----------------------------------------------------------------------------
// WHAT §1's AUDIT ESTABLISHED, AND WHAT IT DID NOT
// -----------------------------------------------------------------------------
//
// VERIFIED AND STATED HERE:
//
//   * The personal-data inventory — docs/PRIVACY.md §1, a table of every
//     category with the table or bucket that holds it.
//   * Consent before a screening call is IMPLEMENTED and cannot be disabled;
//     audio capture is gated on an affirmative outcome by `mayCaptureAudio()`,
//     and a database trigger stamps the confirmation rather than app code.
//   * Raw IP addresses are never stored — only a keyed HMAC.
//   * Processors are enumerated in `lib/privacy/providers.ts`.
//   * Only two cookies exist, both strictly necessary, and an anonymous visitor
//     to the public site is set NONE — verified with `curl -I`.
//   * No analytics, no tag manager, no pixel, no session recorder, no error
//     tracker. `grep` for every common provider returns nothing.
//
// NOT ESTABLISHED, AND THEREFORE MARKED RATHER THAN GUESSED:
//
//   * The legal entity, its address, and the governing law. package.json has no
//     author; nothing in the repository names a company.
//   * Data residency and international transfer mechanism — docs/PRIVACY.md §7
//     records this as UNKNOWN: no region pinning, no DPA and no SCC reference
//     appears anywhere.
//   * The controller/processor split. §12 forbids asserting it, and nothing in
//     the architecture establishes it.
//   * Retention periods. Settings exist; the sweep that would act on them does
//     not — see the honest disclosure in the retention section.
//   * A privacy contact address. None is configured; /contact is the real route.
// =============================================================================

export type LegalBlock =
  | { kind: "p"; text: string }
  | { kind: "list"; items: string[] }
  | { kind: "table"; head: [string, string]; rows: [string, string][] }
  /** A called-out honesty note — rendered distinctly, never as small print. */
  | { kind: "note"; text: string }
  | { kind: "link"; text: string; label: string; href: string };

export type LegalSection = { id: string; title: string; blocks: LegalBlock[] };

export type LegalDoc = {
  slug: string;
  title: string;
  lead: string;
  /** §20 — a placeholder, because no effective date has been decided. */
  updated: string;
  sections: LegalSection[];
};

/**
 * §33's banner, shown at the top of every legal page.
 *
 * NOT IN A FOOTNOTE. A reader who takes an unreviewed document for a reviewed
 * one has been misled by its placement as much as by its words, so this sits
 * above the first section on all three pages.
 */
export const LEGAL_REVIEW_NOTICE =
  "This document describes how the software works today. It has not been " +
  "reviewed by a lawyer, and the sections marked in capitals are unfinished. " +
  "It is published so the behaviour is inspectable — not as a legal agreement.";

/** §20 — one placeholder, used by all three documents so they cannot disagree. */
const UPDATED = "{{EFFECTIVE DATE — COMPLETE BEFORE PRODUCTION}}";

// -----------------------------------------------------------------------------
// PRIVACY
// -----------------------------------------------------------------------------

export const PRIVACY_DOC: LegalDoc = {
  slug: "privacy",
  title: "Privacy at Scoreboad.",
  lead:
    "How Scoreboad handles the information used to run the hiring platform — " +
    "what enters the system, what the software does with it, and what it does " +
    "not do yet.",
  updated: UPDATED,
  sections: [
    {
      id: "overview",
      title: "Overview",
      blocks: [
        {
          kind: "p",
          text:
            "Scoreboad is recruitment software. Organisations use it to post jobs, " +
            "receive applications, screen candidates, run interviews and record " +
            "hiring decisions. Most of the personal information in the system is " +
            "about candidates, and it is put there by the organisation hiring them " +
            "or submitted by the candidate through an application link.",
        },
        {
          kind: "note",
          text:
            "Scoreboad's legal relationship to that information — who is the " +
            "controller and who is the processor — is not settled, and this " +
            "document does not assert it. {{DATA PROTECTION ROLES — CONFIRM WITH " +
            "COUNSEL}}",
        },
      ],
    },
    {
      id: "information",
      title: "Information in the platform",
      blocks: [
        {
          kind: "p",
          text:
            "Every category below corresponds to a specific place in the system. " +
            "This is the complete inventory, not a summary of it.",
        },
        {
          kind: "table",
          head: ["Category", "What it is"],
          rows: [
            ["Account information", "The name, email and organisation of the people who sign in."],
            ["Candidate identity", "A candidate's name, email and phone number."],
            ["CV files", "Uploaded resumes, held in private storage."],
            ["Parsed CV content", "The structured fields a model extracted from a resume."],
            ["Application answers", "Responses to the questions on a job's application form."],
            ["Salary and notice period", "Where a candidate supplied them or a screening call captured them."],
            ["Voice recordings", "Audio of an automated screening call, where consent was given and the organisation permits recording."],
            ["Call transcripts", "The text of a screening call."],
            ["Evaluations", "Match scores, screening reports and interview feedback."],
            ["Identity documents", "Files a new hire uploads during onboarding, in private storage."],
            ["Message content", "The body of messages sent to a candidate."],
            ["Code submissions", "Answers to a coding exercise, where one was used."],
            ["Activity log", "A record of who changed what, and when."],
          ],
        },
        {
          kind: "p",
          text:
            "Raw IP addresses are deliberately not stored. Where an address is " +
            "needed to rate-limit a public form, only a keyed hash of it is kept, " +
            "which cannot be read back into the original address.",
        },
      ],
    },
    {
      id: "ai",
      title: "How AI is used",
      blocks: [
        {
          kind: "p",
          text:
            "AI features read information already in the system and return a " +
            "structured result. Each one is a named function with a defined input " +
            "and a validated output — there is no open-ended assistant, the model " +
            "holds no database connection and no tools, and it cannot look anything " +
            "up on its own.",
        },
        {
          kind: "list",
          items: [
            "Resume text is parsed into structured fields, proposed for a person to confirm rather than written straight onto the record.",
            "A resume is scored against a role's requirements, with the reasoning shown beside the score.",
            "A screening call is summarised into a report, with fields the model was unsure about flagged for checking first.",
            "Messages, briefs and summaries are drafted for a person to edit before anything is sent.",
          ],
        },
        {
          kind: "p",
          text:
            "Where a person corrects an AI-produced field, the original value and " +
            "the correction are both kept, so what the model said remains visible " +
            "afterwards.",
        },
        {
          kind: "note",
          text:
            "Scoreboad does not claim that its AI is unbiased, objective or " +
            "accurate. No model here has been audited for bias, and no part of the " +
            "product treats a model's output as a finding.",
        },
      ],
    },
    {
      id: "automated",
      title: "Automated processing and human review",
      blocks: [
        {
          kind: "p",
          text:
            "Scoreboad is built so that a person makes every consequential hiring " +
            "decision. Stage moves, offers and rejections are all actions taken by a " +
            "named user and recorded against them.",
        },
        {
          kind: "p",
          text:
            "There is one place where processing happens without a person in the " +
            "loop, and it is disclosed here rather than left to be discovered: an " +
            "organisation can enable a rule that screens a resume against a passing " +
            "mark automatically. Its effect is a reversible flag on the application. " +
            "It does not move the application to another stage and it never rejects " +
            "anyone; a recruiter sees the flag and decides.",
        },
        {
          kind: "note",
          text:
            "There is currently no notice to the candidate that this automatic " +
            "screening ran, and no published route for a candidate to ask for it to " +
            "be reviewed by a person. {{AUTOMATED DECISION-MAKING NOTICE AND REVIEW " +
            "ROUTE — REQUIRED BEFORE PRODUCTION}}",
        },
      ],
    },
    {
      id: "calls",
      title: "Screening calls, recording and consent",
      blocks: [
        {
          kind: "p",
          text:
            "An automated screening call states at the start that it is automated " +
            "and may be recorded. That disclosure cannot be reordered or switched " +
            "off by an organisation — it is a constraint in the software rather than " +
            "a setting.",
        },
        {
          kind: "list",
          items: [
            "Audio is captured only where the outcome of that disclosure was affirmative.",
            "The system detects a refusal in the conversation and acts on it.",
            "Where the organisation's settings do not permit a recording, the database refuses to store one.",
            "An organisation chooses what survives a refusal — metadata only, the transcript, or everything — and the choice is stated in plain words in the product.",
          ],
        },
        {
          kind: "note",
          text:
            "One known limitation: the disclosure is spoken by the voice agent, so " +
            "if a call drops partway through it the system cannot distinguish " +
            "“disclosed and accepted” from “never disclosed”.",
        },
      ],
    },
    {
      id: "sharing",
      title: "Who else processes this information",
      blocks: [
        {
          kind: "p",
          text:
            "Information is shared only with the services needed to run the " +
            "features an organisation has connected. The product lists the ones " +
            "actually connected, by category, inside the workspace.",
        },
        {
          kind: "table",
          head: ["Service", "What it handles"],
          rows: [
            ["Hosting and database", "Storage of the records above, authentication, and uploaded files."],
            ["Application hosting", "Serving the application and its server logs."],
            ["AI model provider", "The text sent for parsing, scoring, summarising and drafting."],
            ["Telephony and speech", "Placing screening calls and producing their audio and transcript."],
            ["Email provider", "Delivering messages to candidates, where connected."],
            ["Messaging provider", "Delivering reminders by message, where connected."],
            ["Calendar provider", "Creating interview invitations, where connected."],
          ],
        },
        {
          kind: "note",
          text:
            "The named companies behind these roles, the contracts governing them " +
            "and the formal sub-processor list are not published here. " +
            "{{SUB-PROCESSOR LIST AND DATA PROCESSING TERMS — COMPLETE BEFORE PRODUCTION}}",
        },
      ],
    },
    {
      id: "storage",
      title: "Storage, location and transfers",
      blocks: [
        {
          kind: "p",
          text:
            "Records are held in a database with row-level policies that scope every " +
            "row to the organisation that owns it. Uploaded files are in private " +
            "storage and are read through short-lived signed links after the " +
            "requester's organisation has been checked.",
        },
        {
          kind: "note",
          text:
            "The regions the data is stored and processed in are not recorded in " +
            "this project, and no transfer mechanism is documented. Voice data in " +
            "particular reaches the telephony and model providers wherever they " +
            "operate. {{DATA RESIDENCY AND INTERNATIONAL TRANSFER MECHANISM — " +
            "COMPLETE BEFORE PRODUCTION}}",
        },
      ],
    },
    {
      id: "retention",
      title: "How long information is kept",
      blocks: [
        {
          kind: "p",
          text:
            "An organisation can configure a retention period and choose what should " +
            "happen when it expires. The default is manual review rather than " +
            "automatic deletion, because an automatic delete can destroy records an " +
            "organisation is required to keep.",
        },
        {
          kind: "note",
          text:
            "Stated plainly because the opposite would be a promise the software " +
            "does not keep: those settings are recorded but are NOT yet acted on " +
            "automatically. Nothing is deleted on a schedule today. Deletion happens " +
            "when somebody performs it. {{AUTOMATED RETENTION ENFORCEMENT — NOT " +
            "IMPLEMENTED}}",
        },
        {
          kind: "p",
          text:
            "The activity log is designed to outlive the records it describes: an " +
            "entry saying who deleted something has to survive the deletion, or the " +
            "log cannot do its job.",
        },
      ],
    },
    {
      id: "security",
      title: "Security",
      blocks: [
        {
          kind: "p",
          text:
            "Access is controlled by four roles enforced in the interface, the API " +
            "and the database; a record belonging to another organisation returns " +
            "not found rather than forbidden. Message recipients are masked in logs, " +
            "integration credentials are encrypted, and candidate-facing links are " +
            "signatures that store no secret.",
        },
        {
          kind: "link",
          text: "The full description of these controls, including what is not in place:",
          label: "Read the Scoreboad security page",
          href: "/security",
        },
        {
          kind: "note",
          text:
            "No security certification is held and none is claimed. There has been " +
            "no third-party audit or penetration test.",
        },
      ],
    },
    {
      id: "rights",
      title: "Choices and requests",
      blocks: [
        {
          kind: "p",
          text: "What the software supports today, stated as it stands:",
        },
        {
          kind: "table",
          head: ["Request", "What exists"],
          rows: [
            ["Stop receiving messages", "Every outbound message carries an unsubscribe link that works without an account, and the sending pipeline checks the preference before each send."],
            ["Correction", "An organisation's recruiters can correct a candidate record. There is no direct channel for a candidate to request a correction."],
            ["Deletion", "An Owner or Admin can delete a candidate's data from the workspace. Whether every related file is removed alongside the record is not fully verified."],
            ["A copy of the information", "Not available. There is no candidate-facing export."],
          ],
        },
        {
          kind: "note",
          text:
            "Requests are made to the organisation that holds the record. " +
            "{{PRIVACY REQUEST CONTACT AND RESPONSE PROCESS — COMPLETE BEFORE " +
            "PRODUCTION}}",
        },
      ],
    },
    {
      id: "cookies",
      title: "Cookies",
      blocks: [
        {
          kind: "p",
          text:
            "The public website sets no cookies at all. Signing in sets two, both " +
            "strictly necessary. There is no analytics, advertising or tracking " +
            "technology anywhere in the product.",
        },
        {
          kind: "link",
          text: "The detail, including each cookie's purpose:",
          label: "Read the Scoreboad cookie information",
          href: "/cookies",
        },
      ],
    },
    {
      id: "children",
      title: "Children",
      blocks: [
        {
          kind: "p",
          text:
            "Scoreboad is workplace software sold to organisations for hiring. It " +
            "is not directed at children and has no feature intended for them.",
        },
        {
          kind: "note",
          text: "{{MINIMUM AGE AND JURISDICTION-SPECIFIC WORDING — CONFIRM WITH COUNSEL}}",
        },
      ],
    },
    {
      id: "contact",
      title: "Changes and contact",
      blocks: [
        {
          kind: "p",
          text:
            "When this document changes, the date at the top changes with it. There " +
            "is no mailing list for notices.",
        },
        {
          kind: "link",
          text: "There is no privacy inbox yet. The contact page explains what does exist:",
          label: "See how to contact Scoreboad",
          href: "/contact",
        },
        {
          kind: "note",
          text: "{{LEGAL ENTITY NAME AND REGISTERED ADDRESS — COMPLETE BEFORE PRODUCTION}}",
        },
      ],
    },
  ],
};

// -----------------------------------------------------------------------------
// TERMS
// -----------------------------------------------------------------------------

export const TERMS_DOC: LegalDoc = {
  slug: "terms",
  title: "Scoreboad terms of service.",
  lead:
    "The terms on which Scoreboad is made available today. The commercial and " +
    "liability provisions are not finalised, and the sections that need a " +
    "lawyer say so.",
  updated: UPDATED,
  sections: [
    {
      id: "introduction",
      title: "Introduction",
      blocks: [
        {
          kind: "p",
          text:
            "These terms cover use of the Scoreboad platform and the public " +
            "Scoreboad website. Using the service means accepting them.",
        },
        {
          kind: "note",
          text:
            "{{CONTRACTING LEGAL ENTITY — COMPLETE BEFORE PRODUCTION}} and " +
            "{{GOVERNING LAW AND JURISDICTION — COMPLETE BEFORE PRODUCTION}}",
        },
      ],
    },
    {
      id: "accounts",
      title: "Accounts and organisations",
      blocks: [
        {
          kind: "p",
          text:
            "An account belongs to a person and is held within an organisation. The " +
            "first person to create an organisation is its Owner; Owners and Admins " +
            "invite others and set their role.",
        },
        {
          kind: "list",
          items: [
            "Four roles exist — Owner, Admin, Recruiter and Viewer — and each one's permissions are enforced by the software rather than by convention.",
            "Only an Owner may grant or revoke the Owner role, and an organisation cannot be left without one.",
            "You are responsible for the accounts you invite and for keeping your own credentials secure.",
          ],
        },
      ],
    },
    {
      id: "acceptable-use",
      title: "Acceptable use",
      blocks: [
        {
          kind: "p",
          text: "You agree not to use Scoreboad to:",
        },
        {
          kind: "list",
          items: [
            "Upload information you have no lawful basis to process, including candidate information obtained without the candidate's knowledge.",
            "Attempt to access another organisation's data, or to probe, scan or test the security of the service other than through a channel we invite.",
            "Interfere with the service's operation, or use it in a way that places a disproportionate load on it.",
            "Use the service to build a competing product, or to resell access without agreement.",
            "Record a call in a way that is unlawful where the parties are located.",
          ],
        },
      ],
    },
    {
      id: "your-content",
      title: "Your content and candidate information",
      blocks: [
        {
          kind: "p",
          text:
            "Jobs, candidate records, resumes, messages and evaluations that an " +
            "organisation puts into Scoreboad remain that organisation's. Scoreboad " +
            "stores and processes them to provide the service.",
        },
        {
          kind: "p",
          text:
            "Because most of that information is about people who are not users of " +
            "the service, an organisation is responsible for having a lawful basis " +
            "to hold it and for telling candidates what it does with it.",
        },
        {
          kind: "link",
          text: "What the software does with that information is described in full in:",
          label: "the Scoreboad privacy page",
          href: "/privacy",
        },
      ],
    },
    {
      id: "ai-outputs",
      title: "AI-generated output",
      blocks: [
        {
          kind: "p",
          text:
            "Parsed fields, match scores, screening reports, summaries and drafted " +
            "messages are produced by a language model. They are decision-support " +
            "information and are presented for review, not as findings.",
        },
        {
          kind: "note",
          text:
            "No representation is made that AI output is accurate, complete or " +
            "free from bias. Review it before relying on it, and do not use it as " +
            "the sole basis for a decision about a person.",
        },
      ],
    },
    {
      id: "availability",
      title: "Availability and changes to the service",
      blocks: [
        {
          kind: "p",
          text:
            "Scoreboad is in active development. Features may change, and parts of " +
            "the product described on the website may be added, altered or removed. " +
            "The service is provided as it is, without an availability commitment.",
        },
        {
          kind: "note",
          text: "No uptime level is offered or implied. {{SERVICE LEVEL COMMITMENTS — NONE TODAY; CONFIRM BEFORE OFFERING ANY}}",
        },
      ],
    },
    {
      id: "fees",
      title: "Fees",
      blocks: [
        {
          kind: "p",
          text:
            "There is no charge for Scoreboad today, because there is no billing in " +
            "the product — no plans, no payment step and no subscription running. If " +
            "that changes, it will be published before it takes effect and anyone " +
            "already using the service will be told.",
        },
      ],
    },
    {
      id: "termination",
      title: "Ending use",
      blocks: [
        {
          kind: "p",
          text:
            "An organisation may stop using Scoreboad at any time. We may suspend " +
            "or end access where these terms are breached, or where continuing would " +
            "expose other organisations' data or the service itself to risk.",
        },
        {
          kind: "note",
          text: "{{NOTICE PERIOD, DATA EXPORT ON TERMINATION AND DELETION TIMELINE — COMPLETE BEFORE PRODUCTION}}",
        },
      ],
    },
    {
      id: "liability",
      title: "Disclaimers and liability",
      blocks: [
        {
          kind: "note",
          text:
            "This section is not drafted. Warranty disclaimers, limitation of " +
            "liability, indemnities and their caps are jurisdiction-specific and are " +
            "the part of a terms document that most needs a lawyer. Nothing is " +
            "asserted here in their place. {{DISCLAIMERS, LIMITATION OF LIABILITY " +
            "AND INDEMNITY — DRAFT WITH COUNSEL BEFORE PRODUCTION}}",
        },
      ],
    },
    {
      id: "terms-contact",
      title: "Changes and contact",
      blocks: [
        {
          kind: "p",
          text:
            "When these terms change, the date at the top changes with them.",
        },
        {
          kind: "link",
          text: "There is no legal inbox yet. The contact page explains what does exist:",
          label: "See how to contact Scoreboad",
          href: "/contact",
        },
      ],
    },
  ],
};

// -----------------------------------------------------------------------------
// COOKIES
// -----------------------------------------------------------------------------

export const COOKIES_DOC: LegalDoc = {
  slug: "cookies",
  title: "Cookies at Scoreboad.",
  lead:
    "There are two, both strictly necessary, and neither is set until you sign " +
    "in. There is no analytics, advertising or tracking technology in the " +
    "product or on this website.",
  updated: UPDATED,
  sections: [
    {
      id: "public-site",
      title: "The public website sets no cookies",
      blocks: [
        {
          kind: "p",
          text:
            "Browsing scoreboad.com — the home page, the product pages, this page — " +
            "sets nothing on your device. No cookie, no local storage, no pixel and " +
            "no fingerprinting.",
        },
        {
          kind: "note",
          text:
            "This is why there is no cookie banner. A consent prompt for cookies " +
            "that are never set would be theatre, and clicking it would change " +
            "nothing.",
        },
      ],
    },
    {
      id: "essential",
      title: "The cookies used once you sign in",
      blocks: [
        {
          kind: "table",
          head: ["Cookie", "What it does"],
          rows: [
            [
              "Session",
              "Keeps you signed in. Set by the authentication provider, marked HTTP-only so it cannot be read by scripts, and refreshed on each request.",
            ],
            [
              "Active workspace",
              "Remembers which organisation you last worked in, where you belong to more than one. HTTP-only, and treated only as a hint — it is re-checked against your real memberships on every request, so changing it grants nothing.",
            ],
          ],
        },
        {
          kind: "p",
          text:
            "Both are necessary for the service to function. Blocking them means " +
            "not being able to sign in.",
        },
      ],
    },
    {
      id: "local-storage",
      title: "Local storage",
      blocks: [
        {
          kind: "p",
          text:
            "Inside the signed-in application, one preference is stored in your " +
            "browser rather than on the server: which columns you have chosen to " +
            "show in a table. It stays on your device, is not sent anywhere, and " +
            "identifies nobody.",
        },
      ],
    },
    {
      id: "no-tracking",
      title: "What is not here",
      blocks: [
        {
          kind: "list",
          items: [
            "No analytics of any kind — no page-view counting, no product analytics, no session recording.",
            "No advertising or marketing pixels, and no remarketing tags.",
            "No tag manager, and no third-party script on any public page.",
            "No error-tracking service. Failures go to the server log and no further.",
          ],
        },
        {
          kind: "note",
          text:
            "If any of that is added later, this page and the privacy page change " +
            "first, and a consent mechanism gets built at the same time — not " +
            "afterwards.",
        },
      ],
    },
    {
      id: "cookies-contact",
      title: "Questions",
      blocks: [
        {
          kind: "link",
          text: "How Scoreboad handles information more broadly is described in:",
          label: "the Scoreboad privacy page",
          href: "/privacy",
        },
      ],
    },
  ],
};

export const LEGAL_DOCS: LegalDoc[] = [PRIVACY_DOC, TERMS_DOC, COOKIES_DOC];

/**
 * Every outstanding placeholder, extracted from the documents themselves.
 *
 * DERIVED RATHER THAN MAINTAINED BY HAND, so the production checklist cannot
 * fall out of step with the pages. `legal.test.ts` asserts the list is
 * non-empty and that every marker it finds is upper-case, which is what makes
 * them visible on the page.
 */
export function legalPlaceholders(): string[] {
  const found = new Set<string>();

  for (const doc of LEGAL_DOCS) {
    const strings = [
      doc.updated,
      ...doc.sections.flatMap((section) =>
        section.blocks.flatMap((block) => {
          if (block.kind === "p" || block.kind === "note") return [block.text];
          if (block.kind === "list") return block.items;
          if (block.kind === "link") return [block.text, block.label];
          return block.rows.flat();
        })
      ),
    ];

    for (const value of strings) {
      for (const match of value.matchAll(/\{\{([^}]+)\}\}/g)) {
        found.add(match[1].trim());
      }
    }
  }

  return [...found].sort();
}
