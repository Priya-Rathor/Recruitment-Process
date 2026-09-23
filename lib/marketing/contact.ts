// =============================================================================
// The Contact page's copy, and its validation.
//
// -----------------------------------------------------------------------------
// §1's INSPECTION: THERE IS NO CONTACT BACKEND, AND THERE IS NO WAY TO BUILD
// ONE WITHOUT INVENTING SOMETHING
// -----------------------------------------------------------------------------
//
// Searched for, and absent: a contact or demo page, a contact form, a lead or
// enquiry table, a scheduling integration, Calendly, Cal.com, a CRM, and any
// published address. `find` and `grep` across app/, lib/, components/ and
// supabase/migrations/ return nothing for any of them.
//
// THE EMAIL ADAPTER CANNOT BE REUSED, and this is the part worth stating
// precisely rather than assuming. lib/integrations/email is TENANT-SCOPED: its
// credentials live in organization_integrations, encrypted, readable only
// through the service-role client with an organization_id filter. A visitor to
// the marketing site has no organization, so there is no row to read a
// credential from. It also fails closed by design — "not configured" is
// reported as skipped rather than sent. There is no deployment-wide fallback
// SMTP and no default provider, deliberately.
//
// So a working contact form would need: a new public table, a new public API
// route, spam protection on it, and a destination address that does not exist.
// That is a backend feature, it is not Module 21, and §10 forbids the shortcut
// ("Do not create a fake API endpoint just to make the animation work").
//
// -----------------------------------------------------------------------------
// WHAT THIS PAGE DOES INSTEAD, AND WHY IT IS NOT A COMPROMISE
// -----------------------------------------------------------------------------
//
// Module 18 already settled this for the whole site, in PRICING_CTA:
//
//   "/signup is real. There is deliberately NO 'talk to sales' or 'request a
//    demo': no contact route exists, and a button that opens nothing is worse
//    than no button."
//
// The same reasoning applies to a form that sends nothing — so the form on this
// page says so BEFORE it is filled in, not after. §4 is explicit that where
// signup is the real conversion path, signup is the primary action. It is, it
// costs nothing, it takes no card, and it works today.
//
// The form itself is real in every respect that does not require a server: real
// labels, real autocomplete, real inline validation shared with a future server
// route, real submission states. What it never does is claim delivery.
//
// NOT INVENTED HERE: no sales or support address, no booking link, no response
// time, no CRM, no customer count, no rating, no testimonial.
// =============================================================================

export const CONTACT_HERO = {
  title: "Let's build a better hiring workflow.",
  /*
    §2's suggested lead says "we'll show you how Scoreboad can fit into your
    workflow", which is a promise of a person doing something. Nobody is
    staffing an inbox, so the lead says what is actually available instead —
    and the page is useful precisely because it does not make the reader find
    that out at the end of a form.
  */
  lead:
    "Scoreboad connects jobs, candidates, screening, interviews and evaluation " +
    "in one workflow. The quickest way to see whether it fits your team is to " +
    "open an account and walk through it — it costs nothing and takes no card.",
  /** The hero diagram's beats, and its text equivalent. */
  flow: [
    { label: "Your team", note: "The people already doing the hiring" },
    { label: "Scoreboad", note: "One workspace the whole process runs in" },
    { label: "Connected hiring", note: "Every stage on one record, decided by a person" },
  ],
  /** The nodes the orb resolves into (§15). Real product surfaces only. */
  nodes: ["Candidates", "Interviews", "Evaluation", "Pipeline"],
} as const;

/**
 * §4 — ONE primary action, and it is the one that works.
 *
 * The secondary is a read, not a second conversion: two competing primary CTAs
 * is the thing §4 rules out.
 */
export const CONTACT_CTA = {
  primary: { label: "Create an account", href: "/signup" },
  secondary: { label: "See the full walkthrough", href: "/how-it-works" },
} as const;

/**
 * §10's honest status, shown ABOVE the form rather than after it.
 *
 * A visitor who fills in five fields and then learns nothing was sent has been
 * wasted; a visitor told first can decide. This is the whole difference between
 * building the UI without claiming submission and quietly faking it.
 */
export const CONTACT_FORM_NOTICE = {
  title: "This form does not send yet.",
  body:
    "There is no inbox behind it — no sales address, no demo booking and no " +
    "scheduling tool — so nothing here would reach anybody, and saying " +
    "otherwise would be the easiest lie on this site to tell. The form works " +
    "for drafting and checking what you would send, and the account route " +
    "below is the one that is live today.",
} as const;

/**
 * §5 — the fields. Short, and nothing personal that is not needed.
 *
 * NO PHONE NUMBER: §5 rules it out unless genuinely required, and nobody could
 * ring it. No candidate information, no resume, no hiring detail that would be
 * somebody else's personal data.
 */
export const CONTACT_FIELDS: {
  name: ContactFieldName;
  label: string;
  type: "text" | "email" | "textarea";
  /** Maps to the HTML autocomplete token, for §23. */
  autoComplete?: string;
  required: boolean;
  hint?: string;
}[] = [
  { name: "name", label: "Name", type: "text", autoComplete: "name", required: true },
  {
    name: "email",
    label: "Work email",
    type: "email",
    autoComplete: "email",
    required: true,
  },
  {
    name: "company",
    label: "Company",
    type: "text",
    autoComplete: "organization",
    required: false,
  },
  {
    name: "role",
    label: "Your role",
    type: "text",
    autoComplete: "organization-title",
    required: false,
  },
  {
    name: "message",
    label: "What are you hiring for?",
    type: "textarea",
    required: true,
    hint: "Roles you are filling and how your team works today. No candidate details, please.",
  },
];

export type ContactFieldName = "name" | "email" | "company" | "role" | "message";

export type ContactValues = Record<ContactFieldName, string>;

export type ContactErrors = Partial<Record<ContactFieldName, string>>;

export const CONTACT_LIMITS = {
  nameMax: 80,
  emailMax: 160,
  companyMax: 100,
  roleMax: 100,
  messageMin: 10,
  messageMax: 2000,
} as const;

/** The project's email shape, identical to lib/forms/validation.ts's. */
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export const EMPTY_CONTACT: ContactValues = {
  name: "",
  email: "",
  company: "",
  role: "",
  message: "",
};

/**
 * Validation, as a PURE FUNCTION over plain values.
 *
 * WHY IT LIVES HERE AND NOT IN THE COMPONENT. This is the shape the public
 * application form already uses: `validateAnswers()` sits in lib/ and is called
 * by the client for inline errors AND by the server before anything is written,
 * so the two can never disagree. There is no server route to call it yet — but
 * when there is, it calls this, and the rule is already written once.
 *
 * Hand-written, because this project has no schema library on purpose
 * (AGENTS.md: "no ORM, no schema library... That is a decision, not an
 * oversight"). Adding Zod for five fields would be the dependency that rule
 * exists to prevent.
 */
export function validateContact(values: ContactValues): ContactErrors {
  const errors: ContactErrors = {};

  const name = values.name.trim();
  if (name.length === 0) errors.name = "Enter your name.";
  else if (name.length > CONTACT_LIMITS.nameMax) {
    errors.name = `Keep this under ${CONTACT_LIMITS.nameMax} characters.`;
  }

  const email = values.email.trim();
  if (email.length === 0) errors.email = "Enter your work email.";
  else if (email.length > CONTACT_LIMITS.emailMax) {
    errors.email = `Keep this under ${CONTACT_LIMITS.emailMax} characters.`;
  } else if (!EMAIL_PATTERN.test(email)) {
    errors.email = "That does not look like an email address.";
  }

  const company = values.company.trim();
  if (company.length > CONTACT_LIMITS.companyMax) {
    errors.company = `Keep this under ${CONTACT_LIMITS.companyMax} characters.`;
  }

  const role = values.role.trim();
  if (role.length > CONTACT_LIMITS.roleMax) {
    errors.role = `Keep this under ${CONTACT_LIMITS.roleMax} characters.`;
  }

  const message = values.message.trim();
  if (message.length === 0) errors.message = "Tell us what you are hiring for.";
  else if (message.length < CONTACT_LIMITS.messageMin) {
    errors.message = `A little more detail — at least ${CONTACT_LIMITS.messageMin} characters.`;
  } else if (message.length > CONTACT_LIMITS.messageMax) {
    errors.message = `Keep this under ${CONTACT_LIMITS.messageMax} characters.`;
  }

  return errors;
}

/**
 * §13 — the product in one line each, linking to pages that exist.
 *
 * Six stages rather than a second homepage: somebody who reached the contact
 * page has already read a page or two, and what they need here is a way back
 * into the specific part they are evaluating.
 */
export const CONTACT_PRODUCT: { label: string; href: string; note: string }[] = [
  { label: "Jobs and candidates", href: "/product/source", note: "Where applications arrive and become records" },
  { label: "Resume screening", href: "/product/understand", note: "Parsed into fields a person confirms" },
  { label: "Screening calls", href: "/product/screen", note: "An automated first call, returned as a report" },
  { label: "Interviews and evaluation", href: "/product/decide", note: "Rounds, feedback and one panel to weigh it on" },
  { label: "Offers and hiring", href: "/product/close", note: "The decision, recorded against the person who made it" },
  { label: "Security and isolation", href: "/security", note: "How access, workspaces and AI output are controlled" },
];

/**
 * §14 — what actually happens next.
 *
 * THIS IS THE REAL ONBOARDING SEQUENCE, not a sales process: sign up, confirm,
 * land on /onboarding and create a workspace. No "30-minute demo", no response
 * time and no personalised onboarding, because none of those exists.
 */
export const CONTACT_NEXT: { num: string; label: string; body: string }[] = [
  {
    num: "01",
    label: "Create an account",
    body: "Email and a password, or Google. No card, and no trial counting down.",
  },
  {
    num: "02",
    label: "Set up your workspace",
    body: "Name the organisation, invite whoever is hiring with you, and pick the roles they hold.",
  },
  {
    num: "03",
    label: "Open your first job",
    body: "Add a job, share its application link, and the rest of the workflow follows from it.",
  },
];

/**
 * §21 — trust signals, and each is a mechanism described at length on /security
 * rather than a claim invented for this page.
 */
export const CONTACT_TRUST: string[] = [
  "A person makes every hiring decision. AI output is checked in code and reviewed on screen before it counts for anything.",
  "Candidate information stays inside the workspace that owns it, enforced by row-level policies rather than by the code that queries them.",
  "No certification is held and none is claimed. What is not built yet is named on the page that describes it.",
];

/**
 * §22 — the privacy note.
 *
 * DELIBERATELY NOT the suggested "you agree that Scoreboad may use your
 * information to respond to your request": nothing is submitted, nobody
 * responds, and there is no published privacy policy to link to. Saying what
 * actually happens to the text is both shorter and true.
 */
export const CONTACT_PRIVACY_NOTE =
  "Nothing you type here is sent or stored. It stays in your browser until you " +
  "close the tab.";
