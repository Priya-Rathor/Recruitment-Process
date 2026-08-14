// Shared badges for interviews. Design tokens only.
import {
  MODE_LABELS,
  STATUS_LABELS,
  type InterviewMode,
  type InterviewStatus,
} from "@/lib/interviews/feedback";

const STATUS_STYLE: Record<InterviewStatus, { background: string; color: string }> = {
  scheduled: { background: "#eff6ff", color: "var(--color-info)" },
  completed: {
    background: "var(--status-connected-bg)",
    color: "var(--status-connected-text)",
  },
  cancelled: {
    background: "var(--status-disconnected-bg)",
    color: "var(--status-disconnected-text)",
  },
  no_show: { background: "var(--status-error-bg)", color: "var(--status-error-text)" },
};

export function InterviewStatusBadge({ status }: { status: InterviewStatus }) {
  return (
    <span className="tag" style={{ ...STATUS_STYLE[status], fontSize: 12, fontWeight: 600 }}>
      {STATUS_LABELS[status]}
    </span>
  );
}

export function ModeBadge({ mode }: { mode: InterviewMode }) {
  return (
    <span className="tag is-light" style={{ fontSize: 11 }}>
      {MODE_LABELS[mode]}
    </span>
  );
}

/**
 * Calendar sync state. `not_attempted` is deliberately neutral, not a warning —
 * until Module 17 ships OAuth it is the normal, expected state and should not
 * look like something is broken.
 */
export function CalendarBadge({
  status,
  error,
}: {
  status: "not_attempted" | "synced" | "failed";
  error: string | null;
}) {
  if (status === "synced") {
    return (
      <span
        className="tag"
        style={{
          background: "var(--status-connected-bg)",
          color: "var(--status-connected-text)",
          fontSize: 11,
        }}
      >
        in calendar
      </span>
    );
  }

  if (status === "failed") {
    return (
      <span
        className="tag"
        style={{ background: "var(--status-error-bg)", color: "var(--status-error-text)", fontSize: 11 }}
        title={error ?? undefined}
      >
        calendar failed
      </span>
    );
  }

  return (
    <span className="tag is-light" style={{ fontSize: 11 }} title={error ?? undefined}>
      no calendar invite
    </span>
  );
}

/** Feedback presence, the signal the missing-feedback queue is built on. */
export function FeedbackBadge({ hasFeedback }: { hasFeedback: boolean }) {
  return (
    <span
      className="tag"
      style={{
        background: hasFeedback ? "var(--status-connected-bg)" : "var(--status-attention-bg)",
        color: hasFeedback ? "var(--status-connected-text)" : "var(--status-attention-text)",
        fontSize: 11,
        fontWeight: 600,
      }}
    >
      {hasFeedback ? "feedback in" : "feedback pending"}
    </span>
  );
}
