// Stage badge. Design tokens only — the board's live stages are neutral/info,
// a hire is Success, and the negative exits are Error/Disconnected.
import { STAGE_LABELS, type ApplicationStage } from "@/lib/applications/stages";

const STAGE_STYLE: Record<ApplicationStage, { background: string; color: string }> = {
  new: { background: "var(--status-disconnected-bg)", color: "var(--status-disconnected-text)" },
  screening: { background: "#eff6ff", color: "var(--color-info)" },
  recruiter_review: { background: "#eff6ff", color: "var(--color-info)" },
  shortlisted: { background: "#eff6ff", color: "var(--color-info)" },
  client_review: { background: "var(--status-attention-bg)", color: "var(--status-attention-text)" },
  interview: { background: "var(--status-attention-bg)", color: "var(--status-attention-text)" },
  offer: { background: "var(--status-attention-bg)", color: "var(--status-attention-text)" },
  hired: { background: "var(--status-connected-bg)", color: "var(--status-connected-text)" },
  rejected: { background: "var(--status-error-bg)", color: "var(--status-error-text)" },
  withdrawn: {
    background: "var(--status-disconnected-bg)",
    color: "var(--status-disconnected-text)",
  },
};

export function StageBadge({ stage }: { stage: ApplicationStage }) {
  const style = STAGE_STYLE[stage];
  return (
    <span className="tag" style={{ ...style, fontSize: 12, fontWeight: 600 }}>
      {STAGE_LABELS[stage]}
    </span>
  );
}

/**
 * Match score. Shown as "Not scored yet" rather than 0 when Module 7 hasn't run
 * — a 0% match and an unscored application mean very different things.
 */
export function MatchScore({ score }: { score: number | null }) {
  if (score === null) {
    return (
      <span className="has-text-secondary" style={{ fontSize: 13 }}>
        Not scored yet
      </span>
    );
  }

  const rounded = Math.round(score);
  const color =
    rounded >= 75
      ? "var(--color-success)"
      : rounded >= 50
        ? "var(--color-warning)"
        : "var(--color-error)";

  return (
    <span style={{ fontSize: 14, fontWeight: 600, color }}>{rounded}%</span>
  );
}
