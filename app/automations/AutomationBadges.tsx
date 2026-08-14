"use client";

import { TRIGGER_LABELS, type TriggerType } from "@/lib/automations/catalog";

/**
 * Status badges.
 *
 * `active` is the only one in Success green, and the wording is deliberately
 * blunt — an admin scanning this list needs to know at a glance which rules can
 * act on candidates right now.
 */
export function StatusBadge({ status }: { status: "draft" | "active" | "paused" }) {
  const styles: Record<string, { bg: string; color: string; label: string }> = {
    active: {
      bg: "var(--status-live-bg, #DCFCE7)",
      color: "var(--color-success)",
      label: "Active",
    },
    draft: { bg: "#F1F5F9", color: "var(--color-secondary-text)", label: "Draft" },
    paused: {
      bg: "var(--status-attention-bg, #FEF3C7)",
      color: "var(--status-attention-text, #B45309)",
      label: "Paused",
    },
  };

  const style = styles[status] ?? styles.draft;

  return (
    <span
      style={{
        background: style.bg,
        color: style.color,
        borderRadius: 999,
        padding: "2px 10px",
        fontSize: 12,
        fontWeight: 600,
        whiteSpace: "nowrap",
      }}
    >
      {style.label}
    </span>
  );
}

/**
 * Run-outcome badge.
 *
 * Skipped is grey, not red. A rule whose conditions did not match did its job;
 * colouring it as a failure would train people to ignore the real failures.
 */
export function RunStatusBadge({ status }: { status: string }) {
  const styles: Record<string, { bg: string; color: string; label: string }> = {
    success: { bg: "#DCFCE7", color: "var(--color-success)", label: "Success" },
    failed: { bg: "#FEE2E2", color: "var(--color-error)", label: "Failed" },
    skipped: { bg: "#F1F5F9", color: "var(--color-secondary-text)", label: "Skipped" },
    blocked: { bg: "#FEF3C7", color: "var(--status-attention-text, #B45309)", label: "Blocked" },
  };

  const style = styles[status] ?? styles.skipped;

  return (
    <span
      style={{
        background: style.bg,
        color: style.color,
        borderRadius: 999,
        padding: "2px 10px",
        fontSize: 12,
        fontWeight: 600,
        whiteSpace: "nowrap",
      }}
    >
      {style.label}
    </span>
  );
}

export function TriggerBadge({ trigger }: { trigger: TriggerType }) {
  return (
    <span className="has-text-secondary" style={{ fontSize: 13 }}>
      {TRIGGER_LABELS[trigger] ?? trigger}
    </span>
  );
}
