// Shared status badge for screening calls. Design tokens only.
import type { CallStatus } from "@/lib/screening/retry";

const STYLES: Record<string, { background: string; color: string; label: string }> = {
  queued: {
    background: "var(--status-disconnected-bg)",
    color: "var(--status-disconnected-text)",
    label: "Queued",
  },
  dialing: {
    background: "var(--status-attention-bg)",
    color: "var(--status-attention-text)",
    label: "Dialling",
  },
  answered: { background: "var(--color-primary-tint)", color: "var(--color-info)", label: "In progress" },
  completed: {
    background: "var(--status-connected-bg)",
    color: "var(--status-connected-text)",
    label: "Completed",
  },
  no_answer: {
    background: "var(--status-attention-bg)",
    color: "var(--status-attention-text)",
    label: "No answer",
  },
  busy: {
    background: "var(--status-attention-bg)",
    color: "var(--status-attention-text)",
    label: "Busy",
  },
  callback_requested: {
    background: "var(--color-primary-tint)",
    color: "var(--color-info)",
    label: "Callback requested",
  },
  failed: {
    background: "var(--status-error-bg)",
    color: "var(--status-error-text)",
    label: "Failed",
  },
  cancelled: {
    background: "var(--status-disconnected-bg)",
    color: "var(--status-disconnected-text)",
    label: "Declined",
  },
};

export function CallStatusBadge({ status }: { status: CallStatus | string }) {
  const style = STYLES[status] ?? {
    background: "var(--status-disconnected-bg)",
    color: "var(--status-disconnected-text)",
    label: status,
  };

  return (
    <span className="tag" style={{ ...style, fontSize: 12, fontWeight: 600 }}>
      {style.label}
    </span>
  );
}

/**
 * Consent indicator. Shown prominently because a transcript without recorded
 * consent must not be used downstream — Module 9 refuses it, and a recruiter
 * should be able to see why at a glance.
 */
export function ConsentBadge({ confirmed }: { confirmed: boolean }) {
  return (
    <span
      className="tag"
      style={{
        background: confirmed ? "var(--status-connected-bg)" : "var(--status-attention-bg)",
        color: confirmed ? "var(--status-connected-text)" : "var(--status-attention-text)",
        fontSize: 11,
        fontWeight: 600,
      }}
      title={
        confirmed
          ? "The candidate was told the call was automated and recorded, and agreed to continue"
          : "No consent recorded — this transcript can't be used downstream"
      }
    >
      {confirmed ? "consent recorded" : "no consent"}
    </span>
  );
}
