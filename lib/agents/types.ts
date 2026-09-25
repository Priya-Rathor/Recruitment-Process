// =============================================================================
// Agent Center — the AGENT TYPE axis.
//
// CLIENT-SAFE: this file imports nothing but lucide icons, so the create flow,
// the list and the API can all read the same definitions. The PROVIDER axis is
// a separate file (./providers.ts) on purpose — the two must be able to change
// independently, and a type that knew about Bolna would be the start of the
// conflation the Agent Center exists to prevent.
//
// THE DATABASE MIRRORS THIS FILE. `public.agent_type`, `public.agent_status`
// and the constraints in migration 0043 are the enforced version of what is
// written here; lib/agents/agents.test.ts reads the migration and fails if the
// two lists drift, because a type the UI offers and the database refuses is a
// form that errors on submit.
// =============================================================================
import {
  Braces,
  ClipboardCheck,
  FileSearch,
  Mail,
  MessageCircle,
  Mic,
  PhoneCall,
  Video,
  type LucideIcon,
} from "lucide-react";

export const AGENT_TYPES = [
  "voice_screening",
  "voice_interview",
  "video_interview",
  "cv_screening",
  "assessment",
  "whatsapp_reply",
  "email_reply",
  "custom",
] as const;
export type AgentType = (typeof AGENT_TYPES)[number];

export function isAgentType(value: unknown): value is AgentType {
  return typeof value === "string" && (AGENT_TYPES as readonly string[]).includes(value);
}

export const AGENT_STATUSES = ["draft", "active", "paused", "archived"] as const;
export type AgentStatus = (typeof AGENT_STATUSES)[number];

export function isAgentStatus(value: unknown): value is AgentStatus {
  return typeof value === "string" && (AGENT_STATUSES as readonly string[]).includes(value);
}

/**
 * What an agent of this type needs before it can do anything.
 *
 * - `provider`: the user picks WHO executes it (voice today).
 * - `channel`: it runs on an integration the organization connects once, in
 *   Integrations — there is no per-agent provider to choose.
 * - `none`: it runs on the platform's own AI provider.
 */
/** Integrations an agent runs on without a per-agent provider choice. */
export type ChannelIntegration = "whatsapp" | "email" | "calendar";

export const CHANNEL_LABELS: Record<ChannelIntegration, string> = {
  whatsapp: "WhatsApp Business",
  email: "Email",
  // The one video provider in the product: Google Meet links, created through
  // the Google Calendar integration. Named as what the user connects.
  calendar: "Google Meet (Google Calendar)",
};

export type AgentDependency =
  | { kind: "provider" }
  | { kind: "channel"; integration: ChannelIntegration }
  | { kind: "none" };

export type AgentTypeMeta = {
  label: string;
  /** One sentence, shown on the type card. */
  purpose: string;
  icon: LucideIcon;
  dependency: AgentDependency;
  /**
   * Whether an agent of this type can be ACTIVE today.
   *
   * NOT a marketing flag: `active` means "something will run this", and for
   * most types nothing does yet. Migration 0043 refuses `status = 'active'` for
   * every type listed false here, so this cannot be switched on by editing the
   * UI alone. Each `blockedReason` names what is missing, in the words the
   * create flow shows.
   */
  runnable: boolean;
  blockedReason?: string;
};

export const AGENT_TYPE_META: Record<AgentType, AgentTypeMeta> = {
  voice_screening: {
    label: "Voice Screening Agent",
    purpose: "AI-powered candidate screening calls, using each job's own questions.",
    icon: PhoneCall,
    dependency: { kind: "provider" },
    runnable: true,
  },
  voice_interview: {
    label: "Voice Interview Agent",
    purpose: "AI-powered voice interview conversations.",
    icon: Mic,
    dependency: { kind: "provider" },
    runnable: false,
    blockedReason:
      "Voice interviews aren't built yet. You can set this agent up now; it can't be activated until they are.",
  },
  video_interview: {
    label: "Video Interview Agent",
    purpose: "AI-powered or AI-assisted video interview workflows.",
    icon: Video,
    // The video provider that exists is Google Meet, through the Google
    // Calendar integration — checked like WhatsApp is for the WhatsApp agent.
    // No Zoom/Teams/Daily: none is implemented, so none is offered.
    dependency: { kind: "channel", integration: "calendar" },
    runnable: false,
    blockedReason:
      "Video interviews run on Google Meet links today, led by a person. An agent that joins or assists them isn't built yet.",
  },
  cv_screening: {
    label: "CV Screening Agent",
    purpose: "Analyse candidate CVs against the job's requirements.",
    icon: FileSearch,
    dependency: { kind: "none" },
    runnable: false,
    blockedReason:
      "CV screening runs today from each job's requirements and passing score. Using this agent's criteria in that screen is coming next.",
  },
  whatsapp_reply: {
    label: "WhatsApp Auto Reply Agent",
    purpose: "Automatically respond to candidate WhatsApp messages, from their real application data.",
    icon: MessageCircle,
    dependency: { kind: "channel", integration: "whatsapp" },
    runnable: true,
  },
  email_reply: {
    label: "Email Auto Reply Agent",
    purpose: "Automatically respond to candidate emails.",
    icon: Mail,
    dependency: { kind: "channel", integration: "email" },
    runnable: false,
    blockedReason:
      "Scoreboad sends email but doesn't receive it yet, so there is nothing for this agent to reply to.",
  },
  assessment: {
    label: "Assessment Agent",
    purpose: "Create and evaluate candidate assessments against your criteria.",
    icon: ClipboardCheck,
    dependency: { kind: "none" },
    runnable: false,
    blockedReason: "The assessment engine isn't built yet. Submissions are still reviewed by a person.",
  },
  // Was two types (Universal, Custom LLM) until migration 0045 merged them.
  custom: {
    label: "Custom Agent",
    purpose: "Your own AI agent, defined by your instructions, for supported workflows.",
    icon: Braces,
    dependency: { kind: "none" },
    runnable: false,
    blockedReason: "Running custom agents in a workflow isn't built yet.",
  },
};

/**
 * WHATSAPP REPLY IS NOT AN `agents` ROW YET.
 *
 * The existing auto-reply agent (migration 0042) owns its configuration and,
 * separately, its kill switch. Creating a second configuration here would mean
 * two places to switch an unattended sender off, and the one somebody forgot
 * would keep messaging candidates. So the Agent Center lists it from its own
 * table and hands creation off to its own page, until the WhatsApp module
 * merges the two. The database refuses the type for the same reason.
 */
export const EXTERNALLY_MANAGED: Partial<Record<AgentType, { href: string }>> = {
  whatsapp_reply: { href: "/settings/agents/whatsapp" },
};

export const STATUS_META: Record<
  AgentStatus,
  { label: string; tone: "success" | "warning" | "neutral" | "info" }
> = {
  draft: { label: "Draft", tone: "neutral" },
  active: { label: "Active", tone: "success" },
  paused: { label: "Paused", tone: "warning" },
  archived: { label: "Archived", tone: "neutral" },
};

/** The statuses a user may move an agent to, given its type. */
export function allowedStatuses(type: AgentType): AgentStatus[] {
  return AGENT_TYPE_META[type].runnable
    ? ["draft", "active", "paused", "archived"]
    : ["draft", "archived"];
}
