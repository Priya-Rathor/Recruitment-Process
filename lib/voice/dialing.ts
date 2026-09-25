// =============================================================================
// Which provider agent places a screening call — or whether one may at all.
//
// PURE, and deliberately so: this is the decision that telephones a person, so
// it is a function the tests can exercise exhaustively, and the adapter only
// reads the rows and does what it is told (AGENTS.md: keep the irreversible
// decision pure and let the executor do only what it is told).
//
// THE AGENT CENTER'S STATUS IS WHAT MAKES THIS FAIL CLOSED. Before migration
// 0043 every lookup that didn't resolve quietly fell back to something that
// dialled. That stays true for a deleted or unsynced agent — a pipeline must
// not stop because an agent row went away — but a PAUSED or ARCHIVED agent is
// a person saying "stop", and falling back past it would make the Pause button
// a label.
// =============================================================================
import type { AgentStatus } from "@/lib/agents/types";

export type DialingCandidate = {
  providerAgentId: string | null;
  /** Null when the agents table isn't there yet (0043 unapplied): behave as before. */
  status: AgentStatus | null;
};

export type DialingDecision = { ok: true; providerAgentId: string } | { ok: false; reason: string };

const STOPPED: AgentStatus[] = ["paused", "archived"];

export function decideDialingAgent({
  requested,
  fallbackDefault,
  credentialAgentId,
}: {
  /** The agent a workflow named, if it resolved in this organization. */
  requested: DialingCandidate | null;
  /** The organization's default voice agent, if it has one. */
  fallbackDefault: DialingCandidate | null;
  /** The agent id saved with the Bolna credentials — the pre-console behaviour. */
  credentialAgentId: string;
}): DialingDecision {
  const synced = (candidate: DialingCandidate | null) => candidate?.providerAgentId?.trim() || null;

  if (requested) {
    // An explicit choice of an agent that isn't live is refused, not
    // substituted: the rule said "use this one", and a different voice with a
    // different script is not what anybody approved.
    if (requested.status !== null && requested.status !== "active") {
      return {
        ok: false,
        reason: `The voice agent this workflow uses is ${requested.status}. Activate it in Settings → Agents, or choose another.`,
      };
    }
    const id = synced(requested);
    if (id) return { ok: true, providerAgentId: id };
  }

  if (fallbackDefault) {
    if (fallbackDefault.status !== null && STOPPED.includes(fallbackDefault.status)) {
      return {
        ok: false,
        reason: `The default voice agent is ${fallbackDefault.status}. Activate it in Settings → Agents to resume screening calls.`,
      };
    }
    // A DRAFT default is skipped, not obeyed and not refused: migration 0034
    // makes an organization's first agent the default automatically, so a
    // draft someone is still writing must not take over — or stop — the
    // calls the organization already places.
    const id = fallbackDefault.status === "draft" ? null : synced(fallbackDefault);
    if (id) return { ok: true, providerAgentId: id };
  }

  return { ok: true, providerAgentId: credentialAgentId };
}
