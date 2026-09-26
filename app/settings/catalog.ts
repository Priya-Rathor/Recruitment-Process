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
import { AGENT_TYPES, AGENT_TYPE_META, type AgentType } from "@/lib/agents/types";

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
  /**
   * The category's own landing page, rendered as the card's last line
   * ("View all agents"). Pinned to the card's foot, so it sits at the same
   * height in every card that has one.
   */
  overview?: SettingsLink;
};

/**
 * THE CARD HEIGHT CAP. The grid gives every card the height of the tallest
 * (see `.settings-grid` in globals.scss), so one card is allowed to be tall
 * only because every other card pays for it. Eight is the Agents card — one
 * line per agent type — and catalog.test.ts refuses a ninth link anywhere: the
 * answer then is an `overview` link and a shorter list, not a taller grid.
 */
export const MAX_CARD_LINKS = 8;

/**
 * One link per agent TYPE, derived from lib/agents/types.ts so a type added
 * there appears here without a second list to update.
 *
 * Where a type has its own configuration page, the link goes there. The voice
 * console and the WhatsApp settings are Owner/Admin pages — the same rule
 * those pages enforce — so a Recruiter gets the Agent Center filtered to the
 * type instead, which RLS lets every member read. Every other type is
 * configured per agent, so its link is the Agent Center filtered to it
 * (`?type=`), with a "create one" step when none exists yet.
 */
const AGENT_PAGES: Partial<Record<AgentType, string>> = {
  voice_screening: "/settings/agents/voice",
  whatsapp_reply: "/settings/agents/whatsapp",
};

const AGENT_LINKS: SettingsLink[] = AGENT_TYPES.map((type) => ({
  href: AGENT_PAGES[type] ?? `/settings/agents?type=${type}`,
  label: AGENT_TYPE_META[type].label,
  description: AGENT_TYPE_META[type].purpose,
  roles: AGENT_PAGES[type] ? ["owner", "admin"] : undefined,
}));

/**
 * The categories, in the order the grid renders them — four across on desktop,
 * so General, Recruitment, Agents and Automation make the first row.
 *
 * AGENTS AND AUTOMATION ARE TWO CARDS, NEVER ONE. An agent is an AI capability
 * that does a recruitment task (screens a CV, makes a call, replies to a
 * message); an automation is a rule that connects an event to actions. A rule
 * may START an agent, which is exactly why merging the two read as one thing —
 * "AI & Agents" once held both. catalog.test.ts keeps them apart.
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
    /*
      How THIS organization hires: the defaults, the stage targets, the extra
      fields it records and what a new hire owes. Custom fields moved here from
      "Data & activity" — they decide what is recorded on jobs and candidates,
      which is recruitment configuration, not an activity log.
    */
    label: "Recruitment",
    links: [
      {
        href: "/settings/recruitment",
        label: "Recruitment defaults",
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
        /*
          Every member may open it — Viewers are read-only inside it (Module 27
          §6) rather than shut out, because somebody looking at a job with a
          "Visa sponsorship" field should be able to find out what it is.
        */
        href: "/settings/custom-fields",
        label: "Custom fields",
        description: "Extra fields on jobs, candidates and applications",
      },
      {
        href: "/settings/onboarding",
        label: "Onboarding documents",
        description: "The checklist every new hire owes",
        roles: ["owner", "admin"],
      },
    ],
  },
  {
    /*
      THE AGENT DIRECTORY. Every agent type, by its Scoreboad name — never the
      provider that runs it (voice calls go through an integration; that is an
      Integrations detail, not the agent's identity). The overview is the Agent
      Center itself: no `roles`, because any member may see which agents work
      their pipeline (RLS allows the read); the page gates the controls.
    */
    label: "Agents",
    links: AGENT_LINKS,
    overview: {
      href: "/settings/agents",
      label: "View all agents",
      description: "Every agent in this organization, with its status and where it is used",
    },
  },
  {
    /*
      Rules, not agents. Every link leaves Settings for the existing automation
      pages — no second configuration surface. /automations and its approvals
      queue are open to every member and gate EDITING to Owner/Admin, matching
      the top nav; creating a rule is Owner/Admin, as its page enforces.
    */
    label: "Automation",
    links: [
      {
        href: "/automations",
        label: "Automation rules",
        description: "Triggers, conditions and the actions they take",
        external: true,
      },
      {
        href: "/automations/new",
        label: "Create a rule",
        description: "Start a new trigger-and-action rule",
        roles: ["owner", "admin"],
        external: true,
      },
      {
        href: "/automations/approvals",
        label: "Approvals",
        description: "Actions waiting for a person to decide",
        external: true,
      },
      {
        href: "/automations#recent-runs",
        label: "Run history",
        description: "What each rule did, and when",
        external: true,
      },
    ],
  },
  {
    /*
      What we SAY to candidates and what they fill in: templates, the two
      channels that carry them, and the forms. Templates lead — the page people
      open most and the only one here they edit rather than configure once.
    */
    label: "Candidate communication",
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
      {
        href: "/settings/forms",
        label: "Forms",
        description: "Application forms and questionnaires",
        /*
          RECRUITERS TOO: a form is the thing a recruiter shares to fill their
          own pipeline, so gating it behind an Owner would make "put this role
          online" a request rather than a task.
        */
        roles: ["owner", "admin", "recruiter"],
      },
    ],
  },
  {
    /*
      CONNECTIONS, NOT AGENTS: the services agents and features run on.

      "Voice calling", not the vendor's name. The recruiter-facing identity is
      the agent ("Voice Screening Agent"); which company places the call is an
      implementation detail, named only on the Integrations page itself, where
      an admin pastes that company's API key and needs to know whose key it is.
    */
    label: "Integrations",
    links: [
      {
        href: "/settings/integrations#integration-bolna",
        label: "Voice calling",
        description: "The calling service voice agents use",
        roles: ["owner", "admin"],
      },
      {
        href: "/settings/integrations#integration-calendar",
        label: "Google Calendar",
        description: "Interview invites and Google Meet video links",
        roles: ["owner", "admin"],
      },
      {
        href: "/settings/integrations#integration-llm",
        label: "AI provider",
        description: "The model behind agents, parsing and matching",
        roles: ["owner", "admin"],
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
        // Retention is a form on THIS page (RetentionForm.tsx), so it is named
        // in the description rather than listed as a second link to one form.
        href: "/settings/security",
        label: "Security & data",
        description: "Data retention, what's protected, danger zone",
        roles: ["owner", "admin"],
      },
    ],
  },
  {
    label: "Data & activity",
    links: [
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
export const SETTINGS_LINKS: SettingsLink[] = SETTINGS_CATEGORIES.flatMap((category) =>
  category.overview ? [...category.links, category.overview] : category.links
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
  const allowed = (link: SettingsLink) => !link.roles || hasRole(role, link.roles);
  return SETTINGS_CATEGORIES.map((category) => ({
    label: category.label,
    links: category.links.filter(allowed),
    overview: category.overview && allowed(category.overview) ? category.overview : undefined,
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
