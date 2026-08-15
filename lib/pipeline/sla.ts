// =============================================================================
// Pipeline SLA / aging.
//
// The spec's test is "SLA aging matches the configured target_days per stage",
// so this is a pure function of (days in stage, configured target) with no
// database or clock dependency of its own.
//
// Defaults exist per stage because an unconfigured organization should still see
// meaningful aging. An absent config row means "use the default", never "no SLA"
// — a board with no aging at all would defeat the point of the module.
// =============================================================================
import {
  isTerminalStage,
  PIPELINE_STAGES,
  STAGE_LABELS,
  type ApplicationStage,
} from "@/lib/applications/stages";

/**
 * Default days per stage, chosen from how long each step realistically takes:
 * screening and review are quick internal actions; client review and interview
 * involve someone else's calendar; offer involves a decision.
 */
export const DEFAULT_SLA_DAYS: Record<ApplicationStage, number> = {
  applied: 2,
  shortlisted: 3,
  // The automated call should happen quickly; the human rounds need diary time,
  // and a director's diary needs the most.
  ai_screening_call: 3,
  phone_interview: 5,
  video_interview: 7,
  written_assessment: 7,
  director_round: 7,
  // Terminal stages are not aged; these values are never consulted.
  hired: 0,
  rejected: 0,
  withdrawn: 0,
};

export type SlaConfig = Partial<Record<ApplicationStage, number>>;

export type SlaStatus = "ok" | "at_risk" | "breached" | "not_tracked";

export type SlaAssessment = {
  status: SlaStatus;
  targetDays: number | null;
  daysInStage: number;
  /** Days past target; 0 when within it. */
  overdueDays: number;
  label: string;
};

/** "At risk" once this fraction of the target has elapsed. */
export const AT_RISK_THRESHOLD = 0.75;

/** The configured target for a stage, falling back to the default. */
export function targetDaysFor(stage: ApplicationStage, config: SlaConfig): number | null {
  if (isTerminalStage(stage)) return null;
  const configured = config[stage];
  if (typeof configured === "number" && configured >= 0) return configured;
  return DEFAULT_SLA_DAYS[stage];
}

/**
 * Assesses one application's aging.
 *
 * Terminal stages return `not_tracked`: a hired or rejected application is
 * finished, and showing it as "12 days overdue" would be noise that trains
 * people to ignore the indicator.
 */
export function assessSla({
  stage,
  daysInStage,
  config,
}: {
  stage: ApplicationStage;
  daysInStage: number;
  config: SlaConfig;
}): SlaAssessment {
  const targetDays = targetDaysFor(stage, config);

  if (targetDays === null) {
    return {
      status: "not_tracked",
      targetDays: null,
      daysInStage,
      overdueDays: 0,
      label: "Not tracked",
    };
  }

  // A target of 0 means "same day". Anything past day 0 is then breached.
  if (daysInStage > targetDays) {
    const overdueDays = daysInStage - targetDays;
    return {
      status: "breached",
      targetDays,
      daysInStage,
      overdueDays,
      label: `${overdueDays} day${overdueDays === 1 ? "" : "s"} over`,
    };
  }

  if (targetDays > 0 && daysInStage >= targetDays * AT_RISK_THRESHOLD) {
    return {
      status: "at_risk",
      targetDays,
      daysInStage,
      overdueDays: 0,
      label: `Due in ${targetDays - daysInStage} day${targetDays - daysInStage === 1 ? "" : "s"}`,
    };
  }

  return {
    status: "ok",
    targetDays,
    daysInStage,
    overdueDays: 0,
    label: `${daysInStage} day${daysInStage === 1 ? "" : "s"} in stage`,
  };
}

/** Design-token colour for an SLA status. Warning/Error only — never decorative. */
export function slaColor(status: SlaStatus): string | undefined {
  switch (status) {
    case "breached":
      return "var(--color-error)";
    case "at_risk":
      return "var(--color-warning)";
    default:
      return undefined;
  }
}

/** Parses stored config rows into the lookup the assessor wants. */
export function toSlaConfig(rows: { stage: string; target_days: number }[]): SlaConfig {
  const config: SlaConfig = {};
  for (const row of rows) {
    if ((PIPELINE_STAGES as readonly string[]).includes(row.stage)) {
      config[row.stage as ApplicationStage] = row.target_days;
    }
  }
  return config;
}

/** Every editable stage with its current or default target, for the settings UI. */
export function editableSlaRows(config: SlaConfig) {
  return PIPELINE_STAGES.map((stage) => ({
    stage,
    label: STAGE_LABELS[stage],
    targetDays: targetDaysFor(stage, config) ?? DEFAULT_SLA_DAYS[stage],
    isDefault: config[stage] === undefined,
  }));
}

/** Validates a submitted SLA payload. */
export function parseSlaPayload(
  value: unknown
): { ok: true; config: Record<string, number> } | { ok: false; error: string } {
  if (typeof value !== "object" || value === null) {
    return { ok: false, error: "Invalid request body." };
  }

  const raw = value as Record<string, unknown>;
  const config: Record<string, number> = {};

  for (const stage of PIPELINE_STAGES) {
    if (!(stage in raw)) continue;
    const days = Number(raw[stage]);
    if (!Number.isFinite(days) || days < 0 || days > 365) {
      return {
        ok: false,
        error: `${STAGE_LABELS[stage]} must be between 0 and 365 days.`,
      };
    }
    config[stage] = Math.floor(days);
  }

  if (Object.keys(config).length === 0) {
    return { ok: false, error: "No valid stage targets provided." };
  }

  return { ok: true, config };
}
