// Organization settings and user preferences.
import { createClient } from "@/lib/supabase/server";
import { isApplicationStage, type ApplicationStage } from "@/lib/applications/stages";
import { MAX_ALLOWED_ATTEMPTS, MIN_ALLOWED_DELAY_MINUTES } from "@/lib/screening/retry";
import { formatDbError } from "@/lib/supabase/errors";

export type ScreeningSettings = {
  maxAttempts: number;
  retryDelayMinutes: number;
  language: string;
  /** Recording is consent-gated regardless; this only controls the default. */
  recordCalls: boolean;
};

export type RetentionSettings = {
  /** Days to keep call transcripts and recordings. 0 = keep indefinitely. */
  transcriptRetentionDays: number;
  archivedCandidateRetentionDays: number;
};

export type OrganizationSettings = {
  organization_id: string;
  currency: string;
  default_recruiter_id: string | null;
  default_application_stage: ApplicationStage;
  default_interview_duration_minutes: number;
  screening_settings: ScreeningSettings;
  retention_settings: RetentionSettings;
  logo_url: string | null;
  brand_color: string | null;
  updated_at: string | null;
};

export const DEFAULT_SCREENING_SETTINGS: ScreeningSettings = {
  maxAttempts: 3,
  retryDelayMinutes: 240,
  language: "en",
  recordCalls: true,
};

/**
 * Retention defaults to 0 — keep indefinitely.
 *
 * Deliberate. A default that silently deleted transcripts after 90 days would
 * destroy evidence an organization may be legally required to hold, and they
 * would find out only when they needed it. The Privacy chapter's position is
 * that retention is a decision a customer makes, so the product asks rather
 * than assumes.
 */
export const DEFAULT_RETENTION_SETTINGS: RetentionSettings = {
  transcriptRetentionDays: 0,
  archivedCandidateRetentionDays: 0,
};

export const DEFAULT_SETTINGS: Omit<OrganizationSettings, "organization_id" | "updated_at"> = {
  currency: "INR",
  default_recruiter_id: null,
  default_application_stage: "applied",
  default_interview_duration_minutes: 60,
  screening_settings: DEFAULT_SCREENING_SETTINGS,
  retention_settings: DEFAULT_RETENTION_SETTINGS,
  logo_url: null,
  brand_color: null,
};

/**
 * Reads settings, falling back to defaults when no row exists.
 *
 * An organization that has never opened Settings has no row, and that must
 * behave identically to one that saved the defaults — otherwise every consumer
 * needs a null check and one of them will forget.
 */
export async function getOrganizationSettings(
  organizationId: string
): Promise<{ settings: OrganizationSettings; failed: boolean; exists: boolean }> {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from("organization_settings")
    .select("*")
    .eq("organization_id", organizationId)
    .maybeSingle();

  const fallback: OrganizationSettings = {
    organization_id: organizationId,
    ...DEFAULT_SETTINGS,
    updated_at: null,
  };

  if (error) {
    console.error(`[settings] read failed: ${formatDbError(error)}`);
    return { settings: fallback, failed: true, exists: false };
  }

  if (!data) return { settings: fallback, failed: false, exists: false };

  const row = data as unknown as Record<string, unknown>;

  return {
    settings: {
      organization_id: organizationId,
      currency: typeof row.currency === "string" ? row.currency : DEFAULT_SETTINGS.currency,
      default_recruiter_id: (row.default_recruiter_id as string | null) ?? null,
      default_application_stage: isApplicationStage(row.default_application_stage)
        ? row.default_application_stage
        : "applied",
      default_interview_duration_minutes:
        typeof row.default_interview_duration_minutes === "number"
          ? row.default_interview_duration_minutes
          : 60,
      screening_settings: normalizeScreeningSettings(row.screening_settings),
      retention_settings: normalizeRetentionSettings(row.retention_settings),
      logo_url: (row.logo_url as string | null) ?? null,
      brand_color: (row.brand_color as string | null) ?? null,
      updated_at: (row.updated_at as string | null) ?? null,
    },
    failed: false,
    exists: true,
  };
}

/**
 * Normalises stored JSONB into a typed shape.
 *
 * Clamped to the same bounds Module 8's retry policy enforces, so a value edited
 * directly in the database cannot make the product dial someone ten times. The
 * settings form is not the security boundary; this is.
 */
export function normalizeScreeningSettings(value: unknown): ScreeningSettings {
  const raw = (value ?? {}) as Record<string, unknown>;

  const maxAttempts =
    typeof raw.maxAttempts === "number" && Number.isFinite(raw.maxAttempts)
      ? Math.min(Math.max(Math.floor(raw.maxAttempts), 1), MAX_ALLOWED_ATTEMPTS)
      : DEFAULT_SCREENING_SETTINGS.maxAttempts;

  const retryDelayMinutes =
    typeof raw.retryDelayMinutes === "number" && Number.isFinite(raw.retryDelayMinutes)
      ? Math.max(Math.floor(raw.retryDelayMinutes), MIN_ALLOWED_DELAY_MINUTES)
      : DEFAULT_SCREENING_SETTINGS.retryDelayMinutes;

  return {
    maxAttempts,
    retryDelayMinutes,
    language: typeof raw.language === "string" && raw.language.trim() ? raw.language : "en",
    // Defaults to true, but Module 8's consent disclosure runs regardless —
    // this toggles the default, never the disclosure.
    recordCalls: raw.recordCalls !== false,
  };
}

export function normalizeRetentionSettings(value: unknown): RetentionSettings {
  const raw = (value ?? {}) as Record<string, unknown>;

  const clamp = (input: unknown): number => {
    if (typeof input !== "number" || !Number.isFinite(input) || input < 0) return 0;
    // Ten years. Beyond that a "retention period" is indistinguishable from
    // keeping it forever, and the honest setting for that is 0.
    return Math.min(Math.floor(input), 3650);
  };

  return {
    transcriptRetentionDays: clamp(raw.transcriptRetentionDays),
    archivedCandidateRetentionDays: clamp(raw.archivedCandidateRetentionDays),
  };
}

export type UserPreferences = {
  display_timezone: string | null;
  date_format: string;
  ui_preferences: Record<string, unknown>;
};

export const DEFAULT_USER_PREFERENCES: UserPreferences = {
  display_timezone: null,
  date_format: "dd MMM yyyy",
  ui_preferences: {},
};

export async function getUserPreferences({
  organizationId,
  userId,
}: {
  organizationId: string;
  userId: string;
}): Promise<UserPreferences> {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from("user_preferences")
    .select("display_timezone, date_format, ui_preferences")
    .eq("organization_id", organizationId)
    .eq("user_id", userId)
    .maybeSingle();

  if (error || !data) return DEFAULT_USER_PREFERENCES;

  const row = data as unknown as UserPreferences;
  return {
    display_timezone: row.display_timezone ?? null,
    date_format: row.date_format ?? DEFAULT_USER_PREFERENCES.date_format,
    ui_preferences: row.ui_preferences ?? {},
  };
}

export type SettingsPayload = Partial<{
  currency: string;
  default_recruiter_id: string | null;
  default_application_stage: string;
  default_interview_duration_minutes: number;
  screening_settings: unknown;
  retention_settings: unknown;
  logo_url: string | null;
  brand_color: string | null;
}>;

export type ParseResult =
  | { ok: true; data: Record<string, unknown> }
  | { ok: false; error: string };

/** Validates a settings patch. Only known keys survive. */
export function parseSettingsPayload(value: unknown): ParseResult {
  if (typeof value !== "object" || value === null) {
    return { ok: false, error: "Invalid settings payload." };
  }

  const raw = value as Record<string, unknown>;
  const updates: Record<string, unknown> = {};

  if ("currency" in raw) {
    const currency = typeof raw.currency === "string" ? raw.currency.trim().toUpperCase() : "";
    if (!/^[A-Z]{3}$/.test(currency)) {
      return { ok: false, error: "Currency must be a three-letter code, like INR or USD." };
    }
    updates.currency = currency;
  }

  if ("default_recruiter_id" in raw) {
    const recruiterId = raw.default_recruiter_id;
    if (recruiterId === null) {
      updates.default_recruiter_id = null;
    } else if (typeof recruiterId === "string" && recruiterId.length > 0) {
      updates.default_recruiter_id = recruiterId;
    } else {
      return { ok: false, error: "Invalid default recruiter." };
    }
  }

  if ("default_application_stage" in raw) {
    if (!isApplicationStage(raw.default_application_stage)) {
      return { ok: false, error: "Invalid default stage." };
    }
    updates.default_application_stage = raw.default_application_stage;
  }

  if ("default_interview_duration_minutes" in raw) {
    const minutes = Number(raw.default_interview_duration_minutes);
    if (!Number.isFinite(minutes) || minutes < 5 || minutes > 480) {
      return { ok: false, error: "Interview duration must be between 5 and 480 minutes." };
    }
    updates.default_interview_duration_minutes = Math.floor(minutes);
  }

  // Normalised rather than stored raw, so the clamps apply on write as well as
  // on read — a value that never passes through the form still gets bounded.
  if ("screening_settings" in raw) {
    updates.screening_settings = normalizeScreeningSettings(raw.screening_settings);
  }

  if ("retention_settings" in raw) {
    updates.retention_settings = normalizeRetentionSettings(raw.retention_settings);
  }

  if ("brand_color" in raw) {
    const color = raw.brand_color;
    if (color === null) {
      updates.brand_color = null;
    } else if (typeof color === "string" && /^#[0-9A-Fa-f]{6}$/.test(color.trim())) {
      updates.brand_color = color.trim();
    } else {
      return { ok: false, error: "Brand colour must be a hex value like #4F46E5." };
    }
  }

  if ("logo_url" in raw) {
    const url = raw.logo_url;
    if (url === null) {
      updates.logo_url = null;
    } else if (typeof url === "string" && /^https:\/\//.test(url.trim())) {
      // https only: an http logo on an https page is a mixed-content warning
      // and a plaintext request carrying the referrer.
      updates.logo_url = url.trim().slice(0, 500);
    } else {
      return { ok: false, error: "The logo URL must start with https://" };
    }
  }

  if (Object.keys(updates).length === 0) {
    return { ok: false, error: "No valid settings provided." };
  }

  return { ok: true, data: updates };
}
