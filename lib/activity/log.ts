// =============================================================================
// logActivity() — the single call-site every module retrofits to.
//
// TWO RULES GOVERN THIS FILE.
//
// 1. LOGGING MUST NEVER BREAK THE ACTION IT RECORDS.
//    Every call is caught. A failed insert is reported to the server log and
//    swallowed. Losing an audit row is bad; losing a candidate's stage change
//    because the audit insert failed is worse, and it is the failure mode that
//    would make people mistrust the whole product. Callers do not need to wrap
//    this — it never throws, never rejects.
//
// 2. THE CALLER DOES NOT DECIDE WHAT IS SENSITIVE.
//    is_sensitive comes from the catalogue, not from the argument list. A route
//    that could mark its own event non-sensitive would be able to hide a role
//    change from the audit log, which is exactly the thing the audit log exists
//    to catch.
// =============================================================================
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { isSensitiveEvent, type EventType } from "@/lib/activity/events";
import type { ActivityEntityType } from "@/lib/activity/types";
import { formatDbError } from "@/lib/supabase/errors";

export type LogActivityInput = {
  organizationId: string;
  entityType: ActivityEntityType;
  entityId: string | null;
  eventType: EventType;
  /**
   * The acting user. NULL for genuinely system-driven events — a webhook, an
   * automation acting on its own. Never invent a user to fill the column: "the
   * system did this" is a true statement and "Priya did this" would not be.
   */
  actorId?: string | null;
  /** Name/email snapshot, so the row still reads correctly if the user is deleted. */
  actorLabel?: string | null;
  metadata?: Record<string, unknown>;
  /**
   * Use the service-role client.
   *
   * Only for contexts with no user session — the Bolna webhook is the one that
   * exists today. That client BYPASSES RLS, so the organization_id passed here
   * must already have been resolved from our own data, never from a payload.
   */
  useAdminClient?: boolean;
};

/**
 * Records one event. Returns whether it was stored, for tests and for the rare
 * caller that wants to know; ignoring the result is the normal case.
 */
export async function logActivity(input: LogActivityInput): Promise<boolean> {
  try {
    const client = input.useAdminClient ? createAdminClient() : await createClient();

    if (!client) {
      // Service-role key absent. Worth a loud log — it means audit coverage has
      // a hole — but not worth failing the caller's action over.
      console.error(
        `[activity] no client available; dropped ${input.eventType} for org ${input.organizationId}`
      );
      return false;
    }

    const { error } = await client.from("activity_events").insert({
      organization_id: input.organizationId,
      entity_type: input.entityType,
      entity_id: input.entityId,
      event_type: input.eventType,
      actor_id: input.actorId ?? null,
      actor_label: input.actorLabel ?? null,
      metadata: sanitizeMetadata(input.metadata ?? {}),
      // From the catalogue, never from the caller.
      is_sensitive: isSensitiveEvent(input.eventType),
    });

    if (error) {
      console.error(`[activity] failed to record ${input.eventType}: ${formatDbError(error)}`);
      return false;
    }

    return true;
  } catch (error) {
    console.error(`[activity] failed to record ${input.eventType}: ${formatDbError(error)}`);
    return false;
  }
}

/**
 * Records several events at once — a bulk action, or one user action that is
 * genuinely two events. Same guarantees; still never throws.
 */
export async function logActivityBatch(inputs: LogActivityInput[]): Promise<number> {
  if (inputs.length === 0) return 0;

  const results = await Promise.all(inputs.map((input) => logActivity(input)));
  return results.filter(Boolean).length;
}

/**
 * Summary-level AI-call logging.
 *
 * Section 10: "Log every AI call's inputs/outputs at a summary level ... without
 * storing secrets or full raw provider payloads unnecessarily."
 *
 * So this records WHICH feature ran and WHETHER it worked. Deliberately not the
 * prompt and not the completion: those contain candidate personal data, and an
 * audit table is the wrong place to accumulate a second copy of it. An error
 * CODE is stored; the provider's message is not, since it can echo input back.
 */
export async function logAiCall({
  organizationId,
  actorId,
  actorLabel,
  feature,
  entityType = "application",
  entityId = null,
  ok,
  errorCode,
}: {
  organizationId: string;
  actorId?: string | null;
  actorLabel?: string | null;
  /** The AI Service Layer function name, e.g. "parseResume". */
  feature: string;
  entityType?: ActivityEntityType;
  entityId?: string | null;
  ok: boolean;
  errorCode?: string | null;
}): Promise<boolean> {
  return logActivity({
    organizationId,
    entityType,
    entityId,
    eventType: "ai.invoked",
    actorId,
    actorLabel,
    metadata: {
      feature,
      ok,
      ...(ok ? {} : { error_code: errorCode ?? "unknown" }),
    },
  });
}

/** Keys that must never reach the metadata column, whatever a caller passes. */
const FORBIDDEN_KEY = /(password|secret|token|api[_-]?key|credential|authorization|transcript|prompt|completion)/i;

const MAX_STRING_LENGTH = 500;
const MAX_KEYS = 25;

/**
 * Strips anything that shouldn't be durably stored.
 *
 * A backstop, not the primary defence — callers are expected to pass summaries.
 * But this table is append-only and never expires, so a credential or a full
 * call transcript accidentally logged here would be permanent. Cheap to prevent,
 * impossible to undo.
 */
export function sanitizeMetadata(metadata: Record<string, unknown>): Record<string, unknown> {
  const output: Record<string, unknown> = {};
  let count = 0;

  for (const [key, value] of Object.entries(metadata)) {
    if (count >= MAX_KEYS) break;
    if (FORBIDDEN_KEY.test(key)) continue;

    if (typeof value === "string") {
      output[key] = value.length > MAX_STRING_LENGTH ? `${value.slice(0, MAX_STRING_LENGTH)}…` : value;
    } else if (typeof value === "number" || typeof value === "boolean" || value === null) {
      output[key] = value;
    } else if (Array.isArray(value)) {
      output[key] = value
        .slice(0, 20)
        .map((entry) =>
          typeof entry === "string" && entry.length > 120 ? `${entry.slice(0, 120)}…` : entry
        )
        .filter((entry) => typeof entry !== "object" || entry === null);
    }
    // Nested objects are dropped: they are how an entire provider payload ends
    // up in the log by accident.

    count += 1;
  }

  return output;
}
