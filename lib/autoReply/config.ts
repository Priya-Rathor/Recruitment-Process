// =============================================================================
// The auto-reply agent's configuration, its precedence rule, and its refusal
// rule. PURE — no database, no provider, no AI, no `next/headers`.
//
// Client-safe on purpose: the Settings page renders the precedence table and the
// inbox renders the master switch, and both need these types and this rule
// without dragging lib/supabase/admin.ts into the browser bundle
// (app/settings/clientBoundary.test.ts enforces that).
//
// ONE PRECEDENCE FUNCTION, TWO CALLERS — the Settings page's read-only preview
// and the webhook that actually sends. lib/voice/callData.ts says why in words
// worth repeating: "a preview that computes precedence differently from the code
// that dials is worse than no preview, because it is believed."
// =============================================================================

export const AUTO_REPLY_TIMINGS = ["immediate", "delayed"] as const;
export type AutoReplyTiming = (typeof AUTO_REPLY_TIMINGS)[number];

export function isAutoReplyTiming(value: unknown): value is AutoReplyTiming {
  return typeof value === "string" && (AUTO_REPLY_TIMINGS as readonly string[]).includes(value);
}

/** One row of auto_reply_config — the org-wide default or one job's override. */
export type AutoReplyConfig = {
  id: string;
  organization_id: string;
  /** Null for the organization-wide default. */
  job_id: string | null;
  enabled: boolean;
  response_timing: AutoReplyTiming;
  delay_minutes: number | null;
  tone_instructions: string | null;
  context_instructions: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
};

export const AUTO_REPLY_LIMITS = {
  /** Meta only accepts free-form text within 24h of the candidate's message, so
   *  a longer delay guarantees the reply is refused when it finally fires. */
  maxDelayMinutes: 1440,
  minDelayMinutes: 1,
  toneMax: 2000,
  contextMax: 4000,
  /** A reply is read on a phone. Same cap the WhatsApp templates use. */
  replyMax: 1024,
} as const;

// -----------------------------------------------------------------------------
// Precedence
// -----------------------------------------------------------------------------

export type AutoReplyDecision =
  | {
      active: true;
      /** Which scope won. Shown in the UI and logged with the reply. */
      source: "job" | "organization";
      timing: AutoReplyTiming;
      delayMinutes: number;
      toneInstructions: string | null;
      contextInstructions: string | null;
      /** The row that decided it, for the audit trail. */
      configId: string;
    }
  | {
      active: false;
      /** Plain language, safe to show an admin. Never sent to a candidate. */
      reason: string;
    };

/**
 * Whether the agent should answer, and with what settings.
 *
 * THE ORDER IS THE SAFETY PROPERTY, not a stylistic choice:
 *
 *   1. The MASTER switch. Checked before any config is read, because it is the
 *      thing a recruiter reaches for when the agent has just said something
 *      wrong, and it has to mean "stop" without qualification.
 *   2. The JOB's override, if it exists — whether it is enabled OR disabled.
 *   3. Otherwise the organization-wide default.
 *
 * STEP 2 IS THE ONE THAT IS EASY TO GET WRONG. A job override that is
 * DISABLED must stop the agent, not fall through to an enabled org default. The
 * spec's wording ("use that job's config if one exists and is enabled;
 * otherwise fall back") reads as a fall-through, but an admin who switched the
 * agent off for one sensitive role and then found it answering anyway from the
 * org default would rightly call that a bug. An override overrides in both
 * directions; to get the org default back, delete the override — which is what
 * the Settings page's remove action does.
 */
export function resolveAutoReply({
  masterEnabled,
  orgConfig,
  jobConfig,
}: {
  masterEnabled: boolean;
  orgConfig: AutoReplyConfig | null;
  /** Null when this job has no override, or when there is no job in scope. */
  jobConfig: AutoReplyConfig | null;
}): AutoReplyDecision {
  if (!masterEnabled) {
    return {
      active: false,
      reason: "Auto-reply is switched off for the whole organization.",
    };
  }

  const winner = jobConfig ?? orgConfig;

  if (!winner) {
    return {
      active: false,
      reason: "No auto-reply is configured, so this message is waiting for a person.",
    };
  }

  if (!winner.enabled) {
    return {
      active: false,
      reason:
        winner.job_id === null
          ? "Auto-reply is switched off in the organization's default settings."
          : "Auto-reply is switched off for this job.",
    };
  }

  return {
    active: true,
    source: winner.job_id === null ? "organization" : "job",
    timing: winner.response_timing,
    // Normalised here so no caller has to remember that 'immediate' means zero.
    delayMinutes: winner.response_timing === "delayed" ? (winner.delay_minutes ?? 0) : 0,
    toneInstructions: winner.tone_instructions,
    contextInstructions: winner.context_instructions,
    configId: winner.id,
  };
}

/** Where an effective value came from. Same vocabulary as lib/voice/callData.ts. */
export type PrecedenceSource = "job" | "organization" | "unset";

export type AutoReplyPrecedenceRow = {
  key: string;
  label: string;
  /** Display strings, already summarised. Null means "not set". */
  orgDefault: string | null;
  jobOverride: string | null;
  effective: string | null;
  source: PrecedenceSource;
};

function timingLabel(config: AutoReplyConfig | null): string | null {
  if (!config) return null;
  if (config.response_timing === "immediate") return "Immediate";
  return `After ${config.delay_minutes ?? 0} min`;
}

function enabledLabel(config: AutoReplyConfig | null): string | null {
  if (!config) return null;
  return config.enabled ? "On" : "Off";
}

function summarise(text: string | null | undefined): string | null {
  const trimmed = text?.trim();
  if (!trimmed) return null;
  return trimmed.length > 80 ? `${trimmed.slice(0, 80)}…` : trimmed;
}

/**
 * The Field | Org default | This job | Effective table.
 *
 * Built from the SAME rule resolveAutoReply() applies, so the preview cannot
 * drift from what the agent does. Note that every row's source is the row that
 * WON as a whole, not a per-field merge: an override replaces the org default
 * entirely rather than being merged into it, because a half-inherited
 * personality ("the job's tone, the org's restrictions") is not something an
 * admin can reason about.
 */
export function autoReplyPrecedenceRows({
  masterEnabled,
  orgConfig,
  jobConfig,
}: {
  masterEnabled: boolean;
  orgConfig: AutoReplyConfig | null;
  jobConfig: AutoReplyConfig | null;
}): AutoReplyPrecedenceRow[] {
  const decision = resolveAutoReply({ masterEnabled, orgConfig, jobConfig });
  const winner = jobConfig ?? orgConfig;
  const source: PrecedenceSource = winner
    ? winner.job_id === null
      ? "organization"
      : "job"
    : "unset";

  const row = (
    key: string,
    label: string,
    orgValue: string | null,
    jobValue: string | null,
    effective: string | null
  ): AutoReplyPrecedenceRow => ({
    key,
    label,
    orgDefault: orgValue,
    jobOverride: jobValue,
    effective,
    source: effective === null ? "unset" : source,
  });

  return [
    row(
      "enabled",
      "Auto-reply",
      enabledLabel(orgConfig),
      enabledLabel(jobConfig),
      // The master switch is shown as the effective answer, because it IS the
      // effective answer — a table that said "On" while the agent was globally
      // off would be the most misleading row on the page.
      masterEnabled ? (decision.active ? "On" : "Off") : "Off — master switch"
    ),
    row(
      "response_timing",
      "Timing",
      timingLabel(orgConfig),
      timingLabel(jobConfig),
      decision.active ? timingLabel(winner) : null
    ),
    row(
      "tone_instructions",
      "Tone",
      summarise(orgConfig?.tone_instructions),
      summarise(jobConfig?.tone_instructions),
      decision.active ? summarise(winner?.tone_instructions) : null
    ),
    row(
      "context_instructions",
      "Context rules",
      summarise(orgConfig?.context_instructions),
      summarise(jobConfig?.context_instructions),
      decision.active ? summarise(winner?.context_instructions) : null
    ),
  ];
}

// -----------------------------------------------------------------------------
// Validation
// -----------------------------------------------------------------------------

export type AutoReplyInput = {
  job_id: string | null;
  enabled: boolean;
  response_timing: AutoReplyTiming;
  delay_minutes: number | null;
  tone_instructions: string | null;
  context_instructions: string | null;
};

export type AutoReplyValidation =
  | { ok: true; data: AutoReplyInput }
  | { ok: false; error: string };

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Validates a config payload.
 *
 * Says the same things the database's CHECK constraints say, in English, so the
 * form can show a reason instead of a Postgres error code — the same split
 * lib/communications/templates.ts uses.
 */
export function validateAutoReplyConfig(value: unknown): AutoReplyValidation {
  if (typeof value !== "object" || value === null) {
    return { ok: false, error: "Invalid configuration." };
  }
  const raw = value as Record<string, unknown>;

  let jobId: string | null = null;
  if (raw.job_id !== null && raw.job_id !== undefined && raw.job_id !== "") {
    if (typeof raw.job_id !== "string" || !UUID_PATTERN.test(raw.job_id)) {
      return { ok: false, error: "Choose a job for this override." };
    }
    jobId = raw.job_id;
  }

  if (!isAutoReplyTiming(raw.response_timing)) {
    return { ok: false, error: "Choose immediate or delayed." };
  }

  let delayMinutes: number | null = null;
  if (raw.response_timing === "delayed") {
    const parsed = Number(raw.delay_minutes);
    if (!Number.isFinite(parsed) || !Number.isInteger(parsed)) {
      return { ok: false, error: "Enter the delay in whole minutes." };
    }
    if (parsed < AUTO_REPLY_LIMITS.minDelayMinutes) {
      return { ok: false, error: "A delay has to be at least 1 minute." };
    }
    if (parsed > AUTO_REPLY_LIMITS.maxDelayMinutes) {
      return {
        ok: false,
        // The reason, not just the limit: WhatsApp refuses free-form text more
        // than 24 hours after the candidate's message, so a longer delay
        // produces a reply that cannot be delivered.
        error:
          "A delay longer than 24 hours (1440 minutes) would fall outside WhatsApp's reply " +
          "window, so the message would be refused when it fired.",
      };
    }
    delayMinutes = parsed;
  }

  const tone = typeof raw.tone_instructions === "string" ? raw.tone_instructions.trim() : "";
  if (tone.length > AUTO_REPLY_LIMITS.toneMax) {
    return { ok: false, error: `Keep the tone guidance under ${AUTO_REPLY_LIMITS.toneMax} characters.` };
  }

  const context =
    typeof raw.context_instructions === "string" ? raw.context_instructions.trim() : "";
  if (context.length > AUTO_REPLY_LIMITS.contextMax) {
    return {
      ok: false,
      error: `Keep the context guidance under ${AUTO_REPLY_LIMITS.contextMax} characters.`,
    };
  }

  return {
    ok: true,
    data: {
      job_id: jobId,
      enabled: raw.enabled === true,
      response_timing: raw.response_timing,
      delay_minutes: delayMinutes,
      tone_instructions: tone.length > 0 ? tone : null,
      context_instructions: context.length > 0 ? context : null,
    },
  };
}
