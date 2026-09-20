// =============================================================================
// THE SITE'S INFORMATION ARCHITECTURE.
//
// THE WHOLE LONG-TERM STRUCTURE IS HERE, INCLUDING THE PARTS THAT DO NOT EXIST
// YET — and that is the point of the file rather than an accident of it.
//
// The brief asks for six top-level menus (Products, Solutions, Who It's For,
// Integrations, Resources, Pricing) covering roughly thirty destinations. The
// site currently has ELEVEN real URLs. It also says, repeatedly, not to create
// broken links and not to create empty pages to satisfy a nav.
//
// Those instructions only conflict if the architecture and the rendering are
// the same thing. So they are separated:
//
//   - every item the site will eventually have is declared here, in the order
//     and grouping it will eventually have;
//   - each carries a `status`. "live" means the destination exists today;
//     "planned" means it does not;
//   - the navbar renders ONLY live items, and drops a group or a menu that has
//     none left.
//
// Turning a page on in a later module is therefore a one-word edit — change
// "planned" to "live" — and `lib/marketing/navigation.test.ts` fails until the
// route actually resolves. The architecture is committed; the dead links are
// not shipped.
//
// WHY THE LIVE DESTINATIONS ARE WHAT THEY ARE. Two menus turned out to be real
// with no new pages at all:
//
//   - PRODUCTS maps onto the six /product/* capability pages, which already
//     exist and already have headings worth using as descriptions.
//   - WHO IT'S FOR maps onto the four role sections already rendered on
//     /how-it-works. They were not addressable, so this module gives them ids.
//     That is making existing content reachable, not inventing a page.
//
// Solutions, Integrations and Pricing have no destinations of any kind, so they
// are declared and not rendered. Pricing in particular must NOT be faked: the
// FAQ on the home page says pricing is not published, and a Pricing link would
// contradict the page it sits on.
// =============================================================================

export type NavStatus = "live" | "planned";

export type NavLeaf = {
  label: string;
  /** Root-relative. Checked against INTERNAL_ROUTES when status is "live". */
  href: string;
  /** One line, shown in the mega menu. Omitted in the mobile accordion. */
  description?: string;
  status: NavStatus;
};

export type NavGroup = {
  /** The column heading inside a mega menu. */
  title: string;
  items: NavLeaf[];
};

export type NavEntry =
  /** A plain link in the bar. */
  | { kind: "link"; label: string; href: string; status: NavStatus }
  /** A mega menu. Rendered only if at least one descendant is live. */
  | { kind: "menu"; label: string; groups: NavGroup[]; status: NavStatus };

/**
 * THE ARCHITECTURE.
 *
 * Labels are descriptive rather than clever — "AI Candidate Screening" instead
 * of "Screen" — because a nav label is the anchor text of an internal link and
 * the first description of a page a crawler sees. That is the SEO instruction
 * in the brief, and it stops short of keyword stuffing: each label is what a
 * person would call the page out loud.
 */
export const NAVIGATION: NavEntry[] = [
  {
    kind: "menu",
    label: "Products",
    status: "live",
    groups: [
      {
        title: "Hiring platform",
        items: [
          {
            label: "Jobs & Candidates",
            href: "/product/source",
            description: "Every requirement, candidate and application in one place.",
            status: "live",
          },
          {
            label: "Hiring Pipeline",
            href: "/product/decide",
            description: "A pipeline that tells you what is going wrong.",
            status: "live",
          },
          // Declared, not rendered. A dedicated overview page does not exist.
          { label: "Platform Overview", href: "/platform", status: "planned" },
        ],
      },
      {
        title: "AI recruitment",
        items: [
          {
            label: "AI Resume Intelligence",
            href: "/product/understand",
            description: "Read every resume, without reading every resume.",
            status: "live",
          },
          {
            label: "AI Candidate Screening",
            href: "/product/screen",
            description: "First-round screening calls that actually happen.",
            status: "live",
          },
          { label: "AI Interviews", href: "/platform/ai-interviews", status: "planned" },
          { label: "Candidate Evaluation", href: "/platform/evaluation", status: "planned" },
        ],
      },
      {
        title: "Recruitment operations",
        items: [
          {
            label: "Offers & Onboarding",
            href: "/product/close",
            description: "From offer to first day, without a spreadsheet.",
            status: "live",
          },
          {
            label: "Analytics & Automation",
            href: "/product/operate",
            description: "Measure it, automate it, and know who changed what.",
            status: "live",
          },
          { label: "Interview Management", href: "/platform/interviews", status: "planned" },
          { label: "Candidate Communication", href: "/platform/communication", status: "planned" },
        ],
      },
    ],
  },

  /*
    SOLUTIONS — declared in full, rendered not at all.

    Every one of these is a page that should exist and does not. They are the
    highest-value SEO targets on the list, which is exactly why shipping them
    as dead links would be the wrong trade: a 404 from a site-wide nav is worse
    for a crawler than an absent link.
  */
  {
    kind: "menu",
    label: "Solutions",
    status: "planned",
    groups: [
      {
        title: "By need",
        items: [
          { label: "AI Recruitment", href: "/solutions/ai-recruitment", status: "planned" },
          { label: "Candidate Screening", href: "/solutions/candidate-screening", status: "planned" },
          { label: "AI Interviews", href: "/solutions/ai-interviews", status: "planned" },
          { label: "Recruitment Automation", href: "/solutions/recruitment-automation", status: "planned" },
        ],
      },
    ],
  },

  {
    kind: "menu",
    label: "Who It's For",
    status: "live",
    groups: [
      {
        title: "By team",
        items: [
          /*
            These four are the role sections already rendered on
            /how-it-works. This module gave them ids so they could be linked;
            no page was created. The descriptions are the summaries those
            sections already carry, so the menu and the page agree by
            construction.
          */
          {
            label: "Recruitment Agencies",
            href: "/how-it-works#for-agency-recruiter",
            description: "Many clients, many roles, and submissions to track.",
            status: "live",
          },
          {
            label: "In-house Talent Teams",
            href: "/how-it-works#for-in-house-talent-team",
            description: "Fewer roles, deeper process, more stakeholders.",
            status: "live",
          },
          {
            label: "Hiring Managers",
            href: "/how-it-works#for-hiring-manager",
            description: "You do not want a recruiting tool. You want a decision.",
            status: "live",
          },
          {
            label: "Candidate Experience",
            href: "/how-it-works#for-candidate",
            description: "They never signed up for this product, and never have to.",
            status: "live",
          },
          { label: "Startups", href: "/for/startups", status: "planned" },
          { label: "HR Teams", href: "/for/hr-teams", status: "planned" },
        ],
      },
    ],
  },

  /*
    INTEGRATIONS — declared, not rendered.

    The integrations themselves are real and built (Google Calendar, an
    OpenAI-compatible LLM, an email provider, Bolna voice, WhatsApp Business,
    n8n). What does not exist is a PAGE about them, and a menu of six items
    that all 404 is not better than no menu.
  */
  {
    kind: "menu",
    label: "Integrations",
    status: "planned",
    groups: [
      {
        title: "Connect",
        items: [
          { label: "Calendar", href: "/integrations/calendar", status: "planned" },
          { label: "Video Meetings", href: "/integrations/video", status: "planned" },
          { label: "Email", href: "/integrations/email", status: "planned" },
          { label: "AI Voice", href: "/integrations/voice", status: "planned" },
          { label: "API & Webhooks", href: "/integrations/api", status: "planned" },
        ],
      },
    ],
  },

  {
    kind: "menu",
    label: "Resources",
    status: "live",
    groups: [
      {
        title: "Learn",
        items: [
          {
            label: "How Scoreboad Works",
            href: "/how-it-works",
            description: "The full hiring flow, end to end.",
            status: "live",
          },
          {
            label: "AI Safety Model",
            href: "/how-it-works#ai-safety",
            description: "Where AI assists, and where a person decides.",
            status: "live",
          },
          {
            /*
              CARRIED OVER FROM THE FLAT NAV THIS REPLACED, which had a "Trust"
              link. The section is real and rendered on the home page, and
              dropping it in a reorganisation would have quietly removed the
              only nav route to the security copy.
            */
            label: "Security & Trust",
            href: "/#trust",
            description: "Tenant isolation, consent, and what is not certified.",
            status: "live",
          },
          {
            label: "Frequently Asked Questions",
            href: "/#faq",
            description: "The awkward questions, answered plainly.",
            status: "live",
          },
          { label: "Blog", href: "/blog", status: "planned" },
          { label: "Guides", href: "/resources/guides", status: "planned" },
          { label: "Documentation", href: "/docs", status: "planned" },
        ],
      },
    ],
  },

  /*
    PRICING — declared, not rendered, and the one item that would be actively
    dishonest to ship. The home page's FAQ says pricing is not published yet,
    so a Pricing link in the bar above it would contradict the page it sits on.
  */
  { kind: "link", label: "Pricing", href: "/pricing", status: "planned" },
];

// -----------------------------------------------------------------------------
// Rendering helpers
// -----------------------------------------------------------------------------

/** A group with only its live items, or null when nothing in it is live. */
function liveGroup(group: NavGroup): NavGroup | null {
  const items = group.items.filter((item) => item.status === "live");
  return items.length > 0 ? { ...group, items } : null;
}

/**
 * What the navbar actually renders.
 *
 * A menu whose every descendant is planned disappears entirely rather than
 * opening onto an empty panel — an empty mega menu is a worse experience than
 * an absent one, and it advertises the gap.
 */
export function liveNavigation(): NavEntry[] {
  const out: NavEntry[] = [];

  for (const entry of NAVIGATION) {
    if (entry.kind === "link") {
      if (entry.status === "live") out.push(entry);
      continue;
    }

    const groups = entry.groups
      .map(liveGroup)
      .filter((group): group is NavGroup => group !== null);

    if (groups.length > 0) out.push({ ...entry, groups });
  }

  return out;
}

/** Every live destination, for the link-integrity test. */
export function liveHrefs(): string[] {
  const hrefs: string[] = [];

  for (const entry of NAVIGATION) {
    if (entry.kind === "link") {
      if (entry.status === "live") hrefs.push(entry.href);
      continue;
    }
    for (const group of entry.groups) {
      for (const item of group.items) {
        if (item.status === "live") hrefs.push(item.href);
      }
    }
  }

  return hrefs;
}

/**
 * Whether a menu should show as current, given the path being viewed.
 *
 * MATCHED ON THE DECLARED HREFS rather than on a hardcoded prefix list, so a
 * menu gaining an item automatically gains its active state too. `/product/x`
 * lights up Products; a future `/solutions/y` will light up Solutions the day
 * that item goes live, with no second place to update.
 *
 * ANCHORED ITEMS DO NOT CLAIM THE PAGE THEY SIT ON, and that rule is the whole
 * subtlety here. "Who It's For" is built from `/how-it-works#for-*` and
 * "Resources" links `/how-it-works` itself; a naive prefix match lit BOTH when
 * that page was open, and two simultaneous "you are here" underlines tell the
 * reader nothing. A link to a SECTION is not ownership of the page — so only
 * fragment-free hrefs count.
 *
 * That also disposes of the home page for free: every "/#..." anchor is
 * excluded, so "/" matches nothing rather than lighting every menu at once.
 */
export function isEntryActive(entry: NavEntry, pathname: string): boolean {
  const paths =
    entry.kind === "link"
      ? [entry.href]
      : entry.groups.flatMap((group) => group.items.map((item) => item.href));

  return paths.some((href) => {
    if (href.includes("#")) return false;
    return pathname === href || pathname.startsWith(`${href}/`);
  });
}
