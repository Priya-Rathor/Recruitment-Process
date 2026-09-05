// =============================================================================
// Turning a recipient list into addresses. SERVER ONLY.
//
// The pure half — the kinds, their labels, validation — is in
// lib/workflow/recipients.ts and is imported by the builder UI. This half reads
// the database and must never be imported from a "use client" component.
// AGENTS.md: "split the module, not the file."
//
// -----------------------------------------------------------------------------
// EVERY QUERY NAMES ITS TENANT.
//
// This runs under the automation engine's client, which for a webhook or a
// scheduled sweep is the SERVICE-ROLE client — RLS is off. `organizationId` is
// resolved from our own rows by the caller, never from a payload, and every
// select below filters on it explicitly. The organization_member lookup is the
// one that matters most: a user id arrives from a stored rule, and without the
// membership filter a rule carrying an id from another tenant would resolve to
// that person's email address.
//
// -----------------------------------------------------------------------------
// WHY A COLLEAGUE'S MESSAGE SKIPS THE OPT-OUT AND THE FOOTER.
//
// Both are candidate-consent machinery. A candidate's unsubscribe is a statement
// about marketing and recruiting contact directed at them; letting it suppress a
// recruiter's own "this person passed" notification would mean a candidate could
// silently switch off their recruiter's alerts. And an unsubscribe footer on
// internal mail is nonsense at best — at worst a colleague clicks it and opts
// the CANDIDATE out.
//
// So a resolved recipient carries `internal`, sendOnChannel() takes it as
// `internalRecipient`, and setting it does exactly three things: swaps the
// address, skips the opt-out read, and omits the footer. The message_log row
// records `internal_recipient_user_id` so the send is never later mistaken for
// one the candidate received. See lib/communications/send.ts.
// =============================================================================
import { formatDbError } from "@/lib/supabase/errors";
import { isInternal, type Recipient, type RecipientKind } from "@/lib/workflow/recipients";

/** The narrow client shape this needs. Matches the engine's EngineClient. */
type RecipientClient = {
  from: (table: string) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    select: (columns: string) => any;
  };
};

export type ResolvedRecipient = {
  kind: RecipientKind;
  /** Null for the candidate; the users row id for everybody else. */
  userId: string | null;
  name: string | null;
  email: string | null;
  /** Only the candidate has one — `users` has no phone column. */
  phone: string | null;
  internal: boolean;
};

export type RecipientResolution = {
  resolved: ResolvedRecipient[];
  /**
   * Recipients that named somebody who is not there — an unassigned application,
   * a job with no owner, a member who has left.
   *
   * REPORTED, NEVER SILENT. A stage workflow whose recruiter notification
   * resolves to nobody has to say so in the run log, because the alternative is
   * a rule that reports success while nobody was told anything. Same principle
   * as the pipeline module's "degrade to an explicit pending state" rule.
   */
  unresolved: { kind: RecipientKind; reason: string }[];
};

/**
 * Resolves a rule's recipient list against one application.
 *
 * DEDUPLICATES BY ADDRESS, not by kind. validateRecipients() already collapsed
 * duplicate kinds; this catches the case it structurally cannot see — the job
 * owner who is also the assigned recruiter, or who was additionally named as a
 * specific member. One person, one message.
 *
 * The candidate always wins a tie against an internal kind, so a deduplicated
 * send is never downgraded to internal handling (which would strip the
 * unsubscribe footer from a candidate's email).
 */
export async function resolveRecipients({
  client,
  organizationId,
  applicationId,
  recipients,
}: {
  client: RecipientClient;
  organizationId: string;
  applicationId: string;
  recipients: Recipient[];
}): Promise<RecipientResolution> {
  const resolved: ResolvedRecipient[] = [];
  const unresolved: { kind: RecipientKind; reason: string }[] = [];

  const needsApplication = recipients.some(
    (recipient) => recipient.kind !== "organization_member"
  );

  type Row = {
    assigned_recruiter_id: string | null;
    candidate: { name: string | null; email: string | null; phone: string | null } | null;
    job: { owner_recruiter_id: string | null } | null;
    recruiter: { id: string; name: string | null; email: string } | null;
    owner: { id: string; name: string | null; email: string } | null;
  };

  let row: Row | null = null;

  if (needsApplication) {
    /**
     * ONE QUERY, both staff rows embedded.
     *
     * The two foreign keys are disambiguated BY CONSTRAINT NAME, because
     * `applications` and `jobs` each point at `users` and PostgREST cannot guess
     * which relationship an unqualified `users` embed means — it errors rather
     * than choosing, which is the right behaviour and the reason for the
     * verbosity.
     *
     * The job owner is nested INSIDE the job embed rather than pulled up as a
     * second aliased `jobs` embed. Two embeds of the same table work, but they
     * are two joins to the same row and the shape they return is harder to read
     * than the nesting it saves.
     */
    const { data, error } = await client
      .from("applications")
      .select(
        "assigned_recruiter_id, " +
          "candidate:candidates(name, email, phone), " +
          "job:jobs(owner_recruiter_id, owner:users!jobs_owner_recruiter_id_fkey(id, name, email)), " +
          "recruiter:users!applications_assigned_recruiter_id_fkey(id, name, email)"
      )
      .eq("id", applicationId)
      .eq("organization_id", organizationId)
      .maybeSingle();

    if (error) {
      console.error(`[workflow] recipient lookup failed: ${formatDbError(error)}`);
      return {
        resolved: [],
        unresolved: recipients.map((recipient) => ({
          kind: recipient.kind,
          reason: "The application could not be read.",
        })),
      };
    }

    const raw = data as unknown as
      | (Omit<Row, "owner" | "job"> & {
          job: {
            owner_recruiter_id: string | null;
            owner: { id: string; name: string | null; email: string } | null;
          } | null;
        })
      | null;

    row = raw
      ? {
          assigned_recruiter_id: raw.assigned_recruiter_id,
          candidate: raw.candidate,
          job: raw.job,
          recruiter: raw.recruiter,
          owner: raw.job?.owner ?? null,
        }
      : null;

    if (!row) {
      return {
        resolved: [],
        unresolved: recipients.map((recipient) => ({
          kind: recipient.kind,
          reason: "The application could not be read.",
        })),
      };
    }
  }

  const memberIds = recipients
    .filter((recipient) => recipient.kind === "organization_member" && recipient.userId)
    .map((recipient) => recipient.userId as string);

  const members = new Map<string, { id: string; name: string | null; email: string }>();

  if (memberIds.length > 0) {
    /**
     * THE MEMBERSHIP FILTER IS THE TENANT BOUNDARY, and it is why this reads
     * organization_members rather than users directly.
     *
     * A rule stores a user id. Reading `users` by id alone would happily return
     * a person from another organization — a stored id is not proof of anything.
     * Joining through organization_members scoped to this tenant means an id
     * that does not belong here resolves to nobody, and is reported as
     * unresolved rather than mailed.
     */
    const { data, error } = await client
      .from("organization_members")
      // The constraint is named for the same reason it is on the applications
      // embed above: organization_members points at `users` twice (`user_id` and
      // `invited_by`), so an unqualified embed is ambiguous and is refused.
      .select("user_id, user:users!organization_members_user_id_fkey(id, name, email)")
      .eq("organization_id", organizationId)
      .in("user_id", memberIds);

    if (error) {
      console.error(`[workflow] member lookup failed: ${formatDbError(error)}`);
    }

    for (const entry of (data ?? []) as unknown as {
      user_id: string;
      user: { id: string; name: string | null; email: string } | null;
    }[]) {
      if (entry.user) members.set(entry.user_id, entry.user);
    }
  }

  for (const recipient of recipients) {
    switch (recipient.kind) {
      case "candidate": {
        const candidate = row?.candidate;
        if (!candidate?.email && !candidate?.phone) {
          unresolved.push({
            kind: "candidate",
            reason: "The candidate has no email address or phone number on file.",
          });
          break;
        }
        resolved.push({
          kind: "candidate",
          userId: null,
          name: candidate.name,
          email: candidate.email,
          phone: candidate.phone,
          internal: false,
        });
        break;
      }

      case "assigned_recruiter": {
        const recruiter = row?.recruiter;
        if (!recruiter?.email) {
          unresolved.push({
            kind: "assigned_recruiter",
            reason: "This application has no assigned recruiter.",
          });
          break;
        }
        resolved.push({
          kind: "assigned_recruiter",
          userId: recruiter.id,
          name: recruiter.name,
          email: recruiter.email,
          phone: null,
          internal: true,
        });
        break;
      }

      case "job_owner": {
        const owner = row?.owner;
        if (!owner?.email) {
          unresolved.push({
            kind: "job_owner",
            reason: "This job has no owning recruiter recorded.",
          });
          break;
        }
        resolved.push({
          kind: "job_owner",
          userId: owner.id,
          name: owner.name,
          email: owner.email,
          phone: null,
          internal: true,
        });
        break;
      }

      case "organization_member": {
        const member = recipient.userId ? members.get(recipient.userId) : null;
        if (!member?.email) {
          unresolved.push({
            kind: "organization_member",
            reason: "That team member is no longer in this organization.",
          });
          break;
        }
        resolved.push({
          kind: "organization_member",
          userId: member.id,
          name: member.name,
          email: member.email,
          phone: null,
          internal: true,
        });
        break;
      }
    }
  }

  return { resolved: dedupeByAddress(resolved), unresolved };
}

/**
 * One message per mailbox.
 *
 * The candidate is kept over an internal entry with the same address — an
 * unusual case (a colleague applying for an internal move) where sending as
 * "internal" would strip the unsubscribe footer from what is, legally, a message
 * to an applicant.
 */
function dedupeByAddress(recipients: ResolvedRecipient[]): ResolvedRecipient[] {
  const byAddress = new Map<string, ResolvedRecipient>();

  for (const recipient of recipients) {
    const key = (recipient.email ?? recipient.phone ?? "").trim().toLowerCase();
    if (!key) continue;

    const existing = byAddress.get(key);
    if (!existing) {
      byAddress.set(key, recipient);
      continue;
    }
    if (existing.internal && !recipient.internal) byAddress.set(key, recipient);
  }

  return [...byAddress.values()];
}

/** "the candidate and 2 colleagues" — for a run-log line. */
export function describeResolved(recipients: ResolvedRecipient[]): string {
  const internal = recipients.filter((recipient) => isInternal(recipient.kind)).length;
  const candidate = recipients.some((recipient) => recipient.kind === "candidate");

  const parts: string[] = [];
  if (candidate) parts.push("the candidate");
  if (internal > 0) parts.push(`${internal} colleague${internal === 1 ? "" : "s"}`);

  return parts.length > 0 ? parts.join(" and ") : "nobody";
}
