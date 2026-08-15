// =============================================================================
// notify() — the send pipeline every other module calls.
//
// THE ORDER IS THE GUARANTEE.
//
// The spec's test: "External channel failure never blocks in-app notification
// creation." So the in-app row is inserted and its id returned BEFORE any
// external attempt begins, and the email step is in its own try/catch that can
// only ever affect a notification_deliveries row. There is no code path where a
// provider outage costs someone their notification.
//
// Like logActivity(), this NEVER THROWS. A caller wiring up a reminder should
// not have to defend against the reminder system.
// =============================================================================
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  renderTemplate,
  TEMPLATES,
  type NotificationType,
} from "@/lib/notifications/templates";
import { effectivePreference, type PreferenceRow } from "@/lib/notifications/preferences";
import { sendEmail } from "@/lib/integrations/email";
import { describeDbError } from "@/lib/supabase/errors";

export type NotifyInput = {
  organizationId: string;
  /** The recipient. Must be a member of this org — a trigger enforces it. */
  userId: string;
  type: NotificationType;
  /** Substituted into the template. Missing fixed facts fail the render. */
  values: Record<string, string | number | null | undefined>;
  linkPath?: string | null;
  /**
   * Overrides the recipient's own address for an EXTERNAL template — a
   * candidate's email rather than the recruiter's. Ignored for internal ones.
   */
  emailOverride?: string | null;
  /**
   * Use the service-role client. Only for contexts with no session (the Bolna
   * webhook). That client BYPASSES RLS, so organizationId must already have been
   * resolved from our own data, never from a payload.
   */
  useAdminClient?: boolean;
};

export type NotifyResult = {
  /** null when nothing was created — preferences off, or the write failed. */
  notificationId: string | null;
  inAppCreated: boolean;
  emailStatus: "sent" | "failed" | "skipped" | "not_attempted";
  /** Human-readable, safe to surface. */
  detail: string | null;
};

const NOT_CREATED: NotifyResult = {
  notificationId: null,
  inAppCreated: false,
  emailStatus: "not_attempted",
  detail: null,
};

/** Masks an address for the delivery row — never store a full one twice. */
export function maskEmail(address: string): string {
  const [local, domain] = address.split("@");
  if (!domain) return "•••";
  const head = local.slice(0, 2);
  return `${head}${"•".repeat(Math.max(local.length - 2, 1))}@${domain}`;
}

async function loadPreferenceRows({
  client,
  organizationId,
  userId,
}: {
  client: NonNullable<Awaited<ReturnType<typeof createAdminClient>>> | Awaited<ReturnType<typeof createClient>>;
  organizationId: string;
  userId: string;
}): Promise<PreferenceRow[]> {
  const { data, error } = await client
    .from("notification_preferences")
    .select("user_id, notification_type, in_app_enabled, email_enabled")
    .eq("organization_id", organizationId)
    // Organization defaults plus THIS user's overrides. Never anyone else's —
    // resolvePreference ignores foreign rows, but not fetching them is better.
    .or(`user_id.is.null,user_id.eq.${userId}`);

  if (error) {
    // Fall back to template defaults rather than dropping the notification. A
    // preferences read failure must not mean a cancelled interview goes unsent.
    console.error("[notify] preference read failed, using template defaults:", describeDbError(error));
    return [];
  }

  return (data ?? []) as unknown as PreferenceRow[];
}

/**
 * Creates a notification and attempts its channels.
 *
 * Returns what happened rather than throwing, so a caller can surface "the
 * in-app notice was created but email isn't connected" — which is a true and
 * useful thing to say, unlike a bare success.
 */
export async function notify(input: NotifyInput): Promise<NotifyResult> {
  try {
    const template = TEMPLATES[input.type];
    if (!template) {
      console.error(`[notify] unknown notification type: ${input.type}`);
      return NOT_CREATED;
    }

    const client = input.useAdminClient ? createAdminClient() : await createClient();
    if (!client) {
      console.error(`[notify] no client available; dropped ${input.type}`);
      return NOT_CREATED;
    }

    // Render FIRST. A missing fixed fact is a hard failure — better no message
    // than "your interview is scheduled for not recorded".
    const rendered = renderTemplate({ type: input.type, values: input.values });
    if (!rendered.ok) {
      console.error(`[notify] render failed for ${input.type}: ${rendered.error}`);
      return { ...NOT_CREATED, detail: rendered.error };
    }

    const rows = await loadPreferenceRows({
      client,
      organizationId: input.organizationId,
      userId: input.userId,
    });

    const preference = effectivePreference({
      type: input.type,
      userId: input.userId,
      rows,
    });

    if (!preference.inApp && !preference.email) {
      // Both channels muted. Not an error — somebody chose this.
      return { ...NOT_CREATED, detail: "Muted by notification preferences." };
    }

    // ---------------------------------------------------------------------
    // STEP 1 — the in-app row. Always first, and its own statement.
    // ---------------------------------------------------------------------
    let notificationId: string | null = null;
    let inAppCreated = false;

    if (preference.inApp) {
      const { data, error } = await client
        .from("notifications")
        .insert({
          organization_id: input.organizationId,
          user_id: input.userId,
          type: input.type,
          title: rendered.message.title,
          body: rendered.message.body,
          link_path: input.linkPath ?? null,
          priority: template.priority ?? "normal",
          // The facts only — not the caller's whole values object, which may
          // carry more than the message needed.
          metadata: rendered.message.facts,
        })
        .select("id")
        .single();

      if (error || !data) {
        console.error(`[notify] in-app insert failed for ${input.type}:`, describeDbError(error));
      } else {
        notificationId = (data as { id: string }).id;
        inAppCreated = true;
      }
    }

    // ---------------------------------------------------------------------
    // STEP 2 — email. Entirely separate, and incapable of undoing step 1.
    // ---------------------------------------------------------------------
    if (!preference.email) {
      return {
        notificationId,
        inAppCreated,
        emailStatus: "not_attempted",
        detail: null,
      };
    }

    // A delivery row needs a notification to hang off. If in-app was muted
    // there is nothing to attach to, so email is recorded as attempted-only.
    if (!notificationId) {
      const address = await resolveRecipientEmail({ client, input });
      if (!address) return { notificationId, inAppCreated, emailStatus: "skipped", detail: null };

      const sent = await sendEmail({
        organizationId: input.organizationId,
        to: address,
        subject: rendered.message.title,
        body: rendered.message.body,
      });

      return {
        notificationId,
        inAppCreated,
        emailStatus: sent.ok ? "sent" : sent.skipped ? "skipped" : "failed",
        detail: sent.ok ? null : sent.skipped ? sent.reason : sent.error,
      };
    }

    const address = await resolveRecipientEmail({ client, input });

    if (!address) {
      await recordDelivery({
        client,
        organizationId: input.organizationId,
        notificationId,
        status: "skipped",
        errorMessage: "No email address on file for the recipient.",
        recipientHint: null,
        providerMessageId: null,
      });

      return {
        notificationId,
        inAppCreated,
        emailStatus: "skipped",
        detail: "No email address on file, so nothing was sent.",
      };
    }

    const sent = await sendEmail({
      organizationId: input.organizationId,
      to: address,
      subject: rendered.message.title,
      body: rendered.message.body,
    });

    await recordDelivery({
      client,
      organizationId: input.organizationId,
      notificationId,
      status: sent.ok ? "sent" : sent.skipped ? "skipped" : "failed",
      errorMessage: sent.ok ? null : sent.skipped ? sent.reason : sent.error,
      recipientHint: maskEmail(address),
      providerMessageId: sent.ok ? sent.providerMessageId : null,
    });

    return {
      notificationId,
      inAppCreated,
      emailStatus: sent.ok ? "sent" : sent.skipped ? "skipped" : "failed",
      detail: sent.ok ? null : sent.skipped ? sent.reason : sent.error,
    };
  } catch (error) {
    // The outermost net. Whatever happened, the caller's own work stands.
    console.error(`[notify] failed for ${input.type}:`, describeDbError(error));
    return NOT_CREATED;
  }
}

async function resolveRecipientEmail({
  client,
  input,
}: {
  client: NonNullable<ReturnType<typeof createAdminClient>> | Awaited<ReturnType<typeof createClient>>;
  input: NotifyInput;
}): Promise<string | null> {
  const template = TEMPLATES[input.type];

  // An external template goes to the candidate or client, whose address the
  // caller supplies. Falling back to the team member's address here would email
  // a recruiter a message written to a candidate — confusing at best.
  if (template?.audience === "external") {
    return input.emailOverride?.trim() || null;
  }

  const { data } = await client
    .from("users")
    .select("email")
    .eq("id", input.userId)
    .maybeSingle();

  return (data as { email: string } | null)?.email ?? null;
}

async function recordDelivery({
  client,
  organizationId,
  notificationId,
  status,
  errorMessage,
  recipientHint,
  providerMessageId,
}: {
  client: NonNullable<ReturnType<typeof createAdminClient>> | Awaited<ReturnType<typeof createClient>>;
  organizationId: string;
  notificationId: string;
  status: "sent" | "failed" | "skipped";
  errorMessage: string | null;
  recipientHint: string | null;
  providerMessageId: string | null;
}): Promise<void> {
  const { error } = await client.from("notification_deliveries").upsert(
    {
      organization_id: organizationId,
      notification_id: notificationId,
      channel: "email",
      status,
      error_message: errorMessage,
      recipient_hint: recipientHint,
      provider_message_id: providerMessageId,
      sent_at: status === "sent" ? new Date().toISOString() : null,
    },
    { onConflict: "notification_id,channel" }
  );

  if (error) {
    // Losing the delivery record is regrettable; it must not become an
    // exception that unwinds a notification that was genuinely created.
    console.error("[notify] recording delivery failed:", describeDbError(error));
  }
}

/**
 * Notifies several people about the same thing.
 *
 * Sequential rather than parallel: these fan out to whole teams, and a burst of
 * concurrent provider calls is how an account gets rate-limited — at which point
 * the failures land on the last recipients rather than being spread evenly,
 * which is worse than being slightly slower.
 */
export async function notifyMany(
  inputs: NotifyInput[]
): Promise<{ created: number; emailed: number }> {
  let created = 0;
  let emailed = 0;

  for (const input of inputs) {
    const result = await notify(input);
    if (result.inAppCreated) created += 1;
    if (result.emailStatus === "sent") emailed += 1;
  }

  return { created, emailed };
}
