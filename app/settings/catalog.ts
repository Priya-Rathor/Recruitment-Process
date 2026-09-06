// =============================================================================
// The settings catalogue — ONE list, two consumers.
//
// The landing grid and the per-page role checks both read from here. That is the
// whole point of the file: the previous structure kept the section list inside
// SettingsShell, and a grid built beside it would have been a second list to keep
// in step. The way those two drift is not cosmetic — a link in the grid whose
// section was renamed becomes a 404, and a section removed from one list but not
// the other becomes either an invisible page or a dead card.
//
// EVERY ENTRY POINTS AT A ROUTE THAT EXISTS. There are no placeholder categories
// and no "coming soon" rows: a card listing something unbuilt teaches people to
// distrust the whole page. `catalog.test.ts` walks the app directory and asserts
// each href resolves to a real page file, so this cannot rot silently.
//
// PURE DATA. No React, no database — imported by a server component, a client
// component and a test.
// =============================================================================
import type { OrgRole } from "@/lib/types";
import { hasRole } from "@/lib/tenant";

export type SettingsLink = {
  href: string;
  label: string;
  /** One line, shown under the label in the grid. */
  description: string;
  /** Roles that may open it. Omitted means every member. */
  roles?: OrgRole[];
  /**
   * True when the target is NOT under /settings.
   *
   * Audit log and analytics are full product surfaces that happen to be what
   * somebody in Settings is looking for. Marked so the grid can say the link
   * leaves the settings area rather than quietly navigating somewhere with a
   * different shell and no "back to Settings" link.
   */
  external?: boolean;
};

export type SettingsCategory = {
  label: string;
  links: SettingsLink[];
};

/**
 * The categories, in the order the grid renders them.
 *
 * Grouped by what somebody is trying to DO, which is why "Screening" sits with
 * the recruitment defaults rather than with Integrations: the person setting
 * retry delays is planning a hiring process, not connecting a service.
 */
export const SETTINGS_CATEGORIES: SettingsCategory[] = [
  {
    label: "General",
    links: [
      {
        href: "/settings/organization",
        label: "Organization",
        description: "Name, timezone, branding",
        roles: ["owner", "admin"],
      },
      {
        href: "/settings/users",
        label: "Team & permissions",
        description: "Who can do what",
      },
      {
        href: "/settings/notifications",
        label: "Notifications",
        description: "What reaches you, and how",
      },
    ],
  },
  {
    label: "Recruitment defaults",
    links: [
      {
        href: "/settings/recruitment",
        label: "Recruitment",
        description: "Defaults for new applications and interviews",
        roles: ["owner", "admin"],
      },
      {
        href: "/settings/pipeline",
        label: "Pipeline",
        description: "Stage SLA targets",
        roles: ["owner", "admin"],
      },
      {
        href: "/settings/screening",
        label: "Screening",
        description: "Call attempts, retry delay, language",
        roles: ["owner", "admin"],
      },
    ],
  },
  {
    /*
      Two items since Message templates moved to Communications, and that is
      fine — the grid's balance rule is 2-3, and Privacy & security has sat at
      two since it was created.

      What is left is coherent rather than leftover: a form is what a candidate
      fills in and a document checklist is what they owe after being hired. Both
      are things a candidate does. The templates card is what we SAY to them,
      which is a different job and now sits with the channels that carry it.
    */
    label: "Candidate-facing",
    links: [
      {
        href: "/settings/forms",
        label: "Forms",
        description: "Application forms and questionnaires",
        /*
          RECRUITERS TOO, unlike most of this list — the reasoning moved here with
          the entry. A form is the thing a recruiter shares to fill their own
          pipeline, so gating it behind an Owner would make "put this role online"
          a request rather than a task.
        */
        roles: ["owner", "admin", "recruiter"],
      },
      {
        href: "/settings/onboarding",
        label: "Onboarding documents",
        description: "The checklist every new hire owes",
        roles: ["owner", "admin"],
      },
    ],
  },
  /*
    TWO INTEGRATION CARDS, NOT ONE.

    One card holding all six integration links was the page's only real layout
    problem: at six items beside cards of two and three, it set the height of
    whatever row it landed in and left a well of white space under its
    neighbours. Splitting it fixes the CONTENT imbalance, which is why no
    masonry or height-matching CSS is needed — every card is now 2-3 items and
    natural heights land within a line or two of each other.

    The split follows the detail page's own grouping, so somebody who knows that
    page recognises these names. One difference worth knowing: the detail page
    has THREE groups (Calling & scheduling / Communication / AI & automation) and
    this grid has two, because a third card of one item would reintroduce the
    imbalance in the opposite direction. "Communication & AI" is the merge.

    Each href still carries its own card's anchor — the destinations are
    untouched, only which card lists them changed.
  */
  {
    label: "Calling & scheduling",
    links: [
      {
        href: "/settings/integrations#integration-bolna",
        label: "Bolna AI",
        description: "Automated screening calls",
        roles: ["owner", "admin"],
      },
      {
        href: "/settings/integrations#integration-calendar",
        label: "Google Calendar",
        description: "Interview invites and Meet links",
        roles: ["owner", "admin"],
      },
      {
        href: "/settings/integrations/bolna",
        label: "Voice agent console",
        /*
          Sits with Bolna AI because it configures that integration — the
          console is what the screening call says, and Bolna is what places it.
          A SHORTCUT, not a second home: the console still lives inside the
          integration card that owns it, and this reaches the same page directly
          because "change what the call says" is a weekly task.
        */
        description: "What the screening call says and how it sounds",
        roles: ["owner", "admin"],
      },
    ],
  },
  {
    /*
      CHANNELS AND CONTENT TOGETHER.

      Email lived here and Message templates lived under Candidate-facing — two
      cards for one workflow. Connecting a channel and writing what goes through
      it is a single task in a recruiter's head, and splitting it meant
      remembering two places to manage one thing.

      Templates lead, deliberately. It is the page people open most often and the
      only one here they edit rather than configure once; the two channel cards
      below it are connect-and-forget.
    */
    label: "Communications",
    links: [
      {
        href: "/settings/templates",
        label: "Message templates",
        description: "What candidates are told, and when",
        roles: ["owner", "admin"],
      },
      {
        href: "/settings/integrations#integration-email",
        label: "Email",
        description: "Delivers notifications and reminders outside the app",
        roles: ["owner", "admin"],
      },
      {
        href: "/settings/integrations#integration-whatsapp",
        label: "WhatsApp Business",
        description: "Candidate messages, alongside email",
        roles: ["owner", "admin"],
      },
    ],
  },
  {
    /*
      AI provider left Communications because it is not a channel — it is the
      model the AI Service Layer runs on, and it powers resume parsing and
      matching, neither of which talks to anybody.

      Automations sits here rather than with Communications for the reason worth
      writing down: a rule can send a message, but it can also start a screening
      call, move a stage or assign a recruiter. Filing it under Communications
      would describe one of its actions as if it were all of them.
    */
    label: "AI & automation",
    links: [
      {
        href: "/settings/integrations#integration-llm",
        label: "AI provider",
        description: "Resume parsing, matching and drafting",
        roles: ["owner", "admin"],
      },
      {
        href: "/automations",
        label: "Automations",
        description: "Rules that trigger messages, calls, and reminders",
        /*
          NO `roles`, matching the page itself.

          /automations uses requireMembershipOrRedirect() and gates only EDITING
          to Owner/Admin — any member may open it and read the rules — and the top
          nav shows it to every role. Restricting the Settings link to Owner/Admin
          would hide a page the same person can already reach from the nav bar.

          Links to the EXISTING rule list. No second automations configuration
          page: run history, approvals and the scheduler all live there already.
        */
        external: true,
      },
    ],
  },
  {
    label: "Privacy & security",
    links: [
      {
        href: "/settings/privacy",
        label: "Privacy & consent",
        description: "Recording, consent disclosures, data rights",
        roles: ["owner", "admin"],
      },
      {
        href: "/settings/security",
        label: "Security & data",
        /*
          Data retention is NOT a separate row.

          The brief allowed for one under "Data & activity" if it were distinct
          from Privacy & consent. It is neither — retention is a form on THIS
          page (app/settings/security/RetentionForm.tsx). A third link to the
          same form would be the duplication the brief asked to avoid, so the
          description names retention instead.
        */
        description: "Data retention, what's protected, danger zone",
        roles: ["owner", "admin"],
      },
    ],
  },
  {
    label: "Data & activity",
    links: [
      {
        /*
          MODULE 27, AND NOT UNDER "Recruitment defaults" WHERE THE BRIEF
          SUGGESTED IT.

          That category is already at three, and the 2-3 balance rule below is
          enforced by catalog.test.ts, not merely preferred — a fourth card there
          fails the suite. The brief allowed for this ("or a new small entry
          there"), and a one-item category of its own would fail the same rule
          from the other side.

          This is the better home anyway: custom fields decide WHAT this
          organization records, which is the same subject as the log of changes to
          it and the export of it. Every member may open the page — Viewers are
          read-only inside it (brief §6) rather than shut out, because somebody
          looking at a job with a "Visa sponsorship" field should be able to find
          out what that field is.
        */
        href: "/settings/custom-fields",
        label: "Custom fields",
        description: "Extra fields on jobs, candidates and applications",
      },
      {
        href: "/audit-log",
        label: "Audit log",
        description: "Every sensitive action, append-only",
        roles: ["owner", "admin"],
        external: true,
      },
      {
        href: "/analytics",
        label: "Export data",
        /*
          The CSV export has no settings page of its own — it is a download button
          on Analytics, scoped to whatever that page is filtered to, which is the
          only place the filters exist. Linking there is honest; inventing a
          settings-side export screen that produced a different file would not be.
        */
        description: "CSV of the current analytics view",
        external: true,
      },
    ],
  },
];

/**
 * The flat list, for anything that needs sections rather than categories.
 *
 * Derived, never maintained separately — that was the drift this file exists to
 * prevent.
 */
export const SETTINGS_LINKS: SettingsLink[] = SETTINGS_CATEGORIES.flatMap(
  (category) => category.links
);

/** Every settings link this role may open, ignoring categories. */
export function visibleLinks(role: OrgRole): SettingsLink[] {
  return SETTINGS_LINKS.filter((link) => !link.roles || hasRole(role, link.roles));
}

/**
 * The grid this role should see.
 *
 * A category whose every link is hidden is DROPPED, not rendered empty. The
 * settings area already follows the rule that a section a role cannot open is
 * hidden rather than greyed out — an empty "Integrations" card would reintroduce
 * exactly the wall of locked doors that rule exists to prevent.
 */
export function visibleCategories(role: OrgRole): SettingsCategory[] {
  return SETTINGS_CATEGORIES.map((category) => ({
    label: category.label,
    links: category.links.filter((link) => !link.roles || hasRole(role, link.roles)),
  })).filter((category) => category.links.length > 0);
}

/**
 * Where to send someone who has no business on the landing grid.
 *
 * Kept because /settings is reachable by URL for a Recruiter even though the top
 * nav hides it. Returns null when the role can open nothing at all, which the
 * caller turns into a plain "nothing here for you" rather than a redirect loop.
 */
export function firstVisibleHref(role: OrgRole): string | null {
  return visibleLinks(role)[0]?.href ?? null;
}
