"use client";

// =============================================================================
// Automation badges.
//
// These were three hand-rolled chips with their own padding, radius and font
// size. They now delegate to the single StatusChip, so an automation's status
// is the same shape and size as an integration's, an interview's, and every
// other status in the product — which was the point of the UI pass.
//
// The MAPPING stays here, because which tone a status deserves is a decision
// about automations, not about chips. "Skipped" being neutral rather than red
// is a deliberate call: a rule whose conditions did not match has not failed,
// and colouring it as an error would train people to ignore the real failures.
// =============================================================================
import { StatusChip, type ChipTone } from "@/components/ui/StatusChip";
import { TRIGGER_LABELS, type TriggerType } from "@/lib/automations/catalog";

const AUTOMATION_TONES: Record<string, { tone: ChipTone; label: string }> = {
  active: { tone: "success", label: "Active" },
  draft: { tone: "neutral", label: "Draft" },
  paused: { tone: "warning", label: "Paused" },
};

export function StatusBadge({ status }: { status: "draft" | "active" | "paused" }) {
  const entry = AUTOMATION_TONES[status] ?? AUTOMATION_TONES.draft;
  return <StatusChip tone={entry.tone} label={entry.label} />;
}

const RUN_TONES: Record<string, { tone: ChipTone; label: string }> = {
  success: { tone: "success", label: "Success" },
  failed: { tone: "error", label: "Failed" },
  // Neutral, not red: conditions not matching is normal operation.
  skipped: { tone: "neutral", label: "Skipped" },
  blocked: { tone: "warning", label: "Blocked" },
};

export function RunStatusBadge({ status }: { status: string }) {
  const entry = RUN_TONES[status] ?? RUN_TONES.skipped;
  return <StatusChip tone={entry.tone} label={entry.label} />;
}

export function TriggerBadge({ trigger }: { trigger: TriggerType }) {
  return (
    <span style={{ fontSize: "var(--text-label)", color: "var(--color-text-secondary)" }}>
      {TRIGGER_LABELS[trigger] ?? trigger}
    </span>
  );
}
