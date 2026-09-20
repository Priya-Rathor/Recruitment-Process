// Organization settings and user preferences.
import { createClient } from "@/lib/supabase/server";
import { isApplicationStage, type ApplicationStage } from "@/lib/applications/stages";
import { MAX_ALLOWED_ATTEMPTS, MIN_ALLOWED_DELAY_MINUTES } from "@/lib/screening/retry";
import { formatDbError } from "@/lib/supabase/errors";
import {
  DEFAULT_PRIVACY_SETTINGS,
  normalizePrivacySettings,
  type PrivacySettings,
} from "@/lib/privacy/settings";

export type ScreeningSettings = {
  maxAttempts: number;
  retryDelayMinutes: number;
  language: string;
  /** Recording is consent-gated regardless; this only controls the default. */
  recordCalls: boolean;
};

export type OnboardingSettings = {
  /**
   * Days a required document may sit Pending before the assignee is reminded.
   * 0 disables the reminder — see normalizeOnboardingSettings.
   */
  pendingReminderDays: number;
};

/**
 * Candidate communication — the interview reminder's timing and channels.
 *
 * WHY THIS LIVES IN ORGANIZATION SETTINGS AND NOT IN A NEW TABLE.
 *
 * The spec asks to "reuse Module 11's existing reminder timing config, add channel
 * choice to it rather than creating a second reminder system". Module 11 never
 * built one — its feedback queue is computed on read and hard-codes
 * FEEDBACK_DUE_HOURS — so there was nothing to extend. Putting the timing here,
 * beside every other operating default, and having the ONE existing dispatcher
 * (lib/notifications/reminders.ts) send it is the nearest honest reading of that
 * instruction: one reminder system, one config, one place it is triggered from.
 */
export type CommunicationSettings = {
  /**
   * How many hours before an interview the reminder goes out.
   * 0 switches it off — see normalizeCommunicationSettings.
   */
  interviewReminderHours: number;
  /**
   * Which channels the reminder uses.
   *
   * A LIST RATHER THAN A SINGLE CHOICE, because "both" is a real answer: a
   * WhatsApp arrives on the phone the candidate is holding and an email survives
   * for them to find the joining link in. An empty list switches the reminder off
   * as surely as 0 hours does, and the settings screen says so.
   */
  interviewReminderChannels: ("email" | "whatsapp")[];
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
  /**
   * Module 21. Normalised through lib/privacy/settings.ts, which owns the shape,
   * the defaults and the clamps — this module only carries it.
   */
  privacy_settings: PrivacySettings;
  retention_settings: RetentionSettings;
  onboarding_settings: OnboardingSettings;
  communication_settings: CommunicationSettings;
  logo_url: string | null;
  brand_color: string | null;
  /**
   * MODULE 26. Where candidates are asked to attend in person, for
   * {{organization.office_address}} in the Director Round invitation.
   *
   * Distinct from a job's `location`, which is where the ROLE is — a remote job
   * with an onsite final round has two different answers to "where?".
   */
  office_address: string | null;
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
/** The spec's default: three days. */
export const DEFAULT_ONBOARDING_SETTINGS: OnboardingSettings = {
  pendingReminderDays: 3,
};

/**
 * 24 hours, email only.
 *
 * A day ahead is early enough to rearrange a morning and late enough that the
 * candidate has not forgotten again by the time it happens. Email only, because
 * WhatsApp is the newest and least likely to be configured — a default that
 * assumed it would make every reminder record a "not sent" row on a fresh install.
 *
 * The reminder still only goes out if an ACTIVE interview_reminder template exists,
 * so this default cannot start messaging anybody on its own.
 */
export const DEFAULT_COMMUNICATION_SETTINGS: CommunicationSettings = {
  interviewReminderHours: 24,
  interviewReminderChannels: ["email"],
};

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
  privacy_settings: DEFAULT_PRIVACY_SETTINGS,
  retention_settings: DEFAULT_RETENTION_SETTINGS,
  onboarding_settings: DEFAULT_ONBOARDING_SETTINGS,
  communication_settings: DEFAULT_COMMUNICATION_SETTINGS,
  logo_url: null,
  brand_color: null,
  office_address: null,
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
      privacy_settings: normalizePrivacySettings(row.privacy_settings),
      retention_settings: normalizeRetentionSettings(row.retention_settings),
      onboarding_settings: normalizeOnboardingSettings(row.onboarding_settings),
      communication_settings: normalizeCommunicationSettings(row.communication_settings),
      logo_url: (row.logo_url as string | null) ?? null,
      brand_color: (row.brand_color as string | null) ?? null,
      office_address: (row.office_address as string | null) ?? null,
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

export function normalizeOnboardingSettings(value: unknown): OnboardingSettings {
  const raw = (value ?? {}) as Record<string, unknown>;
  const days = raw.pendingReminderDays;

  if (typeof days !== "number" || !Number.isFinite(days) || days < 0) {
    return DEFAULT_ONBOARDING_SETTINGS;
  }

  // Capped at 90. A "reminder" further out than a quarter is not a reminder,
  // and 0 is the honest way to say "don't remind me".
  return { pendingReminderDays: Math.min(Math.floor(days), 90) };
}

/**
 * Normalises stored communication settings.
 *
 * Clamped on WRITE as well as on read, so a value edited straight into the JSONB
 * cannot make the product message a candidate a fortnight early. An unrecognised
 * channel is dropped rather than passed through: a stored "sms" would make the
 * dispatcher skip a channel it cannot send on and report nothing useful.
 */
export function normalizeCommunicationSettings(value: unknown): CommunicationSettings {
  const raw = (value ?? {}) as Record<string, unknown>;

  const hours = raw.interviewReminderHours;
  const interviewReminderHours =
    typeof hours === "number" && Number.isFinite(hours) && hours >= 0
      ? // 168 hours — a week. A "reminder" further out than that is an
        // announcement, and the interview will very likely have moved.
        Math.min(Math.floor(hours), 168)
      : DEFAULT_COMMUNICATION_SETTINGS.interviewReminderHours;

  const channels = Array.isArray(raw.interviewReminderChannels)
    ? raw.interviewReminderChannels.filter(
        (channel): channel is "email" | "whatsapp" =>
          channel === "email" || channel === "whatsapp"
      )
    : DEFAULT_COMMUNICATION_SETTINGS.interviewReminderChannels;

  return {
    interviewReminderHours,
    // Deduplicated: ["email","email"] would make the dispatcher send twice.
    interviewReminderChannels: [...new Set(channels)],
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
  privacy_settings: unknown;
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

  if ("office_address" in raw) {
    const address = raw.office_address;
    if (address === null || address === "") {
      // Cleared, not rejected. An organisation that stops using an office should
      // be able to empty the field; the token then renders as an em dash, which
      // is visible in the template preview.
      updates.office_address = null;
    } else if (typeof address !== "string") {
      return { ok: false, error: "The office address must be text." };
    } else if (address.trim().length > 500) {
      return { ok: false, error: "That office address is too long (500 characters max)." };
    } else {
      updates.office_address = address.trim();
    }
  }

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

  // Normalised on write as well as on read, so a payload that bypassed the form
  // still cannot store a state the form would refuse — including the one that
  // matters most here, "recording off but store-audio ticked".
  if ("privacy_settings" in raw) {
    updates.privacy_settings = normalizePrivacySettings(raw.privacy_settings);
  }

  if ("onboarding_settings" in raw) {
    updates.onboarding_settings = normalizeOnboardingSettings(raw.onboarding_settings);
  }

  if ("communication_settings" in raw) {
    updates.communication_settings = normalizeCommunicationSettings(raw.communication_settings);
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
      return { ok: false, error: "Brand colour must be a hex value like #8B9EFF." };
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
