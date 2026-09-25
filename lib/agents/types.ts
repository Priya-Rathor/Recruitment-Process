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
  Mail,
  MessageCircle,
  Mic,
  Orbit,
  PhoneCall,
  Video,
  type LucideIcon,
} from "lucide-react";

export const AGENT_TYPES = [
  "voice_screening",
  "voice_interview",
  "video_interview",
  "whatsapp_reply",
  "email_reply",
  "assessment",
  "universal",
  "custom_llm",
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
export type AgentDependency =
  | { kind: "provider" }
  | { kind: "channel"; integration: "whatsapp" | "email" }
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
    purpose: "Calls candidates and runs a first-round screen from the job's own questions.",
    icon: PhoneCall,
    dependency: { kind: "provider" },
    runnable: true,
  },
  voice_interview: {
    label: "Voice Interview Agent",
    purpose: "Holds a structured interview over the phone.",
    icon: Mic,
    dependency: { kind: "provider" },
    runnable: false,
    blockedReason:
      "Voice interviews aren't built yet. You can set this agent up now; it can't be activated until they are.",
  },
  video_interview: {
    label: "Video Interview Agent",
    purpose: "Runs a structured interview on video.",
    icon: Video,
    // A provider in principle — but none exists. Google Meet schedules a call;
    // it cannot conduct one, so it is not offered as an executor.
    dependency: { kind: "provider" },
    runnable: false,
    blockedReason:
      "No video interview provider is available yet. Scheduled video interviews use Google Meet links, which can't run an agent.",
  },
  whatsapp_reply: {
    label: "WhatsApp Auto Reply Agent",
    purpose: "Answers candidate WhatsApp messages from their real application data.",
    icon: MessageCircle,
    dependency: { kind: "channel", integration: "whatsapp" },
    runnable: true,
  },
  email_reply: {
    label: "Email Auto Reply Agent",
    purpose: "Answers candidate emails from their real application data.",
    icon: Mail,
    dependency: { kind: "channel", integration: "email" },
    runnable: false,
    blockedReason:
      "Scoreboad sends email but doesn't receive it yet, so there is nothing for this agent to reply to.",
  },
  assessment: {
    label: "Assessment Agent",
    purpose: "Evaluates a candidate's written or coding assessment against your criteria.",
    icon: ClipboardCheck,
    dependency: { kind: "none" },
    runnable: false,
    blockedReason: "The assessment engine isn't built yet. Submissions are still reviewed by a person.",
  },
  universal: {
    label: "Universal Agent",
    purpose: "A general-purpose agent you attach to a hiring step.",
    icon: Orbit,
    dependency: { kind: "none" },
    runnable: false,
    blockedReason: "Attaching agents to hiring steps isn't built yet.",
  },
  custom_llm: {
    label: "Custom LLM Agent",
    purpose: "Your own instructions, run on the platform's AI provider.",
    icon: Braces,
    dependency: { kind: "none" },
    runnable: false,
    blockedReason: "Running custom agents isn't built yet.",
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
  whatsapp_reply: { href: "/settings/auto-reply" },
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
