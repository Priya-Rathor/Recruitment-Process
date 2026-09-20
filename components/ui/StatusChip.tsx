// =============================================================================
// The one status chip.
//
// Before this, every module drew its own: Module 13 had three chip components
// (automation status, run status, trigger), Module 17 another for integrations,
// Module 11 more for interviews and calendar sync — each with its own padding,
// radius and font size, all defined inline.
//
// One component, one geometry, used everywhere. The `tone` decides colour and
// icon; callers pass a label they own.
//
// EVERY CHIP CARRIES AN ICON AND A WORD. Status is never colour alone — that
// matters for the ~4% of users with a colour vision deficiency, and it matters
// on a greyscale print-out of a report.
// =============================================================================
import type { ComponentType } from "react";
import { AlertTriangle, CheckCircle2, CircleDashed, Clock, MinusCircle, XCircle } from "lucide-react";

export type ChipTone =
  /** Working, connected, succeeded. */
  | "success"
  /** Needs a human, over SLA, degraded. */
  | "warning"
  /** Failed, rejected, error. */
  | "error"
  /** Off, disconnected, draft — a resting state, not a problem. */
  | "neutral"
  /** In progress, queued, scheduled. */
  | "info";

const TONES: Record<
  ChipTone,
  { bg: string; color: string; icon: ComponentType<{ size?: number; "aria-hidden"?: boolean }> }
> = {
  // The exact tokens from the spec's section 4.
  success: { bg: "var(--status-connected-bg)", color: "var(--status-connected-text)", icon: CheckCircle2 },
  warning: { bg: "var(--status-attention-bg)", color: "var(--status-attention-text)", icon: AlertTriangle },
  error: { bg: "var(--status-error-bg)", color: "var(--status-error-text)", icon: XCircle },
  neutral: { bg: "var(--status-disconnected-bg)", color: "var(--status-disconnected-text)", icon: MinusCircle },
  info: { bg: "var(--status-disconnected-bg)", color: "var(--color-info)", icon: Clock },
};

export function StatusChip({
  tone,
  label,
  icon: IconOverride,
}: {
  tone: ChipTone;
  label: string;
  /** Override only when a specific state has a clearer icon than its tone's. */
  icon?: ComponentType<{ size?: number; "aria-hidden"?: boolean }>;
}) {
  const style = TONES[tone] ?? TONES.neutral;
  const Icon = IconOverride ?? style.icon;

  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 5,
        background: style.bg,
        color: style.color,
        borderRadius: 999,
        // One geometry for every chip in the product.
        padding: "3px 10px",
        fontSize: "var(--text-caption)",
        fontWeight: "var(--weight-semibold)",
        lineHeight: 1.5,
        whiteSpace: "nowrap",
      }}
    >
      <Icon size={13} aria-hidden />
      {label}
    </span>
  );
}

/** A chip for something not yet started — hollow, so it reads as absent. */
export function PendingChip({ label }: { label: string }) {
  return <StatusChip tone="neutral" label={label} icon={CircleDashed} />;
}
