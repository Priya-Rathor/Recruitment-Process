// =============================================================================
// Honouring an unsubscribe link.
//
// Called from the public /unsubscribe page, which has NO SESSION — the link's
// signature is the authorisation (see lib/communications/optout.ts). So every
// database call here uses the SERVICE-ROLE client, which BYPASSES RLS.
//
// THAT MAKES THE organization_id LOOKUP THE ENTIRE TENANT BOUNDARY, and it is
// resolved from OUR OWN DATA — the candidate row — never from anything in the
// request. The token carries a candidate id and a channel and nothing else; there
// is no field in it an attacker could use to name an organization.
//
// WHAT THIS FUNCTION WILL NOT DO:
//
//   - It will not re-subscribe. There is no path here that sets a flag to false.
//     A link somebody could be tricked into opening must not be able to restore
//     contact with a person who asked us to stop.
//   - It will not reveal whether a candidate exists. An unknown id and a bad
//     signature return the same thing, because the difference would make this
//     endpoint an existence oracle for a candidate database.
//   - It will not touch the log. Already-sent history stays exactly as it is; an
//     opt-out is forward-looking, which is the spec's explicit rule.
// =============================================================================
import { createAdminClient } from "@/lib/supabase/admin";
import { verifyOptOutToken } from "@/lib/communications/optout";
import { logActivity } from "@/lib/activity/log";
import { formatDbError } from "@/lib/supabase/errors";

export type UnsubscribeResult =
  | { ok: true; channel: "email" | "whatsapp"; alreadyOptedOut: boolean }
  /** Bad, expired, or unsigned token — and unknown candidate, deliberately. */
  | { ok: false; reason: "invalid" }
  /** Something on our side. Worth telling them so they can reply instead. */
  | { ok: false; reason: "failed" };

export async function honourUnsubscribe(token: string): Promise<UnsubscribeResult> {
  try {
    const verified = await verifyOptOutToken(token);
    if (!verified) return { ok: false, reason: "invalid" };

    const admin = createAdminClient();
    if (!admin) {
      console.error("[unsubscribe] no service-role client; cannot honour an opt-out");
      return { ok: false, reason: "failed" };
    }

    // The tenant boundary. Resolved from the candidate row, never from the token.
    const { data: candidate, error: candidateError } = await admin
      .from("candidates")
      .select("id, organization_id")
      .eq("id", verified.candidateId)
      .maybeSingle();

    if (candidateError) {
      console.error(`[unsubscribe] candidate read failed: ${formatDbError(candidateError)}`);
      return { ok: false, reason: "failed" };
    }

    // A signed token for a candidate who has since been deleted. Reported as
    // invalid rather than as an error: there is nothing to opt out, and saying
    // "that person is not in our database" answers a question nobody asked.
    if (!candidate) return { ok: false, reason: "invalid" };

    const organizationId = (candidate as { organization_id: string }).organization_id;

    const { data: existing } = await admin
      .from("candidate_communication_preferences")
      .select("email_opted_out, whatsapp_opted_out")
      .eq("candidate_id", verified.candidateId)
      .maybeSingle();

    const current = (existing as {
      email_opted_out: boolean;
      whatsapp_opted_out: boolean;
    } | null) ?? { email_opted_out: false, whatsapp_opted_out: false };

    const alreadyOptedOut =
      verified.channel === "email" ? current.email_opted_out : current.whatsapp_opted_out;

    // Idempotent: clicking the link twice is the normal thing a person does when
    // they are not sure the first click worked, and the second must not error.
    if (alreadyOptedOut) {
      return { ok: true, channel: verified.channel, alreadyOptedOut: true };
    }

    const { error } = await admin.from("candidate_communication_preferences").upsert(
      {
        candidate_id: verified.candidateId,
        organization_id: organizationId,
        // ONLY EVER SET TO TRUE, and the other channel's existing value is
        // preserved: an email unsubscribe is not a WhatsApp one.
        email_opted_out: verified.channel === "email" ? true : current.email_opted_out,
        whatsapp_opted_out:
          verified.channel === "whatsapp" ? true : current.whatsapp_opted_out,
        opted_out_reason: "Unsubscribed using the link in an automated message.",
      },
      { onConflict: "candidate_id" }
    );

    if (error) {
      console.error(`[unsubscribe] opt-out write failed: ${formatDbError(error)}`);
      return { ok: false, reason: "failed" };
    }

    // actorId NULL — the candidate is not a user of this product, and inventing a
    // recruiter to fill the column would attribute somebody else's decision to them.
    // `source: "candidate"` is what the timeline reads to say who chose it.
    await logActivity({
      organizationId,
      entityType: "candidate",
      entityId: verified.candidateId,
      eventType: "candidate.communication_preference_changed",
      actorId: null,
      actorLabel: "The candidate",
      metadata: { opted_out_of: [verified.channel], source: "candidate" },
      useAdminClient: true,
    });

    return { ok: true, channel: verified.channel, alreadyOptedOut: false };
  } catch (error) {
    console.error(`[unsubscribe] failed: ${formatDbError(error)}`);
    return { ok: false, reason: "failed" };
  }
}
