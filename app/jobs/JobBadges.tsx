// Shared status + health badges. Design tokens only — Success/Warning/Info per
// spec section 4; no invented colours.
import { JOB_STATUS_LABELS, type JobStatus } from "@/lib/types";
import type { JobHealth } from "@/lib/jobs/health";

const STATUS_STYLE: Record<JobStatus, { background: string; color: string }> = {
  draft: { background: "var(--status-disconnected-bg)", color: "var(--status-disconnected-text)" },
  open: { background: "var(--status-connected-bg)", color: "var(--status-connected-text)" },
  on_hold: { background: "var(--status-attention-bg)", color: "var(--status-attention-text)" },
  closed: { background: "var(--status-disconnected-bg)", color: "var(--status-disconnected-text)" },
};

export function StatusBadge({ status }: { status: JobStatus }) {
  const style = STATUS_STYLE[status];
  return (
    <span className="tag" style={{ ...style, fontSize: 12, fontWeight: 600 }}>
      {JOB_STATUS_LABELS[status]}
    </span>
  );
}

/**
 * Health badge. Never a bare amber dot: the reasons are always available, since
 * "Needs Attention" is only actionable if the recruiter knows why.
 */
export function HealthBadge({ health }: { health: JobHealth }) {
  if (health.status === "healthy") {
    return (
      <span
        className="tag"
        style={{
          background: "var(--status-connected-bg)",
          color: "var(--status-connected-text)",
          fontSize: 12,
          fontWeight: 600,
        }}
      >
        Healthy
      </span>
    );
  }

  return (
    <span
      className="tag"
      style={{
        background: "var(--status-attention-bg)",
        color: "var(--status-attention-text)",
        fontSize: 12,
        fontWeight: 600,
      }}
      title={health.reasons.join(" · ")}
    >
      Needs attention
    </span>
  );
}

/** Full reason list, for the detail page where there's room to explain. */
export function HealthReasons({ health }: { health: JobHealth }) {
  if (health.status === "healthy") {
    return (
      <p className="has-text-secondary" style={{ fontSize: 13 }}>
        Nothing needs attention on this job.
      </p>
    );
  }

  return (
    <ul style={{ fontSize: 13, listStyle: "disc", paddingLeft: "1.25rem" }}>
      {health.reasons.map((reason) => (
        <li key={reason} style={{ color: "var(--status-attention-text)" }}>
          {reason}
        </li>
      ))}
    </ul>
  );
}
