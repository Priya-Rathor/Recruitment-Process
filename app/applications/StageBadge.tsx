// Stage badge. Design tokens only — the board's live stages are neutral/info,
// a hire is Success, and the negative exits are Error/Disconnected.
import { STAGE_LABELS, type ApplicationStage } from "@/lib/applications/stages";

// Neutral at intake, info while the pipeline is doing its work, amber for the
// two rounds that need a human's diary, then the terminal colours. The gradient
// carries the same information as the stepper does, at badge size.
const STAGE_STYLE: Record<ApplicationStage, { background: string; color: string }> = {
  applied: { background: "var(--status-disconnected-bg)", color: "var(--status-disconnected-text)" },
  shortlisted: { background: "var(--color-primary-tint)", color: "var(--color-info)" },
  ai_screening_call: { background: "var(--color-primary-tint)", color: "var(--color-info)" },
  phone_interview: { background: "var(--color-primary-tint)", color: "var(--color-info)" },
  video_interview: {
    background: "var(--status-attention-bg)",
    color: "var(--status-attention-text)",
  },
  written_assessment: {
    background: "var(--status-attention-bg)",
    color: "var(--status-attention-text)",
  },
  director_round: {
    background: "var(--status-attention-bg)",
    color: "var(--status-attention-text)",
  },
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
