// =============================================================================
// Preference resolution: template default -> organization default -> user.
//
// Three levels, resolved in that order, each overriding the last. The spec's
// test — "user-level preferences correctly override organization defaults where
// allowed" — is this function, and it is pure so it can be tested directly.
//
// The subtlety that shapes the data model: an ABSENT preference and a
// preference that happens to match the default are different facts. If they
// were stored the same way, changing the organization default would either
// silently overwrite people's deliberate choices or never reach anyone who had
// ever opened the settings page. So a row exists only where someone actually
// chose something.
// =============================================================================
import { TEMPLATES, type NotificationType } from "@/lib/notifications/templates";

export type ChannelPreference = {
  inApp: boolean;
  email: boolean;
};

export type PreferenceRow = {
  /** null = the organization default. */
  user_id: string | null;
  notification_type: string;
  in_app_enabled: boolean;
  email_enabled: boolean;
};

export type ResolvedPreference = ChannelPreference & {
  /** Where the answer came from, so the settings UI can say "inherited". */
  source: "template" | "organization" | "user";
};

/**
 * Resolves one type for one user.
 *
 * `rows` should contain the organization defaults and that user's overrides;
 * anything else is ignored rather than trusted, since a caller passing another
 * user's rows would otherwise silently apply their choices.
 */
export function resolvePreference({
  type,
  userId,
  rows,
}: {
  type: NotificationType;
  userId: string;
  rows: PreferenceRow[];
}): ResolvedPreference {
  const template = TEMPLATES[type];

  let resolved: ResolvedPreference = {
    inApp: template?.defaultInApp ?? true,
    email: template?.defaultEmail ?? false,
    source: "template",
  };

  const orgDefault = rows.find(
    (row) => row.user_id === null && row.notification_type === type
  );
  if (orgDefault) {
    resolved = {
      inApp: orgDefault.in_app_enabled,
      email: orgDefault.email_enabled,
      source: "organization",
    };
  }

  const userOverride = rows.find(
    (row) => row.user_id === userId && row.notification_type === type
  );
  if (userOverride) {
    resolved = {
      inApp: userOverride.in_app_enabled,
      email: userOverride.email_enabled,
      source: "user",
    };
  }

  return resolved;
}

/**
 * IN-APP CANNOT BE TURNED OFF FOR HIGH-PRIORITY TYPES.
 *
 * A deliberate deviation from "preferences win". Three of these — a cancelled
 * interview, a candidate asking not to be called again, a failed automation —
 * are the record that something needs a human. Letting someone mute them means
 * a candidate who declined an automated call gets dialled again because nobody
 * saw the notice, which is the exact harm Module 8 is built to avoid.
 *
 * EMAIL remains fully optional. Muting a channel is a preference; muting the
 * record is not.
 */
export function applyMandatoryChannels({
  type,
  preference,
}: {
  type: NotificationType;
  preference: ChannelPreference;
}): ChannelPreference {
  const template = TEMPLATES[type];
  if (template?.priority === "high") {
    return { inApp: true, email: preference.email };
  }
  return preference;
}

/** Resolution plus the mandatory-channel rule — what notify() actually uses. */
export function effectivePreference({
  type,
  userId,
  rows,
}: {
  type: NotificationType;
  userId: string;
  rows: PreferenceRow[];
}): ResolvedPreference {
  const resolved = resolvePreference({ type, userId, rows });
  const withMandatory = applyMandatoryChannels({ type, preference: resolved });

  return { ...withMandatory, source: resolved.source };
}
